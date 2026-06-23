# Payoff Diagram — Design Spec

**Date**: 2026-06-24
**Status**: Approved (brainstorming)
**Scope**: Frontend-only, presentation-layer. Zero contract changes, zero indexer schema changes, no new charting dependency.

## Goal

Render a Range Accrual note's payoff curve (payout vs. settlement price) in two places:

1. **Mint card** — preview the note the user is about to issue, shown *after* the PredictManager exists (PTB1) but *before* the mint (PTB2).
2. **MyNotes** — expand a note row to see its payoff (read live ladder params from chain).

## Background: the payoff math

A Range Accrual note is a ladder of long `up(strike)` binaries minted on DeepBook Predict. Each `up(strike)` leg pays `qty_per_leg` if `settlement_price > strike`, else 0. Strikes are grid-aligned from `lower` to `upper` with spacing `strike_step`.

Therefore payout is a **monotonically increasing staircase** in settlement price:

```
legs           = (upper - lower) / step + 1
strike[k]      = lower + k * step        (k = 0 .. legs-1)
payout(price)  = qty_per_leg * count(strike[k] < price)
  price <  lower  -> 0
  price >= upper  -> qty_per_leg * legs   (max payout)
```

Steps occur *at* each strike (a leg pays once settlement crosses above its strike).

### Data sources (no new backend)

- **Mint preview**: `/quote` response already returns `ladder: { lower, upper, step }` (strings) + `oracleId` + `expiry`. `forward` comes from the oracle (already fetched server-side in `computeLadder`; expose it in the `/quote` response — see §4). `qty_per_leg` is derived client-side to match the on-chain formula: `net = notional - issuance_fee(notional, fee_bps)`, then `qty_per_leg = net / (legs * expiry_count)` with `expiry_count = 1`. The `fee_bps` must come from `FactoryConfig` (already read server-side during mint) — expose it in `/quote` alongside `forward`, or compute `qty_per_leg` server-side and return it directly (preferred: return `qtyPerLeg` in the quote so client math can't drift from the contract).
- **MyNotes**: each live note stores `RangeParams { lower, upper, strike_step, qty_per_leg, legs_per_expiry, expiry_count, hurdle_bps }` as an on-chain **dynamic field** (key `ParamsKey`, defined in `note.move`). Read it read-only via the dapp-kit client. `forward` / `settlement_price` from the note's oracle (`OracleSVI`).

## Components

### 1. `computePayoffCurve` (pure function)

Location: `frontend/src/payoff.js`

```
computePayoffCurve({ lower, upper, step, qtyPerLeg }) -> {
  points:   [{ price: number, payout: number }, ...],   // staircase vertices
  maxPayout: number,
  legs:      number,
}
```

- Inputs accepted as BigInt or numeric string; converted internally. Strike/price kept in oracle tick units (e9), payout in dUSDC base units (6 dp). The component scales to pixels; the function stays unit-agnostic.
- Emits staircase vertices (horizontal-then-vertical), suitable for an SVG `polyline` + filled `polygon`.
- **Fail-loud guards** (throw, do not silently clamp): `step <= 0`, `upper <= lower`, `(upper-lower) % step != 0` (grid misalignment), resulting `legs < 1` or `legs > 128` (MAX_LEGS). These mirror on-chain invariants; a violation means bad upstream data, surfaced not hidden.

### 2. `<PayoffChart>` (presentational React component)

Location: `frontend/src/PayoffChart.jsx`

Props:
- `curve` — output of `computePayoffCurve`
- `forward` — number (oracle forward), draws a dashed vertical marker + label
- `settlementPrice` — optional number; when present, draws the actual settlement marker + a realized-payout dot on the curve
- `size` — `'full'` (mint card, ~420×250 viewBox, gridline + axis ticks + dUSDC labels) | `'compact'` (MyNotes inline, ~300×140, minimal: baseline + forward marker only)

Visual (locked via visual companion — "A×B hybrid, tone primarily A"; refined by design review, see §Design-review decisions):
- **Iridescent nacre fill** under the curve derived from the **real `--nacre` 4-stop sweep** (`#cdeadf, #d7cef2, #f8ddc9, #cfeae6` at ~115deg, low opacity .10–.45) — NOT an invented 2-stop peach→lilac (that lilac-on-white reads as generic AI-purple; review C2-taste).
- molten/gold step line, `stroke-linejoin: round`. SVG strokes cannot consume the `--molten` gradient var — add flat tokens `--molten-end: #e0a03c` / `--molten-start: #f8d27e` to theme.css and reference those (review I5-sui).
- strike dots on each step vertex (gold) — **hidden when `legs > 24`** to avoid dot-soup at high leg counts (review I5-taste/I3-taste).
- forward: rust dashed vertical (`--rust`) + label; **label text uses `--gold-ink` (`#9a6a1e`, ≥4.5:1) not `--rust`** for WCAG (review I1-taste/M2-sui).
- settlement marker (claimable only): **structurally distinct from forward, not color-only** — solid (not dashed) line + ringed/2×-radius filled dot + short text tag (e.g. "settled 64.1k"), so colorblind users distinguish it from forward and from strike dots (review I2-taste).
- Inline SVG only (matches existing icon idiom, no external lib). Per-instance unique gradient IDs via `useId()` — `nacreH`/`nacreS` would collide if both charts mount together (review M1-sui).
- Accessibility: `role="img"` + `aria-label`; axis tick text uses `--ink-faint`/`--font-mono` at ≥11px (≈4.5:1 on white; mockup's `#a89c84`@9px fails AA — review I1-taste/M2-sui). Honor `prefers-reduced-motion`: emit **no entrance animation by default**; any line-draw/fill-fade gated in `@media (prefers-reduced-motion: no-preference)` matching the house pattern (review M3).
- **All palette via theme tokens** — no raw hex (mockup's hardcoded values are sketch-only); add chart tokens to theme.css as needed (review C1-taste/M1).

### 3. Mint card integration (flow change)

File: `frontend/src/mint.js` + the mint card in `App.jsx`.

Current `runMint` does PTB1 → `/quote` → PTB2 in one uninterrupted call. Split into a two-phase, user-gated flow:

- **Phase 1** (`prepareMint`): sign PTB1 (`create_manager`), call `/quote`, return `{ mgr, ladder, forward, expiry, oracleId, notional, tx }` (PTB2 serialized, unsigned).
- **UI confirm**: render `<PayoffChart size="full">` from `computePayoffCurve(ladder, qtyPerLeg)` + forward, inside the mint card, with **Confirm Mint / Cancel** buttons.
- **Phase 2** (`finalizeMint`): on Confirm, sign PTB2. On Cancel, stop — the manager is already created and reusable (no wasted state); surface that it can be reused or abandoned.

`App.jsx` mint card holds the intermediate state (`mintPhase`: idle → preparing → confirm → minting → done) and renders the preview between phases. Fail-loud: any PTB1/quote error aborts to an error state, never silently proceeds to PTB2.

### 4. `/quote` response addition

`scripts/indexer/server.js` `quote()` currently returns `{ ladder, oracleId, expiry, tx }`. Add two additive fields: `forward` (the oracle forward already computed inside `computeLadder`) and `qtyPerLeg` (computed server-side from net principal so client math cannot drift from the contract — see §Components). Existing callers unaffected. (Pure data passthrough — not business logic.)

### 5. MyNotes integration (read-only chain read)

File: `frontend/src/MyNotes.jsx`.

- Make each note row expandable (click to toggle a detail panel).
- **Read path is backend-mediated** (convention check — Rule 11/Rule 7): the frontend never reads chain objects directly today; *all* chain access (notes, leaderboard, oracle) goes through the indexer server via `api.js`. So a new backend route **`GET /note-params?note=<id>&asset=<a>&expiry=<ms>`** reads the data server-side with the JSON-RPC `SuiClient` and returns parsed JSON — `{ params: { lower, upper, strike_step, qty_per_leg, legs_per_expiry, ... }, forward, settlementPrice }`. This **supersedes** the earlier gRPC `getDynamicField` + browser-BCS approach (review C1-sui/I6-sui): JSON-RPC `client.getDynamicFieldObject({ parentId, name: { type: '<pkg>::note::ParamsKey', value: {} } })` with `showContent` returns `content.fields` already parsed — no hand-written BCS schema needed in the browser. Authoritative `qty_per_leg` comes straight from the on-chain params field.
- `forward` / `settlementPrice` come from the note's oracle (resolved by `asset`+`expiry` like the claim path); read the oracle object raw (do NOT reuse `fetchOracle`, which throws on a settled oracle — claimable notes have a non-null `settlement_price`).
- Frontend `MyNotes.jsx` just `fetch`es `/note-params`, feeds `params` into `computePayoffCurve` and renders `<PayoffChart size="compact">`.
- **On-chain lifecycle constraint** (drives behavior by status):
  - `pending` (not expired): curve + forward marker.
  - `claimable` (expired + settled, not yet claimed): note still on-chain → read params; oracle has `settlement_price` → curve + actual settlement marker + realized-payout dot. **Best case.**
  - `claimed`: note object is **deleted on chain at `claim_finalize`** → params unreadable. Show only the realized payout number already present in the table; **do not draw the curve**. Surface this state explicitly (e.g., "settled & claimed — payout X"), never a broken/empty chart.
- **Dynamic-field read is server-side JSON-RPC** (see expand-flow above; supersedes the browser-gRPC reading of review C1-sui/I6-sui). The server's `SuiClient` (JSON-RPC) `getDynamicFieldObject` returns parsed `content.fields` — no browser BCS. `ParamsKey` Move type for the `name`: `<pkg>::note::ParamsKey`, `value: {}` (unit struct). `RangeParams` Move field order for reference: `version, lower, upper, strike_step, expiry_count, legs_per_expiry, qty_per_leg, hurdle_bps`.
- **State guard (review C3-sui, verified)**: indexer `settled = (a settlements row exists)`, and `NoteSettled` is emitted only in `claim_finalize` → `settled === 1` means **already claimed = note deleted on-chain**. Only attempt the dynamic-field read for `state === 'pending'` or `'claimable'`; for `'settled'` skip the read entirely and render the realized-payout number only.

## Testing

- `frontend/src/payoff.test.js` (or project's test runner): pure-function tests encoding **why** the staircase shape matters —
  - monotonic non-decreasing across price (a leg never reduces payout)
  - exactly `legs` steps, each of height `qty_per_leg`
  - payout = 0 below `lower`, = `qty_per_leg * legs` at/above `upper`
  - **Monkey/guard tests**: `step = 0`, `upper <= lower`, grid-misaligned `(upper-lower) % step != 0`, `legs > 128` → each throws (not silent clamp).
- `<PayoffChart>` + integration: no unit test for SVG; verification gate is `vite build` green + **branch-wide `git diff` invariant** confirming `move/`, contract addresses, dapp-kit wiring, and existing business logic are byte-unchanged (this is a presentation feature). Live visual gate via dev-server screenshot (real browser — not ImageMagick, per lessons).

## Design-review decisions (2026-06-24, sui-frontend + frontend-design/taste)

Layout / composition (排版):
- **Forward-label collision (C3-taste)**: forward label must not float over the curve. When `forward` falls in the right ~30% of the x-range (in-the-money mint), flip the label to the opposite side of its line; settlement and forward labels get vertical offset so they never share a row. Preference: render markers' labels in a thin header strip above the plot, not inside it.
- **Band-edge gridlines (M5-taste)**: full-size chart draws exactly two faint verticals at `lower` and `upper` (the accrual band edges) — this *is* the product story. No more than two (density discipline).
- **MyNotes expand row (I3-taste)**: detail panel is a new `<tr>` with a single `<td colSpan={4}>` spanning the full table width (not inside a status/action cell). Chart `width:100%` with `max-width:~420px`, left-aligned. Add `min-width:0` on the SVG wrapper so `.nl-card`/table `overflow:hidden` doesn't clip it (I2-sui).
- **Confirm/Cancel hierarchy (I4-taste)**: one commit CTA only — **Confirm Mint = existing `.nl-btn--primary` pinkgold**, **Cancel = ghost `.nl-btn`**. Placed below the chart, right-aligned, matching card rhythm. Avoid two competing primaries.
- **Reusable-manager affordance (I3-sui/I4-taste)**: on Cancel after PTB1, transition to a distinct `mintPhase = 'cancelled'` (not silent reset to `idle`); show a muted persistent note with the `mgr` object ID — "Manager kept — re-confirm anytime." Never hide live chain state.
- **Edge-state rendering rules (I5-taste)**: (a) 1-leg note → single L-step; add baseline-zero annotation so it still reads as a payoff. (b) `legs > 24` → hide strike dots, let the gold line carry it. (c) `forward ≥ upper` (flat near-max curve) → annotate "max payout reached at forward" so the full-rectangle fill doesn't look broken.

Aesthetic / brand fidelity (美感):
- **Pearl distinctiveness (M4-taste, M1-taste)**: iridescent `--nacre` fill (above) is the highest-leverage move; optionally a 1px lighter inner highlight on the gold line ("molten edge") and strike dots as tiny pearls (subtle radial highlight). Restraint — this app is low visual-density; precision touches, not effects. Axis ticks in Martian Mono (`--font-mono`) to match the leaderboard's numeric voice.
- **English UI copy (M2-taste)**: preview caption in English ("Payoff preview" / "You're about to mint") — the Chinese mockup string is sketch-only.

Correctness (verified against installed code):
- **`/quote` fields (C2-sui)**: `computeLadder` already returns `forward` (`price.js:32`); `qtyPerLeg` is NOT in its return → compute server-side from net principal and add both `forward` + `qtyPerLeg` (as strings) to the `quote()` response in `server.js`.
- **BigInt math (I4-sui)**: `computePayoffCurve` keeps strike/price/qty in BigInt (oracle ticks are e9, e.g. `60000_000_000_000`); the `(upper-lower) % step` grid guard uses BigInt modulo — float conversion before the guard loses precision and lets misaligned grids pass silently. Convert to Number only at the final pixel-mapping step.
- **Result-shape preservation (I1-sui)**: splitting `runMint` into `prepareMint`/`finalizeMint` must keep the existing `r.$kind === 'FailedTransaction'` / `r.Transaction?.digest` handling for **both** PTB results — do not regress to top-level keys.
- **Status-label branch (M4-sui)**: `state === 'settled'` already means claimed; the payoff panel branches on it to show "Settled & Claimed — payout X dUSDC" (no chart) per §5.

## Out of scope (YAGNI)

- No indexer schema change, no `NoteMinted` event change, no contract redeploy.
- No charting library (D3/Recharts) — inline SVG only.
- No breakeven marker (deferred; can add later as a prop).
- Multi-expiry notes: current mints are single-expiry (`expiry_count = 1`); curve assumes one expiry. Multi-expiry rendering deferred.
- No payoff for already-claimed notes (on-chain params gone) — realized number only.

## Risks / calibration

- **SDK drift** (lessons 2026-06-21): resolved during review — gRPC `getDynamicField` (BCS-keyed) confirmed against installed `.d.mts` (§5). Remaining unknown: the exact `RangeParams` BCS deserialization round-trips correctly; verify with one live read of a real note before wiring the chart.
- **Mint flow regression**: splitting `runMint` must preserve the existing PTB1→quote→PTB2 wiring exactly (only inserting a user gate). Cancel-after-PTB1 leaves a reusable manager — confirm UX communicates this.
- **`/quote` forward field**: confirm `computeLadder` already has `forward` in scope to expose; if not, read from the oracle it already fetched.
