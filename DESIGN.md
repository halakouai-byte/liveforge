# LiveForge — DESIGN.md

Design tokens for the LiveForge portfolio site. **Single source of truth.**
The build must use nothing else for colour, type, spacing, radius, or
elevation. Any value not listed here needs a design-lead decision, not an
ad-hoc choice during build.

Owner: `halakouai-byte` — bio exactly "Freelance Developer".
Style: GitHub-homepage dark idiom, built on Primer design tokens.
Principles: one star per screen; proof over claims; the still version is
finished (every animated element looks complete with JS disabled, motion
reduced, or data unavailable); specific copy or no copy.

## Colours

One accent, one link colour. No purple, no rainbow gradient, no pure
mid-grey neutrals. No gradient text. No second accent. Coloured section
backgrounds are only the two canvases below.

| Token | Value | Job |
|---|---|---|
| `--canvas` | `#0d1117` | Default page canvas; product surfaces |
| `--canvas-hero` | `#000000` | Hero band and final CTA band only — switched at section boundaries, never blended |
| `--surface` | `#161b22` | Cards, code panels, ticker band |
| `--surface-raised` | `#1c2128` | Hover / raised card only; use sparingly |
| `--border` | `#30363d` | 1px borders on every card and divider — this is the elevation system |
| `--border-subtle` | `#21262d` | Inner dividers, table rules, constellation grid |
| `--text` | `#f0f6fc` | Headlines and primary body |
| `--text-strong` | `#ffffff` | Hero headline only |
| `--text-muted` | `#7d8590` | Secondary text, captions, dates, labels |
| `--text-faint` | `#848d97` | Tertiary metadata only (e.g. "Updated …"); never body copy |
| `--accent-green` | `#3fb950` | The single accent: activity dots, "live" pulse, success states, constellation points, count-up numbers |
| `--accent-green-glow` | `#5fed83` | Glow / highlight only — dots, constellation highlights, live indicator. Never body text, never a button fill |
| `--cta-green` | `#077a26` | Primary CTA button fill. White text on it — darkened 2026-11-22 for AA margin (white-on-green 5.50:1, was 4.66:1) |
| `--link-blue` | `#79c0ff` | All links, secondary CTA labels, code-language dots where blue applies |
| `--link-blue-bright` | `#8dd6ff` | Hero / marketing links and the hero eyebrow only |
| `--focus` | `#1f6feb` | Keyboard focus ring (2px outline, offset 2px) — visible on every interactive element |

Language dots (repo cards only, GitHub's colours, 12px dots + labels,
never large fills): Python `#3572A5` · TypeScript `#3178c6` ·
JavaScript `#f1e05a` (label in `--text-muted`, dot only) · Shell `#89e051` ·
HTML `#e34c26` · CSS `#563d7c`. An unlisted language gets a `--border` dot
and its name in text.

States: success/live = `--accent-green` + the word "Live" in text (never
colour alone). Error/stale/offline = `#f85149` for the status word only.
Warning (rate-limited / stale cache) = `#d29922` for the status word only.
Never red fills, never red body text.

Forbidden: purple-blue gradients; gradient text; pure grey (`#808080`,
`#999999`) neutrals; any second accent; coloured section backgrounds other
than the two canvases above.

## Typography

Fonts: Mona Sans (variable, OFL), self-hosted, weights **400 / 425 / 460 /
500 / 600 only** — never 700/800. Fallback:
`Mona Sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans",
Helvetica, Arial, sans-serif`. Code/labels: `ui-monospace, "SF Mono",
"Cascadia Code", "JetBrains Mono", Menlo, Consolas, "Liberation Mono",
monospace`.

| Token | Size / line-height / tracking / weight | Use |
|---|---|---|
| `--text-hero` | 64px / 1.05 / −2.24px / 425 | Hero `<h1>` only (mobile: 40px / 1.1 / −1.2px) |
| `--text-h2` | 32px / 1.25 / −0.8px / 460 | Section headings |
| `--text-h3` | 24px / 1.3 / −0.4px / 500 | Card titles, step titles |
| `--text-body` | 17px / 1.6 / 0 / 400 | Body copy, card descriptions |
| `--text-small` | 15px / 1.5 / 0 / 400 | Secondary copy, repo meta, footer |
| `--text-caption` | 12px / 1.5 / +0.4px uppercase / 500 | Eyebrows, labels, "Updated …" lines, ticker labels |

Rules: exactly one `<h1>` per page; headings in order; body copy never
below 15px; no italic for emphasis (use weight or colour); links are
`--link-blue`, underlined on hover only.

## Spacing, radius, elevation, breakpoints

Spacing (4px base, only these): 4 / 8 / 16 / 24 / 32 / 48 / 64 / 96.
Section padding 96px desktop / 64px mobile; heading → content gap 32px;
card padding 24px desktop / 16px mobile; card grid gap 24px; page side
padding 24px desktop / 16px mobile; max content width 1280px, centred;
body text measure capped at 640px.

Radius — one rule: 12px on all cards, panels, code blocks; pill (999px)
on buttons, badges, live dot; 6px on inline code and small tags. No
16/24/48px radii anywhere.

Elevation: surfaces + 1px border, **no shadow**. Hover (linked cards
only): border brightens to `#484f58`, background lifts to
`--surface-raised`. The one permitted shadow: primary CTA button only,
`0 0 0 1px rgba(255,255,255,0.08) inset`.

Breakpoints: <640px mobile (single column, hero 40px, stats 2×2) ·
640–1023px tablet (2-column project grid, hero 48px) · ≥1024px desktop
(1280px max, hero 64px, 3-column grid). Fluid hero type only between
640–1024px via `clamp()`; all other sizes are fixed tokens.

## Motion

Transform and/or opacity only, `cubic-bezier(0.2, 0.6, 0.2, 1)`.
Constellation canvas (<5 KB JS, after LCP, pauses off-screen, quality
step-down below 55fps, static SVG fallback, one static frame under
`prefers-reduced-motion`); count-up stats (600ms, once); scroll reveal
(600ms, 16px, max 3 staggered); activity ticker (6s advance, pause on
hover/focus, visible Pause/Resume control, static list under reduced
motion). Total JS < 20 KB. No autoplay video, no blob, no parallax, no
scroll-jacking.
