# Landing Page + Launch-App Routing — Design Spec

> 2026-06-25 · Spec A of a 2-spec split. Spec B (in-app empty/loading/error illustration
> polish — 4 items) is a separate, later cycle and is **out of scope here**.

## Goal

Add a marketing/intro landing page at `/` that introduces PearlFoundry and the problem it
solves, with a **Launch App** action that routes to the existing dApp at `/app`. The current
single-page app becomes the `/app` route, unchanged.

Success criteria:
- Visiting `/` shows the landing page (hero, problem, how-it-works, ledger+roadmap, footer).
- "Launch App" routes to `/app`, which renders the existing app verbatim (mint / MyNotes /
  Leaderboard / wallet connect all work exactly as today).
- The page is responsive at the breakpoints validated in brainstorming (see RWD section).
- Landing copy is reused from `docs/demo-script.md` + `docs/product-economics.md` (no new claims).
- `frontend` build green; existing tests stay green; new units covered.

## Routing

- Add dependency **`react-router-dom` pinned to `^6.28`** (last stable v6). The spec uses the v6
  API (`BrowserRouter` / `Routes` / `Route` / `Navigate` / `Link`); v7 reorganises these and must
  NOT be installed by an unpinned `npm install`. Add the exact line
  **`"react-router-dom": "^6.28.0"`** to `frontend/package.json` `dependencies` as step zero,
  before any `import … from 'react-router-dom'`. (sui-frontend #12, R2-C1)
- **`BrowserRouter` + `Routes` live in `frontend/src/main.jsx`**, replacing the current
  `<App/>` render. `App.jsx` is NOT the router host — it stays the `/app` shell, render body
  unchanged. `DAppKitProvider` is the OUTERMOST wrapper, `BrowserRouter` nested inside it so every
  route shares one wallet context (`useCurrentAccount` etc. in `App.jsx` must run inside
  `DAppKitProvider`). Render tree in `main.jsx`: (sui-frontend #1, R2-C2)
  `<DAppKitProvider> → <BrowserRouter> → <Routes>`:
  - `<Route path="/" element={<Landing/>} />`
  - `<Route path="/app" element={<App/>} />`
  - `<Route path="*" element={<Navigate to="/" replace/>} />` (unknown paths → landing).
- **Move `import './App.css'` from `App.jsx` to `main.jsx`** so its shared primitives
  (`.nl-section`, `@keyframes nl-reveal`, the consolidated reduced-motion block, `.sr-only`) load
  globally. Otherwise the `/` Landing route — which reuses `.nl-section` and `.sr-only` — renders
  with sections stuck at `opacity:0` and the ledger caption un-hidden: a SILENT failure.
  `theme.css` is already global via `main.jsx`. (sui-frontend R2-I4 — highest silent-fail risk)
- `App.jsx` render body is otherwise unchanged. See O1-resolved below for the masthead logo.
- Landing primary CTA + nav CTA → `<Link to="/app">` ("Launch App"). **Secondary CTA is an
  in-page anchor "How it works ↓"** → `<a href="#how-it-works">`, with the HowItWorks section
  carrying **`id="how-it-works"`** and `html { scroll-behavior: smooth }` set in `Landing.css`
  (suppress the smooth-scroll inside the reduced-motion block). Missing the `id` makes the anchor
  silently no-op. NOT a second link to `/app`. (frontend-design I6, sui-frontend R2-I2)
- **SPA fallback IS committed in this work (BrowserRouter chosen).** Deep-links / hard-refresh on
  `/app` must not 404 on a static host. Commit both, harmless when unused: (sui-frontend #3)
  - `frontend/public/_redirects` → `/*  /index.html  200` (Netlify / Cloudflare Pages)
  - `frontend/vercel.json` → `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`
  - Vite dev server already serves `index.html` for unknown paths (dev + `vite preview` fine).

### O1-resolved — masthead logo & the click-cycle easter-egg
The masthead **logo becomes `<Link to="/">`** (back to landing). The existing mascot
**click-cycle easter-egg is NOT dropped — it relocates** to another masthead element (attach the
`onClick` cycle + `MASCOT_CYCLE` state to the eyebrow pearl icon, or the in-app hero mascot —
implementer picks the cleaner host). Because `<Link>` renders an `<a>`, not a `<button>`, the
**entire `.nl-mast-logo-btn` block in App.css (≈20 lines, App.css ~347–363)** becomes dead on the
logo element once the easter-egg leaves — not just the `appearance/background/border` button
resets but also the grayscale-at-rest + hover/focus-visible colour-reveal rules (those are the
easter-egg's presentation and should MOVE with the cycle to its new host, not linger). The
remaining logo `<Link>` needs only a focus-visible outline. Either move the block to the new host
selector or prune it; don't leave it orphaned on the logo. (sui-frontend #4, R2-I1)

## Component structure

New files under `frontend/src/`:

- `Landing.jsx` — composes the sections, renders `<Sea/>` background + Nacre theme, applies the
  existing entrance `--i` stagger used elsewhere. Imports `Landing.css`.
- `Landing.css` — landing-only styles + the RWD `@media` rules. Holds NO redeclarations of
  App.css primitives (`.nl-section`, `@keyframes nl-reveal`, `.sr-only`) — those load globally via
  `main.jsx` (see Routing/I4) and Landing reuses them. Landing.css adds only landing-specific
  selectors. Reuses theme tokens from `theme.css` (`--nacre`, `--jade`, `--molten`, etc.).
- `landingContent.js` — pure data: the problem items, how-it-works steps, roadmap items, and the
  static ledger-teaser rows as exported constant arrays/objects. No logic. Single source of the
  copy so sections just `.map()`.
- Section components (small, single-purpose, each takes its data via props or imports the
  constant directly — kept in `Landing.jsx` as local components unless one grows large enough to
  warrant its own file):
  - `LandingHero` — eyebrow + headline + sub + two CTAs + an **asymmetric, oversized hero
    mascot**: `<Mascot variant={MASCOT_VARIANT.JOYFUL} treatment="full" glow size={180} />`,
    headline anchored hard-left, mascot allowed to bleed slightly past its column. `size={180}`
    is explicit — the 72px component default is icon-sized (sui-frontend #6). `alt` may be omitted
    (component defaults `''`).
    - **Glow orb mechanism (frontend-design R2-M-A):** the "Nacre glow orb" is a SEPARATE larger
      radial-gradient element behind the well (sibling, lower z-index) — NOT the well's own
      `nl-pearl-well--glow` box-shadow (that's a contained shadow on an `overflow:hidden` disc and
      can't read as an ambient orb). The orb is ambient background, so it does not violate the
      one-shadow-source rule (it is not a second drop-shadow on the img).
    - **Signature load beat (frontend-design R2-I-A):** the hero mascot plays a single
      `nl-clam-open` on entrance (keyframe already in App.css:342, reduced-motion-guarded) while
      headline → sub → CTA stagger in behind it, so the eye lands on the pearl first. One reused
      keyframe, no new infra. This is the page's one designed focal moment (rest of page = the
      uniform `--i` fade-up).
  - `LandingProblem` — 3 numbered cells (01 minimums/lock-up/KYC, 02 DeFi v1 oracle collapse,
    03 no immutable audit trail).
  - `LandingHowItWorks` — mint → settle → claim rendered as an **ascending ladder/staircase**
    (each step offset upward, connector a rising line) echoing the range-accrual payoff shape —
    NOT a flat row of equal cards with `→` arrows (frontend-design I3). The 3 "solution" points
    (atomic PTB / SVI-priced / soulbound prospectus) fold into the step copy. Step labels are
    literally **mint / settle / claim** — no parallel "SOLVE 01" numbering (frontend-design M2).
  - `LandingLedgerRoadmap` — static Nacre Ledger teaser (hard-coded sample rows incl. a "YOU"
    row, **not** a live `/leaderboard` fetch — see D1). Must be visibly marked illustrative: a
    visible "Illustrative" chip **and** an `sr-only` `<caption>` "Sample data — connect wallet to
    see live notes" (DeFi honesty; avoid the teaser reading as live on-chain data — sui-frontend
    #10). Give the "YOU" row real visual weight (jade/molten highlight band), it's the strongest
    trust signal (frontend-design M4) — give it a **molten** highlight band (not jade AND molten;
    accent-dominance below). Roadmap list alongside: more templates (Capped-Upside,
    Principal-Protected), Walrus term attestation, **gasless claims**. Phrase the roadmap items as
    roadmap, matching `demo-script.md` PART 3 framing — do **not** assert "already live" on the
    landing (sponsored claims' real-wallet round-trip is still human-deferred; an unverified live
    claim violates the §Copy-source no-new-claims rule). (sui-frontend R2-M2)
  - footer (brand line + "Testnet live" tag).

## Visual design / aesthetics (binding — do NOT copy the mockup's look)

The companion mockup (`docs/landing-mockups/landing-rwd.html`) is a **layout/RWD reference only**.
Its fonts, background, and breakpoint mechanism are companion-frame artifacts and MUST NOT be
copied. The real implementation:

- **Typography (frontend-design C1):** headline + section headings in `--font-display` (Fraunces,
  serif); eyebrows, numbers, ledger table, tags in `--font-mono` (Martian Mono). Generic
  `ui-sans-serif` everywhere is the #1 AI-slop tell and must not ship. Match the app's
  `.nl-card__title` (Fraunces) so the landing reads as the same product. **The 60px hero headline
  uses a high optical size** (`font-variation-settings:'opsz' 144` or near Fraunces' max) — at
  default `opsz` a 60px serif renders timid (frontend-design R2-M-C).
- **Background depth (frontend-design C2):** render the real `<Sea/>` + the `body` layered
  radial-gradient + noise stack from `theme.css`. Sections sit on **translucent cards over that
  depth**, not on an opaque flat mint rectangle. **Card base must stay opaque enough behind text**
  (a solid-ish `rgba` floor or `backdrop-filter` blur) that body/heading text holds WCAG AA over
  the moving caustics — the depth treatment must not silently break the contrast the spec protects
  (frontend-design R2-M-B).
- **Accent dominance (frontend-design R2-I-B):** the palette is nacre-dominant. **`--molten` is the
  page's single saturated accent — reserved for the primary CTA and the YOU-row highlight band,
  nothing else.** Jade is a secondary structural accent (roadmap ticks, nav hover, eyebrow);
  ink/pearl for text; nacre for surfaces. Don't let jade + molten + pink + nacre all compete — one
  saturated accent tied to the two strongest moments (the CTA and the trust signal).
- **Vertical rhythm through-line (frontend-design R2-I-C):** generous band padding on desktop (the
  §RWD tightening applies on mobile only). The hero's hard-left asymmetry must be **echoed at least
  once below** so it reads as intent not accident — e.g. the ledger table full-bleeds wider than
  the roadmap rail, or the how-it-works ladder climbs off the left margin. Avoid every band
  snapping back to a dead-centered fixed column.
- **Headline scale (frontend-design I4):** `clamp(32px, 6vw, 60px)`, `line-height ~1.05`,
  `letter-spacing:-.02em`. The mockup's 34px ceiling is body-scale, not hero-scale.
- **One shadow source (frontend-design I2):** the hero mascot gets its shadow/glow from the
  `nl-pearl-well` (`glow`) ONLY — do not stack an extra `filter: drop-shadow(...)` on the img
  (double-shadow), and do not apply any `grayscale()`/`saturate()` to a full-colour hero mascot
  (the desaturate-no-op pitfall this project has hit).
- **Break the rhythm (frontend-design C3):** the three content bands must NOT all be identical
  3-card grids. Problem = numbered cells; How-it-works = ascending ladder; Ledger = highlighted
  table + roadmap rail. Each section a distinct composition.
- **Restraint (frontend-design M1):** the `◆` diamond glyph for eyebrow only; roadmap uses a jade
  tick / numbered rail, not the same diamond everywhere.
- **Molten CTA ink stays `#3d1a28`** — REJECTED frontend-design M3's swap to `--pearl #3a3340`.
  `#3d1a28` is this project's WCAG-verified 6.7:1 molten-ink (Rule 7/11: keep the tested value).
- Nav links: jade underline-on-hover (frontend-design M5).

## Copy source (no invented claims)

All landing text is lifted/condensed from:
- `docs/demo-script.md` — Problem (3 bullets), Solution (3 bullets), Roadmap (3 bullets).
- `docs/product-economics.md` — target-user one-liner for the hero sub.

## RWD (validated live in brainstorming)

Use **`@media (max-width: 600px)`**, NOT `@container`. The mockup used container queries only for
its side-by-side device-frame isolation; the app root has no `container-type` and mixing the two
mechanisms would silently no-op (sui-frontend #2). At/below the breakpoint:
- Hero: 2-col → 1-col, centered; **mascot moves above the headline** (`order:-1`).
- CTAs center; sub max-width tightens.
- Nav text links hide; **Launch-App CTA stays visible** (so the CTA must be a **sibling** of the
  nav-links container, not a child of it — else `display:none` swallows it; sui-frontend #11).
- Problem 3-col → 1-col.
- How-it-works ladder: stacks vertically (rising connector → vertical).
- Ledger+Roadmap: 2-col → 1-col.
- **Density tuning (frontend-design I5):** tighten band vertical padding on mobile, keep the
  mascot reasonably large (~170px, not 140px), and add a **sticky bottom Launch-App bar** so the
  one CTA stays reachable through the long mobile scroll. The bar is
  `position:fixed; bottom:0; z-index:30; padding-bottom:env(safe-area-inset-bottom,0)` — z-index
  must clear `<Sea/>` (z-index 0) and the safe-area pad keeps it off the iOS home indicator
  (relevant for a mobile dApp). (sui-frontend R2-I3)

Headline uses fluid sizing (`clamp(...)`). `Landing.css` must contain **exactly one**
`@media (prefers-reduced-motion: reduce)` block (grep to confirm) covering all Landing-specific
animated selectors (sui-frontend #5). Landing sections that reuse the `.nl-section` class inherit
App.css's existing reduced-motion + `nl-reveal` entrance — **Landing.css must NOT redeclare
`@keyframes nl-reveal`** or other keyframes already in App.css (last-declared wins silently;
sui-frontend #9). Assign explicit `--i` stagger values per section, and **use a 60ms multiplier in
Landing.css** (App.css uses 90ms; Landing has more sections, so 60ms keeps the footer entrance
snappy — pick the multiplier knob, not the `--i` cap, to keep it simple). (sui-frontend #7, R2-M1)

Reference mockups: `docs/landing-mockups/landing-rwd.html` (chosen, responsive) and
`landing-layout-AB.html` (early A/B).

## Testing (existing harness = `node --test`, pure JS — NO jsdom/RTL/vitest)

The actual frontend test harness is Node's built-in `node:test` + `node:assert/strict`, run with
`node --test` over `src/*.test.js`. There is **no jsdom / React Testing Library / vitest** in the
project — every frontend `.test.js` tests a pure function only. Do NOT add a render-testing stack
(scope creep, contradicts "reuse existing setup"). Therefore:

- **Unit tests (`landingContent.test.js`, `node:test`):** the testable surface is the
  `landingContent.js` pure data — shape/length assertions: exactly 3 problem items and exactly 3
  how-it-works steps, each with the required keys; the ledger teaser includes exactly one `you:true`
  row; roadmap has ≥1 item and **no item string contains "live"/"already live"** (locks the R2-M2
  honesty rule as a test, fails loud if someone re-adds the claim).
- **Component render is verified by `vite build` (green) + a human browser pass** — consistent with
  every prior frontend feature in this project (render is the standard human-deferred step; the
  sandbox has no browser/wallet). No automated render/route test.

## Out of scope (YAGNI)

- i18n / multiple languages.
- Live leaderboard fetch on landing (teaser is static — D1).
- Hamburger menu (mobile collapses nav links, keeps CTA — validated).
- Heavy scroll-triggered animation (only the existing `--i` entrance stagger).
- Spec B's 4 in-app empty/loading/error illustrations (separate cycle).

## Decisions

- **D1 — Ledger teaser is static.** Avoids coupling the landing to backend availability/CORS and
  an empty-state on first load. The real, live Ledger is one click away at `/app`. Marked
  illustrative (chip + sr-only caption) so it can't be mistaken for live data.
- **D2 — Router = BrowserRouter + committed SPA-fallback config** (`public/_redirects` +
  `vercel.json`). Clean `/app` URL; deep-link/refresh 404 risk closed at the host layer rather
  than via HashRouter. (resolves sui-frontend #3)
- **D3 — Masthead logo = `<Link to="/">`; click-cycle easter-egg relocated**, not dropped
  (attach the cycle to the eyebrow pearl icon or the in-app hero mascot). (resolves O1)

## Review provenance

**Two rounds** of plan-stage 2-path design review (sui-frontend + frontend-design) ran on this
spec before any code; all findings triaged and folded in.

- **Round 1** established routing, RWD mechanism, conventions, and the binding aesthetics section.
  Rejected: frontend-design **M3** (keep WCAG-verified `#3d1a28` molten ink). Informational:
  sui-frontend **#8** (redundant `alt=""`).
- **Round 2** verified R1 integration and added: App.css→global import (R2-I4, highest silent-fail
  risk), explicit `package.json` line + `main.jsx` router placement (R2-C1/C2), full
  `.nl-mast-logo-btn` prune (R2-I1), anchor `id` + `scroll-behavior` (R2-I2), sticky-bar
  z-index/safe-area (R2-I3), 60ms stagger (R2-M1), roadmap "already-live" honesty fix (R2-M2);
  and aesthetics: `nl-clam-open` hero beat (R2-I-A), molten accent-dominance (R2-I-B), vertical
  through-line (R2-I-C), separate glow-orb element (R2-M-A), card-opacity AA floor (R2-M-B),
  Fraunces high-opsz (R2-M-C). No items rejected in R2.

The implementation plan / per-task review must enforce the runtime-checkable invariants: App.css
moved to global `main.jsx` import, single reduced-motion block, no keyframe redeclaration, nav-CTA
sibling structure, no double-shadow, Fraunces/Martian-mono fonts, pinned `react-router-dom@^6`,
HowItWorks section `id="how-it-works"`, sticky-bar z-index/safe-area.
