# Threat Model — Structured Note Factory

> Companion to `docs/specs/2026-06-16-structured-note-factory-spec.md`. Scope: `note_factory`, `note`, `strategy_*`, `fee_vault`, `leaderboard`.

## Trust assumptions

- `predict::*` / `predict_manager::*` / `oracle::OracleSVI` are trusted DeepBook primitives (out of our audit scope, but we defend against their failure modes — see T5).
- Walrus blob availability is best-effort; compliance value relies on immutability, not availability.
- Admin keys (`FactoryAdminCap`, `FeeAdminCap`) are honest-but-bounded: they cannot reach user funds by design.

## Attack vectors & defenses

| # | Vector | Scenario | Defense | Residual risk |
|---|---|---|---|---|
| T1 | Access-control bypass | Attacker tries to drain notes via admin path | Admin caps only govern params + pause; `claim` gated by `owner == sender` + `manager_id` match; no admin fund path | Pause = self-limiting DoS only |
| T2 | Integer overflow/underflow | Crafted notional/coupon overflows payoff math | u128 intermediates + checked arithmetic; notional cap; coupon_bps bounded | none if caps enforced |
| T3 | Object manipulation | Settle one strategy with another's math; extract collateral without consuming note | `NoteBase<phantom S>` type-binds strategy; `claim` consumes whole note + asserts `manager_id == id(mgr)` **AND all legs settled (T9)** | Kiosk resale owner mismatch (see T6) |
| T4 | Economic / settlement MEV | Permissionless settler front-runs to steal payout | `redeem_permissionless` only settles into manager; `withdraw` proceeds forced to holder (`ctx.sender()`, soulbound); settler gets only gas (optional fixed tip) | tip griefing — bounded |
| T5 | Oracle manipulation | Manipulated SVI/settlement_price misprices payoff (the Ribbon $2.7M killer) | Require `oracle.status == settled`; cross-check mark vs Pyth; deviation > threshold → `Defaulted` (best-effort principal return, spec §5.4) | Pyth liveness → mass Defaulted; mitigated by defined Defaulted payout |
| T6 | Custody/auth mismatch (OPEN) | `PredictManager.owner` fixed at creation ≠ resold note holder → claim breaks or funds locked | MVP: **on-chain soulbound** (`key` only, no `store`) — non-transferability enforced, not promised. v1: confirm manager owner reassignment via §1.3 disasm before enabling resale | blocks secondary market until resolved |
| T7 | DoS via leg count | Huge multi-leg note bloats PTB / gas-bombs settlement | MVP notional cap bounds leg count; per-note manager isolates contention; ≤3 distinct expiries/note (OracleSVI shared-object lock cap) | shared `&mut Predict` contention at scale |
| T8 | Walrus mismatch | Term sheet swapped post-mint | blob_id bound in NoteBase at mint, immutable; frontend verifies hash | Walrus 5xx → demo fallback banner |
| T9 | Partial-settle stranded funds | Claim a multi-leg note with only some legs settled → unsettled value stranded after note deleted | `claim` settles all legs atomically (`redeem_permissionless`/`redeem_range` per key) + post-asserts `position(mgr,key)==0` before `withdraw` (spec §5.3 / review F2) | none if invariant enforced |

## Pre-mainnet gates

1. Resolve §1.3 ABI open items (withdraw auth, manager shared/owned) — blocks T6.
2. Full Move test suite incl. monkey tests (double-claim, redeem-before-expiry, oracle-not-settled).
3. Oracle deviation threshold tuned against 2-week SVI replay before any real issuance.
