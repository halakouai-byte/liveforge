# LiveForge — halakouai-byte — Freelance Developer

A single-page personal portfolio site. Plain static HTML + CSS + tiny
vanilla JS, plus one Node (standard library only) build script that pulls
live public GitHub data at build time. No framework, no runtime server,
no AI at runtime, no token or secret anywhere.

- Live site (canonical, until a custom domain is chosen):
  https://liveforge.pages.dev/
- Source repo: `halakouai-byte/liveforge` (public)
- Design tokens: `DESIGN.md` — the single source of truth. If a colour,
  size, spacing, or radius is not in `DESIGN.md`, it does not ship.

## Owner handover — how to edit the site text

You can change the words on the site without touching code, in the GitHub
web UI:

1. Open the repo, go to `src/content.json`, press the pencil icon (Edit).
2. Change only the text between the quote marks — for example the hero
   headline (`"headline": "I build small systems that run themselves."`).
   Keep the quotes and commas exactly as they are.
3. Press "Commit changes". The site rebuilds automatically.
4. The three project cards live in `src/featured.json` the same way.

What NOT to touch:

- Anything in `assets/`, `scripts/`, `.github/workflows/`, `dist/`,
  `_headers`, `_redirects`, `index.html`, `DESIGN.md`, or this file —
  those are the site's machinery. Ask the build team before changing them.
- Never paste a password, token, or secret into any file. The site needs
  none. If a file ever asks for one, stop and tell the team.
- The bio stays exactly "Freelance Developer".
- Do not add a channel link, email address, or social handle unless you
  have confirmed it yourself — the site ships with GitHub as the only
  contact path until you say otherwise.

## How the build works

```
node scripts/build.mjs
```

- Reads `src/content.json` + `src/featured.json` (all hand-written copy).
- Fetches live public data, unauthenticated (5 API requests + raw files):
  repo list, user profile, vocab repo, vocab latest commits, vocab
  `data/state.json`, `data/lessons.json` (lesson count + last posted word),
  vocab README (lesson-count claim, for the mismatch flag only).
  The visitor's browser never calls `api.github.com`.
- Renders `dist/index.html`, writes `dist/data/projects.json` and
  `dist/status.json`. `dist/` is the deploy directory.
- The build NEVER fails because data failed: on any API failure it renders
  from the committed cache `src/data/projects.cache.json`, sets
  `dataStale: true`, labels the page honestly, and exits 0. It exits
  non-zero only for a real build error (missing `src/content.json`,
  template failure).
- The cache updates ONLY on a successful fetch. A failed run never
  overwrites a good cache.
- Lesson count is read from `data/lessons.json` at build time, never
  hard-coded. If the README's claimed count disagrees, the build logs
  `LESSON COUNT MISMATCH (O5)` and shows the fetched value.
- If a public repo appears that is not in `src/featured.json`, it shows up
  in the counts and the activity ticker, but never as a featured card —
  featured cards are curated by a human.

## Deploy — Cloudflare Pages

The site deploys natively: the Cloudflare Pages project `liveforge` is connected to this repo on GitHub — every push to `main` triggers a Cloudflare build (`node scripts/build.mjs`, output `dist/`) and deploys automatically. No secret is stored on GitHub. Environment variables: **none** (there is no secret to set — if anyone proposes adding one, stop).

- Node version: **20 LTS** (pinned in the workflows; the build uses Node 20 `fetch` + `AbortSignal.timeout`).
- The build runs on Cloudflare Pages on push; `.github/workflows/build.yml` still runs its scan + build checks on push/PR, and commits the cache on `main` when it changed.
- Refresh: `.github/workflows/refresh.yml` runs at 07:30 and 17:30 UTC (15 minutes after each scheduled vocabulary post) and commits the cache only if it changed; that commit triggers a Cloudflare rebuild.
- Rollback: revert one commit on `main`; Cloudflare rebuilds and redeploys automatically.
- Custom domain: none chosen yet. When one is bought, add it in Cloudflare
  Pages → Custom domains and update the single `site.url` value in
  `src/content.json`, then rebuild. Never hard-code the domain in HTML,
  CSS, or JS.

### O6 — Pages vs Workers (checked 2026-11-20)

Cloudflare's own docs now say "Start new projects with Workers"
(Pages overview, updated 25 Aug 2026; April 2025 announcement: Pages
"will continue to be supported, but, going forward, all of our
investment, optimizations, and feature work will be dedicated to
improving Workers"). Pages is **not** deprecated and still works.
**Decision for this build: stay on Cloudflare Pages**, per the plan and
the coordinator's rule not to switch mid-build. Reasons: the plan, the
`_headers`/`_redirects` setup, and the deploy steps were all written for
Pages; Pages' per-PR preview deploys are the review path the owner
needs; a Workers move changes only the dashboard steps (a `wrangler`
config serving `dist/` as static assets, headers via the Workers
equivalent) and is a coordinator decision for later, not a build change.
If the team switches, this README's deploy section must be updated first.

## Live data at build time

The site renders live public GitHub data at build time (all public,
unauthenticated) — repo list, user profile, vocab lesson bank and state,
avatar. Numbers are NOT frozen here: a snapshot rots within a day (the
7-repo count written on 21 Nov 2026 was already 8 the next morning, when
`year-reset-planner` appeared). For the current values, see the live site
(https://liveforge.pages.dev/) and `dist/status.json` (`fetchedAt`,
`dataStale`).

- The build fetches the live repo list, so a new public repo appears in
  the counts and the activity ticker automatically; featured cards stay
  curated in `src/featured.json`.
- Lesson bank: read from `data/lessons.json` at build time, never
  hard-coded (O5: the vocab README and the fetched bank agree).
- `crumbboard-cookie`, `t3n-expenseops-agent` are archived (read-only);
  the profile repo is `halakouai-byte`. The site does not headline
  stars/forks. The user bio is exactly "Freelance Developer".
- Note (20 Nov build): the shared egress IPs repeatedly showed
  `x-ratelimit-remaining: 0` (reset within the hour) and two vocab API
  calls returned 403 — the build fell back to cache for those sources
  only, logged the limit headers, and exited 0. This is the behaviour
  the architecture was designed for.

Note — new repos since the plan baseline: `telegram-channel-prompt-pack`
(JavaScript, created 20 Nov 2026, 14:39 UTC), `anime-news-channel`
(created 20 Nov 2026, 22:30 UTC; first pushed 21 Nov 2026, 07:39 UTC)
and `year-reset-planner` (first pushed 22 Nov 2026, 04:03 UTC) appeared
in the live repo list. They are counted and appear in the activity
ticker, but they are NOT featured cards — the three featured cards stay
curated in `src/featured.json`. Because the prompt-pack name
contains the word "telegram", the strict no-"telegram" grep flags its
name/URL in `src/data/projects.cache.json`, `dist/data/projects.json`, and
the ticker link in `dist/index.html`. Those matches are the repo's real
public name, not a channel handle or link — recorded here as the false
positive the QA gate requires (file, line, reason). No channel handle is
printed or linked anywhere on the site.

## Known deviations / pending items (for the coordinator + QA)

1. **Avatar file is 320×320.** The build downloads it with `?v=4&s=320`
   (verified live 2026-11-21: 320×320, ~81 KB). An earlier note claimed
   420×420 — that was the old avatar; the current file (new "L" logo,
   2026-11-21) is 320×320. Displayed at 32 px with explicit width/height.
   The build re-downloads it and replaces it only if the bytes changed.
2. **`og-image.png` exists** (added in QA phase 4, 2026-11-20): a real screenshot of
   the finished hero, 1200×630, at `assets/img/og-image.png` (copied to
   `dist/assets/img/og-image.png` by the build). The `og:image` /
   `twitter:image` tags are present in both `index.html` files.
3. **The word "telegram" appears only inside the real repo slug**
   `telegram-channel-prompt-pack` (see the note above). The unconfirmed
   channel handle is never printed or linked.
4. **Secret scan (by design):** the CI step in `.github/workflows/build.yml`
   runs the pinned gitleaks 8.28.0 release binary — no token-pattern literal
   and no credential name lives in the repo (the earlier inline grep step
   matched its own line and has been removed). `.gitignore` contains the
   environment-file ignore entries the plan requires; those are the guard
   itself, not secrets.
5. **`_headers` cache rule:** `/assets/*` uses `max-age=3600,
   must-revalidate`, not `immutable`, because filenames are not
   content-hashed (per the rule in PLAN §9.2). `/data/projects.json`
   and `/status.json` are `no-cache` per PLAN §6.5.
6. **7-day posting strip:** derived ONLY from state-update commits
   (messages starting `chore: update state`) in the last 30 vocab commits,
   filtered to the 7 days ending at state.last_date. The 18 Nov 2026
   `Initial commit` is repo setup, not a post, so it never shows as posted.
   State-update commits exist for each posting day; the strip shows the
   7 days ending at state.last_date. (The fetch used to be per_page=7 —
   too few, because non-state commits interleave; it missed 20 and 21 Nov.)
7. **JSON-LD block:** the `<script type="application/ld+json">` block in
   `index.html` is a data block, not executable script; it is allowed
   under the strict `script-src 'self'` CSP. There are no other inline
   scripts and no `onclick=` anywhere.

## File map

```
liveforge/
├── index.html                  # source template (build injects data)
├── DESIGN.md                   # tokens — single source of truth
├── README.md                   # this file
├── .gitignore                  # dist/, node artefacts, secrets (verified)
├── _headers                    # strict security headers (PLAN 9.2)
├── _redirects                  # one canonical only (no mirror exists)
├── src/
│   ├── content.json            # ALL hand-written copy (owner-editable)
│   ├── featured.json           # the 3 curated repos + benefit lines
│   └── data/projects.cache.json# committed fallback cache
├── assets/
│   ├── css/main.css            # tokens only
│   ├── js/main.js              # 9.6 KB: count-up, reveal, ticker, canvas
│   ├── fonts/mona-sans-*.woff2 # variable, Latin + Latin Extended
│   └── img/avatar.png          # build-time download (320x320, ~81 KB)
│   └── img/favicon.svg
├── scripts/build.mjs           # Node stdlib only: fetch -> render -> status
├── .github/workflows/
│   ├── build.yml               # push/PR: scan + build (+ cache commit on main)
│   └── refresh.yml             # cron 30 7,17 * * * UTC + manual dispatch
└── dist/                       # build output = deploy directory (gitignored)
    ├── index.html
    ├── data/projects.json
    ├── status.json
    ├── robots.txt
    ├── sitemap.xml
    ├── _headers
    └── _redirects
```
