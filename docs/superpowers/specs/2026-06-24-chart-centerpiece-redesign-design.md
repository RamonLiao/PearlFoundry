# Chart-as-Centerpiece Redesign — Design Spec

**Date:** 2026-06-24
**Status:** Approved (brainstorming complete, visual decisions locked via companion)
**Scope:** Frontend presentation-layer redesign + 1-line backend echo. Make the Range Accrual
payoff chart the visual centerpiece of PearlFoundry. Deferred batch ① from `tasks/progress.md`.

## Goal

Today the payoff chart is buried inside the mint card and only appears after the user clicks
Mint. It is the single most compelling artifact in the app (it tells the whole product story in
one picture) yet it is never the first thing a visitor sees. This redesign promotes it to a
persistent hero, gives it an entrance + shimmer treatment, surrounds it with a numeric metric
rail at quote time, and removes the residual "AI-slop" styling (pink candy gradient button,
glyph `✓`/`↗`, sub-4.5:1 ticks).

## Locked Decisions (from visual companion session)

1. **Layout = B+A hybrid.** A persistent hero block sits directly below the masthead and is the
   first content a visitor sees (B: idle "explainer" state, even before wallet connect). When the
   user requests a quote, that same hero block transforms in place into a 2-column live preview
   (A: big animated chart left + metric rail right + Cancel/Confirm). One block, two states — not
   two separate sections.
2. **Metric rail = 6 fields** (live state): Floor (leftover), Accrual band (lower–upper),
   Max payout, Per-step × legs, Notional, Expiry (date).
3. **Idle explainer state**: the hero chart shows a generic illustrative up-ladder + a one-sentence
   explanation ("Below the band you reclaim a floor; each strike the price clears adds a step;
   clear the whole band → max payout") + 3 concept cards (Direction: Long · up-ladder / Floor:
   leftover premium / Settles: self · soulbound) + the Mint button.
4. **Animation = "A: 無到有 + 5s shimmer"** (the v3 sequence): staircase line draws left→right
   (~1.1s, stroke-dashoffset) → fill polygon + strike dots fade in from opacity 0 (~700ms,
   starting when the draw finishes) → continuous iridescent shimmer on the gradient stops
   (`stop-opacity` oscillation, ~5s loop). The fill must be **absent during entrance** (opacity 0)
   and only appear after the staircase completes — "from nothing to whole". All animation is gated
   by `prefers-reduced-motion: reduce` → fully static, still legible.
5. **Primary button restyle**: drop `--pinkgold` candy gradient. Primary = solid molten gold
   (`--molten-end` background, dark `#3d1a28` text for WCAG ≥4.5:1). Keep the hover lift.
6. **De-AI cleanup**: replace glyph `✓` (status) and `↗` (links) with inline SVG line-icons
   matching the existing `.nl-li` set; verify `--chart-tick` / `--pearl-dim` / `--ink-faint` ≥
   4.5:1 on their backgrounds (theme.css comments claim these are already corrected — verify, do
   not assume).

## Data Availability (verified against backend)

`/quote` already returns `{ tx, ladder:{lower,upper,step}, forward, qtyPerLeg, oracleId, expiry,
leftover }` (`scripts/indexer/server.js:155-160`). Therefore:

- **Floor** = `leftover` ✓
- **Accrual band** = `ladder.lower`–`ladder.upper` ✓
- **Max payout** = `leftover + qtyPerLeg × legs` (legs derived from band/step, same as
  `computePayoffCurve`) ✓
- **Per-step × legs** = `qtyPerLeg`, `legs` ✓
- **Expiry** = `expiry` ✓ — **but it is a unix timestamp in SECONDS** (quote path; test stub
  `'1750000000'`), whereas the notes table uses `expiry_ts_ms` in MILLISECONDS. Format defensively:
  detect magnitude (10-digit → ×1000) or document the seconds assumption with a guard. Show as a
  human date (e.g. `2025-06-15 12:00`).
- **Notional** = NOT in the `/quote` response (it is an *input*, default `'10000000'` = 10 dUSDC,
  6 decimals). **The only backend change in this spec**: echo `notional` in the `/quote` response
  object (`server.js` quote() return, one added field). Fail-loud — the value already exists in
  scope as the function's `notional` argument.

Out of scope (noted, not fixed): `App.jsx` passes `p.expiry` (note maturity seconds) as
`savePending`'s record-TTL argument; `savePending` only stores it and never enforces a TTL, so it
is stored-but-unused — harmless, leave it.

## Architecture

Presentation-layer only (plus the 1-line backend echo). `move/` and the indexer schema stay
byte-unchanged; `payoff.js` math is untouched (existing 16/16 tests stay green). Component
boundaries:

### `PayoffChart.jsx` (modified — stays pure presentational)
- Add an `animated` prop (default `true`). When true, emit the entrance + shimmer CSS classes
  (`draw` on the polyline, `fillgate` on the polygon, `dotgate` on the dot group, `shimmerstops`
  on the `<linearGradient>`). When false (or reduced-motion), render the final static frame.
- Re-trigger the entrance when the curve identity changes (idle→live, or a re-quote). Use a React
  `key` derived from the curve (e.g. `lower-upper-step`) on the `<svg>` so React remounts and the
  CSS animation replays. Document this so it is not "optimized away".
- All animation CSS lives in `App.css` (or a co-located block) behind a
  `@media (prefers-reduced-motion: reduce)` reset, mirroring the existing reduced-motion block.
- The compact variant (MyNotes inline) keeps `animated={false}` to avoid motion in dense table
  rows — confirm this keeps MyNotes visually identical (no regression).

### `demoCurve()` helper (new — pure function, unit-tested)
- Returns a canned `computePayoffCurve`-shaped object for the idle explainer (generic BTC-ish band,
  small leg count so the staircase reads clearly, non-zero leftover so the floor tick shows).
- Built by calling the real `computePayoffCurve` with fixed inputs (do NOT hand-author the points —
  reuse the authoritative math so the explainer can never diverge from real payoff shape).

### `MetricRail.jsx` (new — pure presentational, formatting helpers unit-tested)
- Props: `{ leftover, lower, upper, qtyPerLeg, legs, notional, expiry }`.
- Renders the 6 labelled cards. Floor uses the jade "gain" color; the rest are neutral ink.
- Extract pure formatters (`fmtDusdc`, `fmtBand`, `fmtExpiry`, `fmtMax`) so they are unit-testable
  without rendering (Rule 9 — tests encode the *why*: band must show distinct k-labels for narrow
  BTC bands; expiry must handle the seconds-vs-ms unit; dUSDC must use 6-decimal base units).

### `App.jsx` + `App.css` (modified — the hero restructure)
- Replace the current "Issue a Note" card body with a **Hero block** with two render states driven
  by existing `mintPhase`:
  - **idle** (`idle` / `error` / `cancelled` / `done`, and also when no account): 2-col on desktop
    = idle `demoCurve()` chart (animated) left + explainer copy & 3 concept cards & Mint button
    right. Visible **even before wallet connect** (the B "first-glance" win); when disconnected the
    Mint button is replaced by / wraps the ConnectButton (or disabled with "Connect to mint").
  - **confirm** (`confirm`): 2-col = live `computePayoffCurve` chart (animated, keyed to re-enter)
    left + `MetricRail` right + Cancel/Confirm below.
  - **preparing / minting**: keep the existing inline status text; the hero shows the idle or
    last-known chart with a busy affordance.
- **Widen container**: `.nl-app` max-width 760px → ~1040px. Hero is full-width 2-col; the
  2-col grid collapses to 1-col under a breakpoint (~720px) — chart on top, rail/copy below.
  Leaderboard and MyNotes tables benefit from the extra width; verify they still read well (they
  are already responsive tables).
- **Button**: rewrite `.nl-btn--primary` to solid `--molten-end` bg + `#3d1a28` text; drop the
  `--pinkgold` box-shadow tint (use a neutral molten shadow). Remove the now-unused `--pinkgold`
  token only if no other caller remains (grep first).
- **Glyph→SVG**: status `✓` and link `↗` → inline `.nl-li` SVGs.
- Keep the staggered `.nl-section` reveal; the hero is one section.

## Error Handling

- No new network failure modes. Quote/mint error paths are unchanged (`mintPhase === 'error'`).
- `demoCurve()` is deterministic and cannot fail; if `computePayoffCurve` ever throws on the canned
  inputs that is a build-time bug caught by the unit test, not a runtime path.
- `MetricRail` formatters must be null-safe: a missing/blank field renders an em-dash, never
  `NaN`/`undefined` (defensive — quote always supplies them, but the rail must fail visible-and-
  graceful, never crash the hero).

## Testing

- **Unit (node --test)**: `demoCurve()` (monotonic staircase, baseline = leftover, legs match
  band/step); `MetricRail` formatters (band distinct-k, expiry seconds→date, dUSDC base-units,
  max = floor + qty×legs, null→em-dash). `payoff.js` 16/16 unchanged.
- **Backend**: extend the `/quote` server test to assert the response now includes `notional`.
- **CSS/animation** (no unit test): `vite build` green + a **branch-wide `git diff` invariant** —
  `move/`, indexer schema, `payoff.js`, `mint.js`, `api.js` unchanged except the single `notional`
  echo line in `server.js`; this encodes "this is a presentation migration" (Rule 9). Confirm the
  `prefers-reduced-motion` reset covers every new animation class.
- **Monkey/edge** (per project test rule): narrow band (lower≈upper, all k-labels collapse),
  single-leg band, very wide band (legs > 24 → dots hidden, staircase still draws), leftover = 0
  (floor tick absent, no NaN), reduced-motion on (static, legible), disconnected wallet (idle hero
  renders, Mint→connect), re-quote (entrance replays via key), narrow viewport (2-col→1-col fold).
- **Live (deferred, browser wallet)**: idle hero on load, quote→live transition, animation in a
  real wallet round-trip — deferred per the established sandbox-has-no-wallet pattern; all data
  paths are verifiable headless.

## Process

Plan via `writing-plans`, implement via `subagent-driven-development`, two-round review per
`dual-review` (frontend → `sui-frontend` + `frontend-design`/`taste`; the `notional` backend echo
is non-Move JS so generic reviewer is fine), final whole-branch opus review (the cross-cutting
review caught the dead-code seam last time — explicitly ask it to check the idle↔live↔MyNotes
integration seams and that no animation class escapes the reduced-motion reset).
