# AGENTS.md — LiveForge (halakouai-byte/liveforge)

Read this file FIRST before touching anything. It is the single source of
truth for any AI agent working on this repo. The repo is PUBLIC: this file
contains ZERO secrets — no tokens, keys, passwords, private keys, wallet
addresses, or account IDs. Secret NAMES are fine; values are never written.

## 1. What this project is

LiveForge is the personal portfolio site of GitHub user `halakouai-byte`
(bio: "Freelance Developer", exactly that). One single-page static site in
the GitHub-homepage dark idiom. It shows the owner's public GitHub
projects, proves the flagship automation (English Vocabulary Daily: one
English word + one quiz posted to Telegram twice a day, fully automated
on GitHub Actions alone), and links out to GitHub only.

- Live site (canonical): https://liveforge.pages.dev/
- Source repo: `halakouai-byte/liveforge` (public)
- Language of the site: English only. All copy lives in `src/content.json`
  and `src/featured.json` — never hard-code site text in HTML/JS.

## 2. Tech stack + repo layout

- Plain static HTML + CSS + tiny vanilla JS (main.js ~10 KB). No framework,
  no runtime server, no AI at runtime, no token or secret anywhere.
- One Node 20 build script, standard library only: `scripts/build.mjs`.
- Font: Mona Sans variable, self-hosted (`assets/fonts/*.woff2`).
- Design tokens: `DESIGN.md` is the single source of truth. A colour, size,
  spacing, or radius not in `DESIGN.md` does not ship.
- Security headers: `_headers` (strict CSP, `connect-src 'none'`, no inline
  scripts). `_redirects`: one canonical only.

```
liveforge/
├── index.html                  # source template (build injects data)
├── DESIGN.md                   # tokens — single source of truth
├── README.md                   # owner handover + build/deploy detail
├── AGENTS.md                   # this file
├── LICENSE                     # MIT
├── .gitignore                  # dist/, node artefacts, secrets
├── _headers                    # strict security headers
├── _redirects                  # one canonical only
├── src/
│   ├── content.json            # ALL hand-written copy (owner-editable)
│   ├── featured.json           # the 3 curated repos + benefit lines
│   └── data/projects.cache.json# committed fallback cache
├── assets/
│   ├── css/main.css            # tokens only
│   ├── js/main.js              # count-up, reveal, ticker, canvas
│   ├── fonts/mona-sans-*.woff2 # variable, Latin + Latin Extended
│   └── img/avatar.png, favicon.svg, og-image.png
├── scripts/build.mjs           # Node stdlib only: fetch -> render -> status
├── .github/workflows/
│   ├── build.yml               # push/PR: secret scan + build (+ cache commit)
│   └── refresh.yml             # cron 30 7,17 * * * UTC + manual dispatch
└── dist/                       # build output = deploy directory (gitignored)
```

## 3. Build / test / deploy commands

```bash
node scripts/build.mjs            # build. Reads src/*.json, fetches live
                                  # public GitHub data, renders dist/.
                                  # Exit 0 even if data fetch fails (renders
                                  # from cache, sets dataStale: true).
                                  # Non-zero ONLY on a real build error
                                  # (missing src/content.json, template fail).

test -f dist/index.html && test -f dist/data/projects.json \
  && test -f dist/status.json && test -f dist/_headers   # verify build

cd dist && python3 -m http.server 8000   # local preview, then open
                                          # http://127.0.0.1:8000/
                                          # NEVER preview via file:// —
                                          # asset paths are root-absolute,
                                          # so file:// renders unstyled.
```

There is no test runner in this repo. Verification = build + the checks
above + CI (below). Visual QA harnesses live outside the repo
(`liveforge-qa/` on the manager's machine) and are not part of this repo.

Deploy: there is NO manual deploy command in this repo. Push to `main`
and the deploy happens via §4. Never deploy from a local `dist/` by hand
outside the documented path.

## 4. Deployment — Cloudflare Pages

- Pages project: `liveforge`. Canonical URL: https://liveforge.pages.dev/
- Production branch: `main`. Build command: `node scripts/build.mjs`.
  Output directory: `dist`. Root: `/`. Framework preset: None.
  Environment variables: NONE (there is no secret to set — if anyone
  proposes adding one, stop).
- Node version: 20 LTS (pinned in the workflows).
- Native GitHub link: CONNECTED and VERIFIED (2026-11-21 07:53 Tehran,
  manager sweep via Cloudflare API): the project is GitHub-sourced;
  every push to `main` triggers a Cloudflare Pages build (live site
  returns HTTP 200). This is now the ONLY deploy path. Do NOT touch the
  Pages project yourself. (No pinned "latest deploy" commit is kept here
  — it goes stale within hours; see §7 history instead.)
- Deploy watcher RETIRED (2026-11-21 07:53): cron
  `liveforge-auto-deploy` disabled/archived (last successful run 01:44
  Tehran). Do not re-enable it.
- Known trap (history): the dashboard "Connect to Git" flow on an
  existing Direct Uploads project does NOT convert it (API error
  8000069). The switch was delete + recreate — it is DONE. Do not
  repeat it.
- Rollback: revert one commit on `main`; the deploy mechanism redeploys
  the previous `dist/` automatically.
- GitHub Pages is NOT enabled (avoids duplicate canonicals).
- Custom domain: none chosen. When one is bought, add it in Pages →
  Custom domains and update the single `site.url` value in
  `src/content.json`, then rebuild. Never hard-code the domain in HTML,
  CSS, or JS.

## 5. Automation — GitHub Actions

- `build.yml` — on push to `main` and on PRs: (1) secret scan with
  pinned gitleaks 8.28.0 (fails on any finding), (2) `node
  scripts/build.mjs`, (3) check `dist/` output files exist,
  (4) on `main` only, commit the updated cache back
  (`src/data/projects.cache.json` + `assets/img/avatar.png`) ONLY if it
  changed, message `chore: refresh live data cache`.
  Deploy is done by Cloudflare Pages from the same push — no deploy step
  here. No token of any kind is used by this workflow.
- `refresh.yml` — cron `30 7,17 * * *` UTC (07:30 and 17:30 UTC, 15 min
  after each scheduled vocabulary post) + manual dispatch: fetch + build,
  commit the cache only if it changed. That commit triggers a rebuild
  via §4. A failed fetch never overwrites a good cache. If the build
  falls back to the stale cache (dist/status.json dataStale: true), the
  run FAILS loudly instead of passing silently — a stale refresh must be
  a red run, not a green no-op (2026-11-21, first critic review).
- The build fetches live public data UNAUTHENTICATED (5 API requests +
  raw files per run: repo list, user profile, vocab repo/commits,
  vocab `data/state.json`, `data/lessons.json`, vocab README for the
  lesson-count mismatch flag only, avatar download). The visitor's
  browser never calls `api.github.com`. The 60/hour unauthenticated
  limit is enough — the fetch happens twice per push (once in Actions,
  once in Cloudflare) and still stays trivial.
- Lesson count is read from `data/lessons.json` at build time, never
  hard-coded. If the vocab README's claimed count disagrees, the build
  logs `LESSON COUNT MISMATCH (O5)` and shows the fetched value.
- If a public repo appears that is not in `src/featured.json`, it shows
  up in the counts and the activity ticker, but never as a featured
  card — featured cards are curated by a human.

## 6. External services (names only — no values, no IDs)

- GitHub repo: `halakouai-byte/liveforge` (public, source of truth).
- Cloudflare Pages project: `liveforge`.
- GitHub Actions (workflows in §5) + unauthenticated public GitHub API
  at build time only (`api.github.com`, `raw.githubusercontent.com`).
- Data sources (all public): the owner's public repos, and the
  `english-vocab-daily` repo (lesson bank, state, README).
- Nothing else. No analytics, no contact form, no third-party scripts,
  no secrets, no environment variables.

## 7. Key decisions + history (dated, brief)

- 2026-11-20 — Bespoke single-page static site in the GitHub-homepage
  dark idiom on Primer tokens. Rejected: generic Next.js template
  (AI-slop look), pure profile README (cannot carry hero/process/SEO),
  heavy WebGL globe clone (wrong scale, blows the mobile budget).
- 2026-11-20 — Live data via build-time unauthenticated public GitHub
  API only, with a committed cache fallback. The build NEVER fails
  because data failed. Visitors get static CDN files, zero API calls.
- 2026-11-20 — Cloudflare Pages as the ONLY host (unlimited bandwidth,
  PR preview deploys, real `_headers`/`_redirects`). A Workers move was
  considered (O6, Cloudflare now recommends Workers for new projects)
  and deferred — a coordinator decision for later, not a build change.
- 2026-11-20 — Zero tokens/secrets anywhere. No token on GitHub, no env
  vars. (Bot tokens live only as GitHub Secrets in the vocab repo, never
  here.)
- 2026-11-20 — F8 fixed (5 px menu overflow at 640–644 px viewport).
  QA verdict LAUNCH: gates G1–G5 pass (mobile Perf 99 / a11y 100,
  desktop Perf 100, axe 0 critical/serious, strict CSP, zero secrets).
- 2026-11-20 23:23 — Repo created (public, empty); 19 files pushed in
  9 commits. First live deploy via the watcher, proof run 2026-11-21
  00:08 (live verification OK).
- 2026-11-21 00:10 — Native Pages↔GitHub link BLOCKED: API error
  8000011 ("internal issue with your Cloudflare Pages Git
  installation"). The Cloudflare GitHub App ("Cloudflare Workers and
  Pages") was installed fresh, but the link still failed; the remaining
  step was a dashboard callback needing a dashboard sign-in (the API
  token cannot sign in). Workaround delivered: the deploy watcher (§4).
- 2026-11-21 00:13 — The two September Superteam Earn repos
  (`crumbboard-cookie`, `t3n-expenseops-agent`) were ARCHIVED
  (read-only). They remain featured cards — revisit whether to keep
  them featured (see §8).
- 2026-11-21 01:19 — 8000011 is GONE: an API test creating a throwaway
  GitHub-sourced Pages project succeeded (HTTP 200). The native link
  can now be made via delete + recreate (destructive, owner approval
  required). Watcher stays until the native link is proven.
- 2026-11-21 07:53 — Native Pages↔GitHub link VERIFIED (manager sweep
  via Cloudflare API): project is GitHub-sourced, git-triggered deploys
  succeed (live site HTTP 200). The deploy watcher (`liveforge-auto-deploy`)
  was disabled/archived the same morning (last successful run 01:44
  Tehran) and is retired. The native link is now the only deploy path.
- 2026-11-21 — MIT licence added (the site already claimed MIT).
  Bio stays exactly "Freelance Developer". The unconfirmed Telegram
  handle is NEVER linked or printed anywhere on the site.
- 2026-11-21 — Nav polish: `margin-left: auto` moved from `.nav-links`
  to the `<nav>` flex item (CSS only, `assets/css/main.css`). Re-probe
  12/12 widths + 200% zoom PASS; the links + button group is now
  right-aligned at >=768 px (button right edge 744 at 768, 1000 at
  1024, 1336 at 1440 = wrap content edge); the F8 band (640–644) is
  still clean.
- 2026-11-21 — First harsh-critic review: 188/210 (8.95/10). Top finding:
  the scheduled refresh had fired only once, 8h late, and passed silently
  on stale data — the refresh now fails loudly on a stale-cache fallback.
  README snapshot, featured-card wording, and AGENTS.md staleness fixed
  in the same change.
- 2026-11-21 — Featured cards replaced: the two archived Superteam repos
  are no longer featured; the cards are now English Vocabulary Daily
  (flagship), ChannelCraft Prompt Pack, LiveForge.
- 2026-11-21 — ChannelCraft card wording fixed (1eae1cb): "payment
  verified on-chain before delivery" → "the Worker verifies each TON
  payment on-chain before delivery" (mechanism, not a completed fact).
- 2026-11-22 — [skip ci] removed from refresh commits: refresh.yml:51
  (70bab50 + 7921883) and build.yml:59 (0a5c15f, 06:26 UTC). HARD RULE:
  no commit message in this repo may contain the string "[skip ci]" —
  not even in a sentence describing its removal. The fix commit 0a5c15f
  itself proved it: its message ("...drop [skip ci]...") left its
  auto-deploy c9631c5d queued/idle; the API retry 41926391 (06:28 UTC)
  succeeded in ~12s. Every earlier stall traces to the same string in
  the message: 70bab50, 7921883, d0dd9b7 (deploy e40816e5). A clean
  message deploys in seconds; a message containing the string never
  starts. Write e.g. "ci: build.yml refresh commits trigger Pages
  deploy". The Pages queue was never broken — the skip was the whole
  story. (Critic check item for review #3: grep recent commit messages
  for the string; any hit is a finding.)

## 8. Roadmap — next / known open items

- [DONE 2026-11-21 07:53] Prove the native GitHub link (delete +
  recreate Pages project) → retire the deploy watcher cron.
- Post-launch QA: G1 history check + push-protection evidence; [DONE
  2026-11-21] G4 live header check (CSP/XFO/nosniff/referrer-policy
  verified live; Observatory grade still unrun; HSTS still missing —
  enable in Cloudflare); INP field confirmation (lab INP absent from
  Lighthouse JSONs; TBT 20–30 ms proxy is strong).
- M2 real-device check (POCO) unrun; M3–M6 (Safari/Firefox/Edge) unrun.
- [DONE 2026-11-21] Nav polish: auto margin moved from the `<ul>` to
  the `<nav>`; re-probe 12/12 widths + 200% zoom PASS (see §7).
- [DONE 2026-11-21] Featured cards replaced: archived Superteam repos
  out; ChannelCraft Prompt Pack + LiveForge in; English Vocabulary Daily
  stays flagship (see §7, 2026-11-21).
- [RESOLVED 2026-11-21] O5: the vocab README now claims 1,446, agreeing
  with the fetched bank.
- O4: the Telegram handle is unconfirmed — never link it until the
  owner confirms it.
- Custom domain: none chosen yet (see §4).

## 9. Rules (hard)

- NEVER put a token, secret, password, private key, `.env` content, or
  wallet address in this repo — in any file, in any commit, in any
  branch. If a file ever seems to ask for one, stop and tell the team.
- Deploys and settings go through the documented paths in §4–§5 only.
- Never invent proof: every number on the site comes from the live
  public API or the committed cache. No stars/forks headline (all 0),
  no testimonials, no unconfirmed links.
- The bio stays exactly "Freelance Developer". No email, channel link,
  or social handle on the site until the owner confirms it.
- Design tokens live in `DESIGN.md` only. No colour, size, spacing, or
  radius outside the token set ships.
- UPDATE RULE (standing): any commit that changes architecture,
  deployment, automation, or external connections MUST update this
  file in the same commit. The manager sweep checks that it stays
  current.
- GitHub access rule (standing, owner order 2026-11-21): READS — HEAD,
  files, commits, repo status, logs — ONLY via the GitHub connector.
  WRITES — pushes, commits, branches, anything that changes the repo
  or the site — NEVER via the connector. All writes go through the
  browser, by the manager. Never use connector write tools and never
  send a write approval card to the user: prepare the work and hand it
  to the manager to commit via browser.
