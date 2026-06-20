# Pricing Engine — Range-Accrual Strike Ladder Design

Date: 2026-06-20
Status: APPROVED (brainstorm)

## Problem

`predict::mint` enforces a per-leg ask-price **band**: strikes too far OTM abort
(`assert_mintable_ask` code 7; extreme OTM crashes `pricing_config` quote at code 1).
Task 8 found range-accrual `lower/upper/step` cannot be hardcoded — they must be
derived from the live forward at mint time. The pricing-engine produces a valid
strike ladder (every leg passes the band) automatically, replacing the manual
`LOWER/UPPER/STEP` env in `mint.js`.

## Decisions (locked in brainstorm)

- **Band判定**: dry-run probing (not off-chain SVI replication). Robust to Predict
  internal changes; aligns with lesson "runtime gate 要實證別臆測".
- **交付形態**: CLI + pure JS module under `scripts/pricing/`, importable by `mint.js`.
- **Forward 來源**: oracle 為主（read `prices.forward`）, recent `PositionMinted`
  events 為 sanity 驗證。
- **目標函式**: 最大化合法寬度 (max width within band), legs dynamic, capped at MAX_LEGS=128.

## On-chain facts (verified 2026-06-20, live testnet oracle)

OracleSVI (`oracle::Oracle`) content fields:
- `prices: PriceData { forward, spot }` — e.g. forward `63511223744899` (1e9 scale)
- `svi: SVIParams { a, b, m, ... }` — not used (dry-run path)
- `settlement_price` — null until settled
- `expiry`, `underlying_asset`, `active`
OracleCreated event (`registry::OracleCreated`): `oracle_id`, `expiry`,
`underlying_asset`, `min_strike` (e.g. `50000e9`), `tick_size` (e.g. `1e9` = $1).
Oracle IDs are EPHEMERAL (~15-min rolling) → must resolve dynamically, never hardcode.

Predict package: `0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138`

## Architecture (`scripts/pricing/`)

### 1. `oracle.js` — forward source
- `resolveOracle(asset, expiry)`: `suix_queryEvents` enumerate `registry::OracleCreated`,
  match (asset, expiry) → `oracle_id`.
- `fetchOracle(oracleId)`: `getObject` → `{ forward, spot, tickSize, minStrike, expiry, settled }`.
- event validation: recent `PositionMinted` strike distribution → `[minSeen, maxSeen]`
  sanity band; engine result outside → `warn` (non-fatal).

### 2. `probe.js` — dry-run band probing (core)
- **Stateful precondition (A1):** `isMintable` is NOT stateless. `mint_begin` charges
  notional/fee and `splitCoins` + balance-asserts BEFORE the per-leg band check. So
  probe REQUIRES the same context mint uses: `{ DUSDC_COIN (balance ≥ notional), MGR,
  CFG, VAULT }`, and ALL probes share ONE fixed notional (band is ask-price-vs-strike;
  hold notional constant to isolate the variable). An underfunded coin aborts before
  the band check → whitelist throws → probe dies (correctly, loud), not a band signal.
- `isMintable(strike)`: build minimal 1-leg mint PTB → `dryRunTransactionBlock` →
  classify: `success` / band-reject (code 7) / pricing-config crash (code 1) / other.
- `findBoundary(forward, dir)`:
  1. assert `isMintable(snap(forward))` else throw (band/oracle anomaly).
  2. exponential outward from forward (step=tickSize) until first fail.
  3. binary search [last_ok, first_fail] → last-good strike.
  - memoize `isMintable` per strike. ~2·log₂ dry-runs per side (≲30 testnet).

### 3. `ladder.js` — pure, max-width (unit-tested, TDD)
- input `{ forward, tickSize, minStrike, loBound, hiBound }`.
- snap forward to tickSize grid; `lower = max(minStrike, loBound)`, `upper = hiBound`,
  `step = tickSize` (CLI override `step = k·tickSize`).
- `legs = (upper-lower)/step + 1`; if `legs > MAX_LEGS(128)` shrink symmetrically inward
  (stays forward-centered — same invariant as A2).
- returns `{ lower, upper, step, legs, center: forward, oracleId, oracleTimestamp, forward }`.

### Ladder staleness TTL (A2)
The `[loBound, hiBound]` boundary is bound to the forward at probe time. The oracle
rolls ~every 15 min; a ladder computed and then minted late can fail band (code 7).
**Invariant: ladder is compute-then-mint-immediately.** `computeLadder` returns
`oracleTimestamp` + `forward`; `mint.js` re-fetches the oracle before submit and
aborts if `timestamp` changed or `|forward_now − forward_compute| ≥ step`.

### 4. `price.js` — CLI entry
- env/argv: `ASSET`(BTC), `EXPIRY`, `NOTIONAL`, `EXPIRY_TOTAL`, optional `STEP_MULT`, `MAX_LEGS`.
- stdout JSON `{ oracle, lower, upper, step, legs }`; `mint.js` imports `computeLadder`.

## Error handling (fail loud — Rule 12)

| Case | Action |
|------|--------|
| oracle settled (`settlement_price != null`) | throw |
| resolveOracle no match | throw, list available expiries |
| forward itself not mintable | throw |
| unexpected abort code (not 1/7) | throw + print raw effects (no misclassify as band) |
| legs > MAX_LEGS | shrink to 128 symmetric, `log` dropped width (no silent cap) |
| event sanity band mismatch | `warn`, non-fatal (order-of-magnitude only — A4) |
| oracle timestamp/forward moved before mint | mint.js aborts (A2 TTL) |

Abort-code whitelist: only code 1/7 = band boundary; all others throw. Prevents
misreading "insufficient dUSDC" as "strike too far" → wrong boundary.

### A4 — event sanity band is pollution-prone
`PositionMinted` is Predict-global (all strategies' strikes, incl. others' far-OTM).
Use `[minSeen, maxSeen]` only as an order-of-magnitude sanity check; the authoritative
boundary is always dry-run, never the event history.

## Data layer note (A3)
All RPC here is JSON-RPC (`suix_queryEvents` / `sui_getObject` / `dryRunTransactionBlock`),
which is deprecated as of Protocol 124 (Quorum Driver disabled, removal ~2026-04). It
still works on testnet, `dryRun` does NOT use Quorum Driver (no tx submission), and this
matches existing `scripts/integration` (Rule 11 conformance) → JSON-RPC is acceptable for
the hackathon. Known debt: migrate event/object reads to GraphQL (beta); dryRun pending
gRPC equivalent.

## Testing (Rule 9: test why, not just what)

- `ladder.js` pure unit (TDD, no RPC):
  - symmetry around forward; `legs` formula; step=k·tickSize divisibility.
  - MAX_LEGS shrink stays symmetric + forward-centered (encodes "must hug forward" invariant).
  - minStrike clamp when loBound < minStrike.
- `probe.js` integration (live testnet, 1 oracle): hiBound success, hiBound+step fail
  (boundary exactness, not off-by-one).
- staleness guard (A2): stub oracle timestamp change between compute and mint → mint.js
  aborts (encodes "compute-then-mint-immediately" invariant).
- Monkey (test.md): expired oracle, tiny tickSize, notional=0, forward near minStrike (clamp).

## Out of scope (YAGNI)
- No SVI math replication. No frontend / HTTP service. No auto-submit (outputs ladder only).
