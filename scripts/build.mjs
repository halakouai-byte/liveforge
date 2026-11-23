#!/usr/bin/env node
/* LiveForge build — Node stdlib only (node:fs, node:path, node:url).
 *
 * Fetches live public GitHub data (unauthenticated — no token of any kind,
 * no Authorization header, no secret), renders dist/index.html from the
 * template + src/content.json + src/featured.json, and writes
 * dist/data/projects.json + dist/status.json.
 *
 * The build NEVER fails because data failed: on any API failure it renders
 * from the committed cache src/data/projects.cache.json, sets dataStale,
 * and exits 0. It exits non-zero only for a real build error (missing
 * src/content.json, template failure, unresolved token).
 *
 * Fetch table (PLAN section 6.3): A repo list, B user profile,
 * C vocab repo — DERIVED from A (the repos list already carries
 * english-vocab-daily's pushed_at; no separate call, so a rate-limited
 * vocab call can never hide a value A already returned),
 * D vocab latest commits (per_page=30 — same single request, also feeds the
 * 7-day posting strip; 30 because non-state commits interleave, so 7 missed
 * state commits from earlier in the week), E vocab state.json (raw),
 * F avatar download,
 * G lessons.json (raw — lesson count + last posted word and quiz; never hard-coded),
 * H vocab README (raw — the lesson count the README claims, for the O5
 * mismatch flag only).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USER = "halakouai-byte";
const VOCAB = "english-vocab-daily";
const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
const FETCH_TIMEOUT_MS = 10000;
const RETRY_DELAY_MS = 5000;

const log = (level, msg) => console.log(`[build] ${level}: ${msg}`);
const warn = (msg) => log("WARN", msg);
const info = (msg) => log("INFO", msg);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${fmtDate(iso)}, ${hh}:${mm} UTC`;
}
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function flat(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
    else if (typeof v !== "object") out[key] = String(v);
  }
  return out;
}

/* Fetch with timeout. Returns { ok, status, json|text|buffer, headers }.
   On 403/429 the caller must stop fetching immediately. */
async function fetchOnce(url, acceptJson) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: acceptJson ? "application/vnd.github+json" : "*/*", "User-Agent": "liveforge-build" },
  });
  const headers = {
    remaining: res.headers.get("x-ratelimit-remaining"),
    reset: res.headers.get("x-ratelimit-reset"),
  };
  if (!res.ok) return { ok: false, status: res.status, headers };
  if (acceptJson === "buffer") {
    return { ok: true, status: res.status, buffer: Buffer.from(await res.arrayBuffer()), headers };
  }
  if (acceptJson === "text") {
    return { ok: true, status: res.status, text: await res.text(), headers };
  }
  return { ok: true, status: res.status, json: await res.json(), headers };
}

let rateLimited = false;
function noteRateLimit(headers, source) {
  if (headers.remaining !== null || headers.reset !== null) {
    const reset = headers.reset
      ? new Date(Number(headers.reset) * 1000).toISOString()
      : "unknown";
    log("WARN", `${source}: x-ratelimit-remaining=${headers.remaining} reset=${reset}`);
  }
}
async function fetchJson(url, source, { retry = true } = {}) {
  try {
    const r = await fetchOnce(url, true);
    if (r.ok) { noteRateLimit(r.headers, source); return { status: "ok", http: r.status, data: r.json, headers: r.headers }; }
    if (r.status === 403 || r.status === 429) {
      rateLimited = true;
      noteRateLimit(r.headers, source);
      log("WARN", `${source}: HTTP ${r.status} — stopping fetching immediately, falling back to cache`);
      return { status: "error", http: r.status, error: `HTTP ${r.status}` };
    }
    return { status: "error", http: r.status, error: `HTTP ${r.status}` };
  } catch (e) {
    if (retry && !rateLimited) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return fetchJson(url, source, { retry: false });
    }
    return { status: "error", http: 0, error: String(e && e.message ? e.message : e) };
  }
}
/* Follow GitHub Link pagination (per_page=100 covers 4–5 repos today). */
async function fetchPaged(url, source) {
  const all = [];
  let next = url;
  let lastHeaders = {};
  while (next) {
    const r = await fetchJson(next, source, { retry: false });
    if (r.status !== "ok") return r;
    lastHeaders = r.headers;
    if (!Array.isArray(r.data)) return { status: "error", http: r.status, error: "unexpected non-array response" };
    all.push(...r.data);
    next = null; /* Link-header parsing: only used if a next page exists. */
    /* Minimal Link parsing without extra deps: re-fetch headers via the
       raw response is not available here, so pagination beyond page 1 is
       detected by a full page (100 items) — see note in README. */
    if (r.data.length === 100) {
      warn(`${source}: page was full (100 repos) — pagination beyond page 1 is not implemented; add Link-header support before the repo count passes 100`);
    }
  }
  return { status: "ok", http: 200, data: all, headers: lastHeaders };
}

function pickRepo(r) {
  return {
    name: r.name,
    description: r.description ?? null,
    html_url: r.html_url,
    language: r.language ?? null,
    stargazers_count: r.stargazers_count ?? 0,
    forks_count: r.forks_count ?? 0,
    pushed_at: r.pushed_at ?? null,
    updated_at: r.updated_at ?? null,
    created_at: r.created_at ?? null,
    license: r.license ? r.license.spdx_id ?? null : null,
    topics: Array.isArray(r.topics) ? r.topics : [],
  };
}

async function main() {
  const startedAt = new Date();
  const contentPath = path.join(ROOT, "src", "content.json");
  const featuredPath = path.join(ROOT, "src", "featured.json");
  const templatePath = path.join(ROOT, "index.html");
  const cachePath = path.join(ROOT, "src", "data", "projects.cache.json");
  if (!fs.existsSync(contentPath)) { console.error("[build] ERROR: missing src/content.json"); process.exit(1); }
  if (!fs.existsSync(featuredPath)) { console.error("[build] ERROR: missing src/featured.json"); process.exit(1); }
  if (!fs.existsSync(templatePath)) { console.error("[build] ERROR: missing index.html template"); process.exit(1); }
  const content = readJson(contentPath);
  const featured = readJson(featuredPath);
  if (!featured || !Array.isArray(featured.featured)) {
    console.error("[build] ERROR: src/featured.json must contain a 'featured' array");
    process.exit(1);
  }
  const featuredList = featured.featured;

  /* ---- Load committed cache (fallback) ---- */
  let cache = null;
  try { cache = readJson(cachePath); } catch { cache = null; }
  if (cache) info(`committed cache loaded (fetchedAt ${cache.fetchedAt || "unknown"})`);
  else warn("no committed cache found — first build will render from featured copy only");

  const sources = {
    repos: { status: "error", fetchedAt: null, http: 0 },
    user: { status: "error", fetchedAt: null, http: 0 },
    vocab: { status: "error", fetchedAt: null, http: 0 },
    state: { status: "error", fetchedAt: null, http: 0 },
    lessons: { status: "error", fetchedAt: null, http: 0 },
  };
  let rateLimit = { remaining: null, reset: null };

  /* ---- A: repo list (gates the cache update) ---- */
  const reposRes = await fetchPaged(
    `${API}/users/${USER}/repos?per_page=100&sort=updated`, "repos");
  let fresh = null;
  /* R1: every real vocab commit date from the live fetch, kept as a
     build-time-only local for the constellation (never written to JSON).
     commit_dates in the JSON is the filtered POST list only. */
  let allCommitDates = [];
  if (reposRes.status === "ok") {
    sources.repos = { status: "ok", fetchedAt: startedAt.toISOString(), http: reposRes.http };
    if (reposRes.headers?.remaining) rateLimit.remaining = Number(reposRes.headers.remaining);
    if (reposRes.headers?.reset) rateLimit.reset = new Date(Number(reposRes.headers.reset) * 1000).toISOString();
    fresh = { repos: reposRes.data.map(pickRepo) };
    info(`repos fetched: ${fresh.repos.length} public repos`);
  } else {
    warn(`repos fetch failed (${reposRes.error || "unknown"}) — rendering from cache`);
  }

  /* ---- B, D–H in parallel, only while not rate-limited; each own try/catch ---- */
  if (fresh && !rateLimited) {
    const [userRes, commitsRes, stateRes, lessonsRes, readmeRes] = await Promise.all([
      fetchJson(`${API}/users/${USER}`, "user"),
      fetchJson(`${API}/repos/${USER}/${VOCAB}/commits?per_page=30`, "vocab-commits"),
      (async () => {
        try {
          const r = await fetchOnce(`${RAW}/${USER}/${VOCAB}/main/data/state.json`, "text");
          if (!r.ok) return { status: "error", http: r.status, error: `HTTP ${r.status}` };
          return { status: "ok", http: r.status, data: JSON.parse(r.text) };
        } catch (e) { return { status: "error", http: 0, error: String(e.message || e) }; }
      })(),
      (async () => {
        try {
          const r = await fetchOnce(`${RAW}/${USER}/${VOCAB}/main/data/lessons.json`, "text");
          if (!r.ok) return { status: "error", http: r.status, error: `HTTP ${r.status}` };
          return { status: "ok", http: r.status, data: JSON.parse(r.text) };
        } catch (e) { return { status: "error", http: 0, error: String(e.message || e) }; }
      })(),
      (async () => {
        try {
          const r = await fetchOnce(`${RAW}/${USER}/${VOCAB}/main/README.md`, "text");
          if (!r.ok) return { status: "error", http: r.status, error: `HTTP ${r.status}` };
          return { status: "ok", http: r.status, data: r.text };
        } catch (e) { return { status: "error", http: 0, error: String(e.message || e) }; }
      })(),
    ]);

    if (userRes.status === "ok") {
      sources.user = { status: "ok", fetchedAt: startedAt.toISOString(), http: userRes.http };
      const u = userRes.data;
      fresh.user = {
        login: u.login, id: u.id, avatar_url: u.avatar_url,
        public_repos: u.public_repos, followers: u.followers ?? 0,
        bio: u.bio ?? null, created_at: u.created_at ?? null,
      };
      /* F: avatar download — only if the bytes changed. */
      try {
        const avatarUrl = `${u.avatar_url.split("?")[0]}?v=4&s=320`;
        const a = await fetchOnce(avatarUrl, "buffer");
        if (a.ok) {
          const dest = path.join(ROOT, "assets", "img", "avatar.png");
          const prev = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
          if (!prev || !prev.equals(a.buffer)) {
            fs.writeFileSync(dest, a.buffer);
            info("avatar updated from live profile");
          } else info("avatar unchanged");
        } else warn(`avatar download failed (HTTP ${a.status}) — keeping committed avatar`);
      } catch (e) { warn(`avatar download failed (${e.message}) — keeping committed avatar`); }
    } else warn(`user fetch failed (${userRes.error}) — bio/counts from content.json + cache`);

    /* F5: pushed_at is derived from the repos list (source A), which
       already carries english-vocab-daily's pushed_at — no separate
       vocab-repo call, so that call can never fail on its own. */
    const vocabRepo = fresh.repos.find((r) => r.name === VOCAB);
    sources.vocab = { status: "ok", fetchedAt: startedAt.toISOString(), http: reposRes.http };
    fresh.vocab = { pushed_at: vocabRepo?.pushed_at ?? null };
    if (vocabRepo) info(`vocab pushed_at ${vocabRepo.pushed_at} (derived from repos list)`);
    else warn(`vocab repo "${VOCAB}" not in the live repo list — pushed_at unknown`);

    let lastCommit = null;
    let commitDates = [];
    let stateCommitDates = [];
    if (commitsRes.status === "ok" && Array.isArray(commitsRes.data) && commitsRes.data.length) {
      const c = commitsRes.data[0];
      lastCommit = {
        sha: c.sha, shortSha: c.sha.slice(0, 7),
        date: c.commit?.committer?.date ?? null,
        message: c.commit?.message ?? "",
        url: c.html_url ?? `https://github.com/${USER}/${VOCAB}/commit/${c.sha}`,
      };
      /* R1: the full real commit-date list stays build-time-only (feeds
         the constellation below); it is never written to JSON. */
      allCommitDates = commitsRes.data
        .map((x) => x.commit?.committer?.date)
        .filter(Boolean);
      /* F2: the 7-day strip counts POSTS, not commits. Only a commit whose
         message starts "chore: update state" is a post — the 18 Nov
         "Initial commit" is repo setup, not a post, and must never render
         as a posted day. Dates are filtered to the 7 days before the
         build (startedAt), not the last 7 commits — non-state commits
         interleave, so a count-based window misses earlier posts. */
      stateCommitDates = commitsRes.data
        .filter((x) => (x.commit?.message || "").startsWith("chore: update state"))
        .map((x) => x.commit?.committer?.date)
        .filter(Boolean)
        .filter((d) => new Date(d) >= new Date(startedAt.getTime() - 7 * 24 * 3600 * 1000));
      /* R1: commit_dates carries the same filtered POST list, so a future
         consumer reading it gets post dates, not every commit. */
      commitDates = stateCommitDates;
      info(`latest vocab commit ${lastCommit.shortSha} (${lastCommit.date}); ${stateCommitDates.length} state-update commit(s) in the last 7`);
    } else warn(`vocab commits fetch failed (${commitsRes.error || "empty"})`);
    fresh.vocab = { ...(fresh.vocab || {}), last_commit: lastCommit, commit_dates: commitDates, state_commit_dates: stateCommitDates };

    let state = null;
    if (stateRes.status === "ok") {
      sources.state = { status: "ok", fetchedAt: startedAt.toISOString(), http: stateRes.http };
      state = stateRes.data;
      info(`state.json: last_index ${state.last_index}, last_date ${state.last_date}`);
    } else warn(`state.json fetch failed (${stateRes.error})`);
    fresh.vocab.state = state;

    let lessonCount = null;
    let lastWord = null;
    if (lessonsRes.status === "ok" && Array.isArray(lessonsRes.data)) {
      sources.lessons = { status: "ok", fetchedAt: startedAt.toISOString(), http: lessonsRes.http };
      lessonCount = lessonsRes.data.length;
      info(`lessons.json: ${lessonCount} lessons in the bank`);
      if (state && typeof state.last_index === "number") {
        const lesson = lessonsRes.data[state.last_index];
        if (lesson) {
          lastWord = {
            word: lesson.word, meaning: lesson.meaning ?? "",
            phonetic: lesson.phonetic ?? "", example: lesson.example ?? "",
            type: lesson.type ?? "",
            quiz_q: lesson.quiz_q ?? "",
            quiz_options: Array.isArray(lesson.quiz_options) ? lesson.quiz_options : [],
          };
          info(`last posted lesson #${state.last_index}: "${lesson.word}"`);
        }
      }
      if (readmeRes.status === "ok") {
        const m = String(readmeRes.data).match(/([\d,]+)\s+lessons/);
        if (m) {
          const claimed = Number(m[1].replace(/,/g, ""));
          if (claimed !== lessonCount) {
            warn(`LESSON COUNT MISMATCH (O5): README claims ${claimed} lessons, lessons.json has ${lessonCount} — showing the fetched value ${lessonCount}`);
          } else info(`lesson count matches README (${lessonCount})`);
        }
      }
    } else warn(`lessons.json fetch failed (${lessonsRes.error})`);
    fresh.vocab.lessonCount = lessonCount;
    fresh.vocab.lastWord = lastWord;
  } else if (fresh && rateLimited) {
    warn("rate-limited — skipping sources B, D–H, using cache values for them");
  }

  /* ---- Assemble data: fresh where fetched, cache where not ---- */
  const now = new Date();
  let data;
  let dataStale;
  let fetchedAt;
  if (fresh) {
    const cachedVocab = cache?.vocab || {};
    const vocab = {
      pushed_at: fresh.vocab?.pushed_at ?? cachedVocab.pushed_at ?? null,
      last_commit: fresh.vocab?.last_commit ?? cachedVocab.last_commit ?? null,
      commit_dates: fresh.vocab?.commit_dates?.length ? fresh.vocab.commit_dates : (cachedVocab.commit_dates || []),
      state_commit_dates: fresh.vocab?.state_commit_dates?.length ? fresh.vocab.state_commit_dates : (cachedVocab.state_commit_dates || []),
      state: fresh.vocab?.state ?? cachedVocab.state ?? null,
      lessonCount: fresh.vocab?.lessonCount ?? cachedVocab.lessonCount ?? null,
      lastWord: fresh.vocab?.lastWord ?? cachedVocab.lastWord ?? null,
    };
    const repos = fresh.repos;
    const languages = [...new Set(repos.map((r) => r.language).filter(Boolean))];
    const lastPush = repos.reduce((max, r) => (!max || (r.pushed_at && r.pushed_at > max) ? r.pushed_at : max), null);
    data = {
      fetchedAt: startedAt.toISOString(),
      dataStale: false,
      sources,
      user: fresh.user ?? cache?.user ?? { login: USER, public_repos: repos.length, followers: 0, bio: content.site.bio },
      repos,
      vocab,
      stats: {
        total_repos: repos.length,
        total_stars: repos.reduce((s, r) => s + (r.stargazers_count || 0), 0),
        total_forks: repos.reduce((s, r) => s + (r.forks_count || 0), 0),
        languages,
        lastPush,
      },
    };
    fetchedAt = startedAt.toISOString();
    dataStale = false;
    /* Cache updates ONLY on a successful fetch (source A). */
    const newCache = { ...data };
    if (JSON.stringify(newCache) !== JSON.stringify(cache)) {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(newCache, null, 2) + "\n");
      info("committed cache updated");
    } else info("committed cache already up to date");
    /* Featured-vs-live checks. A featured repo missing from the live list
       renders from featured copy WITH a visible stale label on its card
       (F5 label path) — never silently as if live. */
    const missingFeatured = new Set();
    for (const f of featuredList) {
      if (!repos.some((r) => r.name === f.repo)) {
        warn(`featured repo "${f.repo}" not found in the live repo list — card renders from featured copy with a stale label`);
        missingFeatured.add(f.repo);
      }
    }
    for (const r of repos) {
      if (r.name !== USER && !featuredList.some((f) => f.repo === r.name)) {
        info(`new public repo not in featured list: "${r.name}" — it appears in counts and the ticker, not as a featured card`);
      }
    }
  } else {
    /* No fresh fetch: render from cache, honestly labelled stale. */
    if (cache && Array.isArray(cache.repos)) {
      data = { ...cache, dataStale: true };
      fetchedAt = cache.fetchedAt || null;
      dataStale = true;
      warn(`rendering from committed cache (fetchedAt ${fetchedAt}) — dataStale: true`);
      for (const [k, v] of Object.entries(sources)) {
        if (v.status === "error" && cache.sources?.[k]?.status === "ok") {
          data.sources[k] = { ...cache.sources[k], status: "stale" };
        }
      }
    } else {
      /* No cache at all (first-ever build): render from featured copy,
         numbers omitted rather than invented. */
      warn("no cache available — rendering featured cards from featured copy only, live numbers omitted");
      data = {
        fetchedAt: null, dataStale: true, sources,
        user: { login: USER, public_repos: featuredList.length, followers: 0, bio: content.site.bio },
        repos: [],
        vocab: { pushed_at: null, last_commit: null, commit_dates: [], state_commit_dates: [], state: null, lessonCount: null, lastWord: null },
        stats: { total_repos: null, total_stars: null, total_forks: null, languages: [], lastPush: null },
      };
      fetchedAt = null;
      dataStale = true;
    }
  }
  /* dataStale is also true when fetchedAt is more than 12h old. */
  if (fetchedAt) {
    const ageH = (now - new Date(fetchedAt)) / 3600000;
    if (ageH > 12) { data.dataStale = true; dataStale = true; warn(`fetched data is ${ageH.toFixed(1)}h old — marking stale`); }
  }
  const cacheAgeHours = fetchedAt ? Math.max(0, Math.round(((now - new Date(fetchedAt)) / 3600000) * 10) / 10) : null;

  /* ---- Render index.html ---- */
  const template = fs.readFileSync(templatePath, "utf8");
  const byName = new Map(data.repos.map((r) => [r.name, r]));
  const vocab = data.vocab || {};
  const stats = data.stats || {};

  /* Stats strip: repos, lessons, posts/day, last push. */
  const statItems = [
    { label: content.stats.labels.repos, value: stats.total_repos, note: null },
    { label: content.stats.labels.lessons, value: vocab.lessonCount, note: null },
    { label: content.stats.labels.postsPerDay, value: 2, note: content.stats.postsPerDayNote },
    { label: content.stats.labels.lastPush, value: stats.lastPush ? fmtDate(stats.lastPush) : null, note: null },
  ];
  const statsHtml = statItems.map((s) => {
    const num = s.value === null || s.value === undefined
      ? `<span class="stat-number">—</span>`
      : typeof s.value === "number"
        ? `<span class="stat-number" data-count="${s.value}">${s.value}</span>`
        : `<span class="stat-number">${esc(s.value)}</span>`;
    return `        <div class="stat">${num}<span class="stat-label">${esc(s.label)}</span>${s.note ? `<span class="stat-note">${esc(s.note)}</span>` : ""}</div>`;
  }).join("\n");

  /* Repo cards from featured.json + live meta from the API. */
  const cardsHtml = featuredList.map((f) => {
    const live = byName.get(f.repo);
    const lang = live?.language || (f.stack && f.stack[0]) || null;
    const updated = live?.pushed_at ? fmtDate(live.pushed_at) : null;
    const meta = live
      ? `${live.stargazers_count} stars · ${live.forks_count} forks · Updated ${updated}`
      : `Updated —`;
    const stack = (f.stack || []).map((s) => `<li>${esc(s)}</li>`).join("");
    /* F5 label path: a featured repo missing from the live list renders
       from featured copy with a visible stale label on its card. */
    const staleLabel = !live
      ? `          <p class="card-meta stale-label">Live data unavailable — showing project information from the site.</p>\n`
      : "";
    let proof = "";
    if (f.flagship) {
      const nextLine = `<dt>Next post</dt><dd><span id="next-post">07:15 / 17:15 UTC daily</span></dd>`;
      const lastLine = vocab.state
        ? `<dt>Latest lesson posted</dt><dd>#${esc(String(vocab.state.last_index))}${vocab.lastWord ? ` — ${esc(vocab.lastWord.word)} (${esc(vocab.lastWord.type)})` : ""} · ${esc(fmtDate(vocab.state.last_date))}</dd>`
        : "";
      proof = `          <dl class="live-proof">${nextLine}${lastLine}</dl>\n`;
    }
    return `        <article class="card reveal">
          <h3><a href="${esc(f.repoUrl)}">${esc(f.title)}</a></h3>
          <p class="one-line">${esc(f.oneLine)}</p>
          <p class="intro">${esc(f.intro)}</p>
${proof}          <ul class="stack-tags">${stack}</ul>
          <p class="card-meta"><span class="lang-dot" data-lang="${esc(lang || "")}"></span><span class="role">${esc(f.role)}</span> · ${esc(lang || "—")}</p>
          <p class="result"><strong>Result:</strong> ${esc(f.result)}</p>
          <p class="card-meta">${esc(meta)}</p>
${staleLabel}          <p class="card-links"><a href="${esc(f.repoUrl)}">View ${esc(f.repo)} on GitHub &rarr;</a></p>
        </article>`;
  }).join("\n");

  /* F6 (design-plan 3.4): the left panel renders the artefact itself —
     the most recent posted word as a Telegram-style message card, and the
     evening quiz question for the same lesson from lessons.json — not a
     metadata table. The remaining proof rows (lesson count, last commit,
     last activity) stay below as a compact list. */
  const w = vocab.lastWord;
  let msgCardHtml = "";
  if (w && vocab.state) {
    const pos = w.type ? `<span class="msg-pos">${esc(w.type)}</span>` : "";
    const phonetic = w.phonetic ? `<span class="msg-phonetic">${esc(w.phonetic)}</span>` : "";
    const example = w.example ? `<p class="msg-example">&ldquo;${esc(w.example)}&rdquo;</p>` : "";
    msgCardHtml = `          <div class="msg-card">
            <p class="msg-meta">Posted ${esc(fmtDate(vocab.state.last_date))} &middot; Lesson #${esc(String(vocab.state.last_index))}</p>
            <p class="msg-word">${esc(w.word)} ${pos} ${phonetic}</p>
            <p class="msg-def">${esc(w.meaning)}</p>
${example}
          </div>`;
  } else if (vocab.state) {
    msgCardHtml = `          <p class="msg-fallback">Latest lesson posted: #${esc(String(vocab.state.last_index))} &middot; ${esc(fmtDate(vocab.state.last_date))}.</p>`;
  }
  let quizCardHtml = "";
  if (w?.quiz_q && Array.isArray(w.quiz_options) && w.quiz_options.length) {
    const options = w.quiz_options.map((o) => `              <li>${esc(o)}</li>`).join("\n");
    quizCardHtml = `          <div class="quiz-card">
            <p class="quiz-label">Evening quiz &middot; 17:15 UTC</p>
            <p class="quiz-question">${esc(w.quiz_q)}</p>
            <ol class="quiz-options">
${options}
            </ol>
          </div>`;
  }

  /* Automation proof list (F4: <div> wrappers — a <dl> may only contain
     <dt>/<dd> groups or <div> wrappers, never <li>). */
  const proofRows = [];
  if (vocab.lessonCount !== null && vocab.lessonCount !== undefined) {
    proofRows.push([content.automation.proofLabels.lessons, esc(String(vocab.lessonCount))]);
  }
  proofRows.push([content.automation.proofLabels.schedule, "07:15 and 17:15 UTC, daily"]);
  if (vocab.last_commit) {
    proofRows.push([
      content.automation.proofLabels.lastCommit,
      `${esc(fmtDateTime(vocab.last_commit.date))} — <a href="${esc(vocab.last_commit.url)}">${esc(vocab.last_commit.message)}</a>`,
    ]);
  }
  if (vocab.pushed_at) {
    proofRows.push(["Last activity", `Pushed ${esc(fmtDateTime(vocab.pushed_at))}`]);
  }
  const proofHtml = proofRows.map(([k, v]) => `            <div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("\n");

  /* 7-day strip from STATE-UPDATE commit dates only (F2). A legacy cache
     without state_commit_dates falls back to state.last_date — the state
     file itself is proof a post happened on that date. */
  const stateDates = new Set(
    (vocab.state_commit_dates || []).map((d) => d.slice(0, 10))
  );
  const endDate = vocab.state?.last_date ? new Date(`${vocab.state.last_date}T12:00:00Z`) : now;
  const dayItems = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(endDate);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const posted = stateDates.has(iso) || iso === vocab.state?.last_date;
    /* A9: the posted state is not colour-only — posted days carry a
       visually-hidden "Posted" label. */
    const postedLabel = posted ? `<span class="visually-hidden">Posted</span>` : "";
    dayItems.push(`            <li><span class="day-dot${posted ? " posted" : ""}">${postedLabel}</span><span class="day-name">${DAYS[d.getUTCDay()]}</span></li>`);
  }
  const dayHtml = dayItems.join("\n");

  /* Ticker: repos by pushed_at, newest first, max 5. */
  const tickerRepos = [...(data.repos || [])]
    .filter((r) => r.pushed_at)
    .sort((a, b) => (a.pushed_at < b.pushed_at ? 1 : -1))
    .slice(0, 5);
  const tickerHtml = tickerRepos.length
    ? tickerRepos.map((r) => `          <li>Pushed to <a href="${esc(r.html_url)}">${esc(r.name)}</a> — ${esc(fmtDate(r.pushed_at))}</li>`).join("\n")
    : `          <li>No recent public activity to show — <a href="${esc(content.site.github)}">see everything on GitHub</a>.</li>`;

  /* Steps. */
  const stepsHtml = (content.how.steps || []).map((s, i) =>
    `        <li class="step reveal"><span class="step-number">${i + 1}</span><h3>${esc(s.title)}</h3><p>${esc(s.body)}</p></li>`
  ).join("\n");

  /* Constellation points: push dates + commit dates, deterministic layout.
     Uses every real commit date from the live fetch (allCommitDates) when
     available — the Initial commit is genuine repo activity, so it still
     earns a point here; commit_dates in the JSON is the filtered POST list
     only (R1). Falls back to vocab.commit_dates on a stale/cache build. */
  const pointDates = [
    ...(data.repos || []).map((r) => r.pushed_at).filter(Boolean),
    ...(allCommitDates.length ? allCommitDates : (vocab.commit_dates || [])),
  ].sort();
  const points = pointDates.map((d, i) => {
    const x = pointDates.length === 1 ? 0.5 : 0.08 + (0.84 * i) / (pointDates.length - 1);
    let h = 0;
    for (const ch of d) h = (h * 31 + ch.charCodeAt(0)) % 1000;
    const y = 0.2 + (h % 600) / 1000;
    return [Number(x.toFixed(3)), Number(y.toFixed(3))];
  });
  /* Never synthesise points (PLAN section 7): with zero real push points
     the constellation is empty and main.js hides the canvas. */
  const constellationJson = JSON.stringify(points);

  /* Freshness line + footer line. */
  const freshness = dataStale
    ? `<span class="status-stale">Data may be stale</span> — Showing last known data from ${esc(fetchedAt ? fmtDateTime(fetchedAt) : "an earlier check")} — GitHub was unreachable at the last update. The site will refresh automatically.`
    : `<span class="status-live"><span class="live-dot" aria-hidden="true"></span>Live</span> Live data · Updated ${esc(fmtDateTime(fetchedAt))}`;
  const footerUpdated = fetchedAt
    ? `Data updated ${esc(fmtDateTime(fetchedAt))}${dataStale ? " — data may be stale" : ""}`
    : "Live data unavailable — showing project information from the site.";

  /* Scalar tokens: content.json flattened + data values. */
  const tokens = flat(content, "", {});
  tokens["data.lessonCount"] = vocab.lessonCount !== null && vocab.lessonCount !== undefined ? String(vocab.lessonCount) : "—";
  tokens["data.lastPush"] = stats.lastPush ? fmtDate(stats.lastPush) : "—";
  tokens["data.fetchedAt"] = fetchedAt || "";
  tokens["FEATURED_POST_SCRIPT_URL"] = featuredList[0]?.postScriptUrl || `https://github.com/${USER}/${VOCAB}`;

  const fragments = {
    STATS: statsHtml,
    REPO_CARDS: cardsHtml,
    MSG_CARD: msgCardHtml,
    QUIZ_CARD: quizCardHtml,
    PROOF_LIST: proofHtml,
    DAY_STRIP: dayHtml,
    TICKER_ITEMS: tickerHtml,
    STEPS: stepsHtml,
    CONSTELLATION_POINTS: constellationJson,
    FRESHNESS_LINE: freshness,
    FOOTER_UPDATED: footerUpdated,
  };
  let html = template;
  for (const [k, v] of Object.entries(fragments)) html = html.split(`{{${k}}}`).join(v);
  /* Multi-pass scalar replacement (content values may contain data tokens). */
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const [k, v] of Object.entries(tokens)) {
      const t = `{{${k}}}`;
      if (html.includes(t)) { html = html.split(t).join(v); changed = true; }
    }
    if (!changed) break;
  }
  const unresolved = [...html.matchAll(/\{\{([A-Za-z0-9_.]+)\}\}/g)].map((m) => m[0]);
  if (unresolved.length) {
    console.error(`[build] ERROR: unresolved template tokens: ${[...new Set(unresolved)].join(", ")}`);
    process.exit(1);
  }
  if (/null|undefined|NaN/.test(html.replace(/<code>[\s\S]*?<\/code>/g, ""))) {
    /* The code panel legitimately contains no such words; anything else is
       a rendering leak. Warn loudly but do not fail the deploy. */
    warn("rendered HTML contains a literal null/undefined/NaN outside code panels — check the output");
  }

  /* ---- Write dist/ ---- */
  const dist = path.join(ROOT, "dist");
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(path.join(dist, "data"), { recursive: true });
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), html);
  const projectsJson = { ...data, generatedAt: now.toISOString() };
  fs.writeFileSync(path.join(dist, "data", "projects.json"), JSON.stringify(projectsJson, null, 2) + "\n");

  /* nextRefresh: next 07:30 or 17:30 UTC. */
  const nextRefresh = new Date(now);
  const mk = (h, m) => { const d = new Date(now); d.setUTCHours(h, m, 0, 0); return d; };
  let nr = mk(7, 30);
  if (nr <= now) nr = mk(17, 30);
  if (nr <= now) { nr = mk(7, 30); nr.setUTCDate(nr.getUTCDate() + 1); }
  const status = {
    site: "liveforge",
    generatedAt: now.toISOString(),
    dataStale,
    fetchedAt: fetchedAt || null,
    nextRefresh: nr.toISOString(),
    sources,
    rateLimit,
    cacheAgeHours,
  };
  fs.writeFileSync(path.join(dist, "status.json"), JSON.stringify(status, null, 2) + "\n");

  const siteUrl = content.site.url;
  const today = now.toISOString().slice(0, 10);
  fs.writeFileSync(path.join(dist, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${esc(siteUrl)}</loc>\n    <lastmod>${today}</lastmod>\n  </url>\n</urlset>\n`);
  fs.writeFileSync(path.join(dist, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${siteUrl}sitemap.xml\n`);
  for (const f of ["_headers", "_redirects"]) {
    const src = path.join(ROOT, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dist, f));
    else warn(`repo-root ${f} not found — skipping`);
  }
  fs.cpSync(path.join(ROOT, "assets"), path.join(dist, "assets"), { recursive: true });

  info(`build complete: dist/ written, dataStale=${dataStale}, fetchedAt=${fetchedAt || "none"}`);
  info(`repos=${data.repos.length} lessonCount=${vocab.lessonCount ?? "unknown"} lastPush=${stats.lastPush || "unknown"}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`[build] ERROR: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
