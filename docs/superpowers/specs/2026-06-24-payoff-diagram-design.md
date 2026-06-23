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

Visual (locked via visual companion — "A×B hybrid, tone primarily A"):
- nacre gradient fill under the curve (`--nacre` stops, low opacity)
- molten/gold step line (`#e0a03c`, `--molten` family), `stroke-linejoin: round`
- strike dots on each step vertex (gold)
- forward: rust dashed vertical line (`--rust` `#cc6a4f`) + mono label
- settlement marker (when settled): distinct vertical + filled dot at `(settlementPrice, payout(settlementPrice))`
- Inline SVG only (matches existing icon pattern: `stroke=currentColor` idiom, no external lib).
- Accessibility: `role="img"` + `aria-label` summarizing range, max payout, forward; honor `prefers-reduced-motion` (no entrance animation, or static).
- Uses existing theme tokens / `--font-mono`; no hardcoded palette beyond what tokens provide.

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
- On expand, read the note's `RangeParams` dynamic field (key `ParamsKey`) via the dapp-kit client, plus the note's oracle for `forward` / `settlement_price`.
- Render `<PayoffChart size="compact">`.
- **On-chain lifecycle constraint** (drives behavior by status):
  - `pending` (not expired): curve + forward marker.
  - `claimable` (expired + settled, not yet claimed): note still on-chain → read params; oracle has `settlement_price` → curve + actual settlement marker + realized-payout dot. **Best case.**
  - `claimed`: note object is **deleted on chain at `claim_finalize`** → params unreadable. Show only the realized payout number already present in the table; **do not draw the curve**. Surface this state explicitly (e.g., "settled & claimed — payout X"), never a broken/empty chart.
- The exact dapp-kit-react 2.x dynamic-field read API (`getDynamicFieldObject` / gRPC equivalent on `SuiGrpcClient`) MUST be verified against installed `node_modules` types before coding (project has repeatedly hit @mysten SDK version drift; treat any API name here as provisional).

## Testing

- `frontend/src/payoff.test.js` (or project's test runner): pure-function tests encoding **why** the staircase shape matters —
  - monotonic non-decreasing across price (a leg never reduces payout)
  - exactly `legs` steps, each of height `qty_per_leg`
  - payout = 0 below `lower`, = `qty_per_leg * legs` at/above `upper`
  - **Monkey/guard tests**: `step = 0`, `upper <= lower`, grid-misaligned `(upper-lower) % step != 0`, `legs > 128` → each throws (not silent clamp).
- `<PayoffChart>` + integration: no unit test for SVG; verification gate is `vite build` green + **branch-wide `git diff` invariant** confirming `move/`, contract addresses, dapp-kit wiring, and existing business logic are byte-unchanged (this is a presentation feature). Live visual gate via dev-server screenshot (real browser — not ImageMagick, per lessons).

## Out of scope (YAGNI)

- No indexer schema change, no `NoteMinted` event change, no contract redeploy.
- No charting library (D3/Recharts) — inline SVG only.
- No breakeven marker (deferred; can add later as a prop).
- Multi-expiry notes: current mints are single-expiry (`expiry_count = 1`); curve assumes one expiry. Multi-expiry rendering deferred.
- No payoff for already-claimed notes (on-chain params gone) — realized number only.

## Risks / calibration

- **SDK drift** (lessons 2026-06-21): verify dapp-kit-react 2.x dynamic-field read + `SuiGrpcClient` shape against installed `.d.mts` before implementing MyNotes read; treat API names in §5 as provisional.
- **Mint flow regression**: splitting `runMint` must preserve the existing PTB1→quote→PTB2 wiring exactly (only inserting a user gate). Cancel-after-PTB1 leaves a reusable manager — confirm UX communicates this.
- **`/quote` forward field**: confirm `computeLadder` already has `forward` in scope to expose; if not, read from the oracle it already fetched.
