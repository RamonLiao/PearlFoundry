# Payoff leftover — feed real `leftover` into the staircase chart

Date: 2026-06-24
Branch: `fix/mint-claim-ui-tweaks`
Status: design (live-calibrated)
Spec author: pairing session (live testnet calibration before design)

## Problem

The payoff chart's B-core shift skeleton (`computePayoffCurve({…, leftover})`, `PayoffChart.jsx`)
is shipped but `leftover` is still hard-pinned to `0n` at both call sites. So the staircase floors
at `0` and caps at `qty×legs` (= 9.97 for a 10-notional note), which **understates both ends** and
misleadingly implies a guaranteed loss. The real Range-Accrual payoff is

```
payout(settlement) = leftover + qty_per_leg × (#strikes strictly below settlement)
leftover           = net_principal − Σ premium      (unspent premium kept in the manager)
```

We need the real `leftover` fed into the curve at the mint preview (`/quote`) and at MyNotes
(already-minted notes).

## Live calibration (done before this design — overturned the prior assumption)

Calibrated against the live round-trip note
`0x136990dd5cab8f5ce98c937cda91ac421cb3caa8cd4966be3a98a4b0896136d9`
(mint tx `pd7MjqmDFz2esSH5YNC5BdLTqbZ85NZ21D5KQ6mrLXN`, manager
`0x94479f0d…4c7afc`, predict pkg `0xf5ea2b37…785138`).

| Mechanism | Result | Verdict |
|---|---|---|
| `dryRun` → `balanceChanges` (the progress-note assumption) | dUSDC `−10000000` = whole **notional**, sender-level | ✗ never exposes premium; wrong by `Σpremium` |
| live `predict_manager::balance<T>(mgr)` via devInspect | `15042035` (= cap, post-settlement) | ✗ time-dependent: equals mint-time leftover only before any leg settles |
| **Σ `PositionMinted.cost` from mint events** | floor **5072035** = 5.07 dUSDC | ✓ immutable, lifecycle-independent |

Reconciliation (cross-validates the formula):

- `net_principal` = `notional − issuance_fee` = `10000000 − 30000` = `9970000`
  (also exactly the `BalanceEvent{deposit:true}.amount`).
- 16 `PositionMinted` events, each carries `cost` (premium for that leg; `cost ≈ ask_price×qty/1e9`).
  `Σcost = 4897965`.
- `leftover = 9970000 − 4897965 = 5072035` → **floor = 5.07 dUSDC**.
- `cap = leftover + qty_per_leg×legs = 5072035 + 623125×16 = 15042035` → **15.04 dUSDC**.
- Live `balance()` returned `15042035` = **exactly the cap** → this note settled fully ITM (BTC
  above the upper band, all 16 legs redeemed). The "anomaly" was the all-ITM payoff and it
  confirms the math rather than contradicting it.

`devInspect` confirmed `predict_manager::balance` is `Public`/returns `U64` — it works, it is just
the wrong (time-dependent) quantity. We do not use it.

## Design

**Single authoritative source: the mint transaction's events.** `PositionMinted` (one per leg)
carries `cost`, `strike`, `quantity`, `manager_id`. `BalanceEvent{deposit:true}` carries the
deposited `net_principal`. From one `getTransactionBlock(digest, {showEvents:true})` (or one
`dryRunTransactionBlock` for a preview) we can derive `leftover` and, if needed, reconstruct the
full staircase params.

### Shared helper — `scripts/indexer/leftover.js` (new)

Pure function, no I/O, unit-testable:

```
deriveLeftover(events) -> { leftover: bigint, net: bigint, sumCost: bigint, legs: number }
```

- Sum `cost` over events whose type ends with `::PositionMinted`.
- `net` from the `BalanceEvent` with `deposit === true` (dUSDC asset), `bigint`.
- `leftover = net − sumCost`; **fail-loud** if `net` missing, `legs === 0`, or `leftover < 0`
  (negative leftover = premiums exceeded net = impossible → surface, don't silently clamp).
- Optional `deriveParamsFromEvents(events)` → `{ lower, upper, strike_step, qty_per_leg, legs_per_expiry }`
  from the `PositionMinted` strikes/quantity, for the settled-note fallback (below).

### `/quote` (mint preview)

`quote()` already builds the mint `tx`. Add: dry-run that exact tx, fail-loud on non-success
(this also subsumes the `mint.js` GUARD staleness check), then `deriveLeftover(dryRun.events)`.
Return `leftover` (string) in the quote response. Preview is **approximate** — orderbook depth can
shift between quote and the real PTB2 — documented in the response/comment.

### `/note-params` (already-minted)

1. Look up the note's `tx_digest` from the db `notes` table by `note_id` (db handle already passed
   to `createServer`). 404 `NO_MINT_TX` if absent.
2. `getTransactionBlock(tx_digest, {showEvents:true})` → `deriveLeftover(events)`.
3. Params: keep the existing `getDynamicFieldObject` (`ParamsKey {dummy_field:false}`) for an
   alive note. **If the df is gone (claimed/deleted), reconstruct params via
   `deriveParamsFromEvents(events)`** so a settled note still draws its staircase (per decision:
   show the chart even after claim).
4. Oracle `forward`/`settlementPrice` read unchanged (best-effort try/catch).
5. Response gains `leftover` (string).

### Frontend

Pass `leftover` (parse to `BigInt`) into `computePayoffCurve({…, leftover})` at both call sites
(`App.jsx` mint preview, `MyNotes.jsx`). If the field is absent → keep `0n` fallback (no
regression; B-core already pixel-identical at `leftover=0`).

## Components & boundaries

| Unit | Purpose | Depends on |
|---|---|---|
| `scripts/indexer/leftover.js` | pure event→leftover/params derivation | nothing (events array in) |
| `/quote` patch | preview leftover via mint dry-run | `leftover.js`, existing `buildMintTx` |
| `/note-params` patch | persisted-note leftover + settled-note param fallback | `leftover.js`, db `notes`, `getTransactionBlock` |
| frontend call sites | feed `leftover` into existing curve | response field only |

## Error handling

- `/quote` dry-run non-success → `502`/fail-loud (don't return a quote with bogus leftover);
  mirrors the existing pre-submit GUARD intent.
- `deriveLeftover` fail-loud on missing `net` / zero legs / negative leftover.
- `/note-params` missing `tx_digest` → `404 NO_MINT_TX`; mint-tx fetch failure → `502`.
- Frontend absent `leftover` → `0n` fallback (graceful, no crash, matches B-core).

## Testing

- `leftover.test.js`: fixture = the real tx `pd7Mjqm…` event array (16 costs above) → asserts
  `leftover === 5072035n`, `net === 9970000n`, `legs === 16`. Encodes **why**: leftover is 5.07,
  not `0` (the old pin) and not `15.04` (live balance). Negative-leftover and missing-`BalanceEvent`
  cases assert fail-loud. `deriveParamsFromEvents` asserts lower/upper/step/qty match the note.
- Existing `payoff.test.js` (16/16) unchanged — B-core curve math already covers `leftover>0`.
- `vite build` green; backend `node --test` green.
- Live: re-run `/note-params?note=0x136990dd…` and `/quote` against testnet, confirm `leftover`
  ≈ 5.07 (note) and a sane positive preview.

## Chart-internal display fixes (folded in — surfaced by the design review)

Feeding a real `leftover` makes `baseline > 0`, which exposes display gaps in `PayoffChart.jsx`
that B-core left. These are scoped IN because they are the same chart block and one (the baseline
label) is a genuine data-integrity bug, not cosmetics:

- **C1 (bug) — baseline Y-tick.** With `baseline > 0` the fill floor sits at `py(baseline)` but the
  Y axis only labels `0` (`:99`) and `maxPayout` (`:100`). The reader sees the staircase float above
  an unlabeled "0" with the floor (leftover, the holder's all-OTM reclaim) unannotated. Add a third
  Y-tick at `py(baseline)` labelled `fmt(baseline)` **when `baseline > 0`** (skip when `0` →
  no regression vs current 2-tick look). Also update the SVG `aria-label` (`:53`) to state the
  non-zero floor.
- **C2 — forward marker colour split** (`:84` line `--rust` vs `:86` label `--chart-fwd` gold).
  Unify to gold (`--chart-fwd`) for line + label so the forward annotation reads as one element,
  not "warning line + value label".
- **C3 — settlement marker contrast** (`:91-94` all `--pearl` ≈ near-black, low contrast on the pale
  nacre fill). Move to a distinct readable ink (reuse `--jade`, already the positive-PnL colour, or
  a dedicated `--chart-settlement` token) so the post-expiry settlement point stays legible.
- **C4 — preview overflow guard.** `.nl-preview` (App.css) has no `max-height`/scroll; a many-leg
  chart can push Cancel/Confirm below the mobile fold. Add a `max-height` + `overflow:auto` guard
  on small viewports.
- **C5 — SVG max-width conflict.** Inline `maxWidth: full?480:420` (`:54`) vs Leaderboard.css
  `.nl-detail svg { max-width:420px }` clips the right-edge tick/settlement marker at 480px.
  Reconcile to a single source of truth.

Tests: extend `payoff.test.js`/a `PayoffChart` smoke to assert the baseline tick renders iff
`baseline>0` and the floor label equals `fmt(leftover)`. `vite build` green.

## Deferred (separate follow-up tasks — tracked in progress.md)

These came out of the same design review but are a larger scope and **not** folded in:

- **Chart-as-centerpiece + de-AI pass**: break the 760px single column, 2-column chart + metric
  rail (Max Payout / Band / Forward / Breakeven / PnL), nacre fill that actually shimmers,
  staircase `stroke-dashoffset` entrance, desaturated-molten primary button (drop the pink candy
  gradient + pink glow), WCAG floor (`--chart-tick`, `--pearl-dim`, `--ink-faint` to ≥4.5:1),
  `✓`/`↗` glyphs → SVG. Own brainstorming → plan.
- **MyNotes/Leaderboard UX batch**: Claim button → primary, expanded-row close affordance,
  manager-id truncation (`slice(0,12)` shows all-zeros on padded ids → use last-8), leaderboard
  loading skeleton, mint spinner. Low-risk batch.

## Out of scope (separate follow-up)

`/quote` should on-chain verify `mgr` belongs to `sender` (codex security finding; currently only
id-format + XSS guarded). Tracked as its own write-path/auth task — not mixed into this read-path
display fix.
