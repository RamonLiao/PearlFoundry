# Sponsored-tx Gas Station (claim-only) — Design

**Date:** 2026-06-24
**Status:** Approved (brainstorming) → writing-plans next
**Scope:** Let a note holder claim a settled note **without holding SUI** for gas. A backend gas station sponsors (pays) the gas; the holder only signs. Claim-only (mint stays self-funded).

## Motivation

`claim` is the "I just want my payout, don't make me pre-fund SUI" path. It is a single PTB and measured **gas-negative** (≈ −0.0072 SUI, storage rebate > gas), so sponsoring claim gas costs the sponsor ≈ 0 (net positive). This is both a real UX win and a demo narrative ("our gas station ledger goes *up*").

Mint is explicitly **out of scope**: it is 2-PTB and the holder already must hold dUSDC (already touching assets), so sponsoring gas adds little while exploding the dual-sign flow.

## Background (verified, not assumed)

- Existing `/claim-tx` route (`scripts/indexer/server.js`) returns a serialized **unbuilt** PTB; the holder signs + pays gas via `dAppKit.signAndExecuteTransaction`. This path stays untouched as the fallback.
- `buildClaimTx({ sender, note, mgr, oracle })` (`scripts/integration/txbuild.js`) builds `claim_begin → claim_settle_expiry → claim_finalize`. Reused as-is.
- `assertManagerOwner(client, mgr, sender)` (existing guard) — exact-type-match `PREDICT_MGR_TYPE` + owner==sender, double-side normalized. Reused.
- **SDK verified (installed):**
  - `@mysten/dapp-kit-react` 2.1.3 exposes `useDAppKit()` → singleton with `signTransaction({ transaction })` (sign-only; `transaction` accepts a serialized base64 string) → returns `{ bytes, signature }`. Also `useCurrentClient()` → gRPC client.
  - `@mysten/sui` `Transaction` has `setSender` / `setGasOwner` / `setGasPayment` / `setGasBudget`.
- Sui sponsored-tx mechanism: a tx with `GasData.owner = sponsor` and `gasPayment` = sponsor's coins requires **two signatures** (sponsor + sender). Either party can submit once both sigs exist.

## Architecture

```
Frontend Claim(sponsored) ──POST /sponsor-claim {sender,note,mgr,oracle}──▶ backend gas station
   1. assertManagerOwner(mgr, sender)           [reuse existing guard]
   2. assertClaimable(note, sender)             [new: note exists, owner==sender, settled]
   3. buildClaimTx({sender,note,mgr,oracle})    [reuse existing builder]
   4. setSender(sender) + setGasOwner(sponsor) + setGasPayment(sponsorCoins) + setGasBudget(CAP)
   5. dry-run the exact tx  (staleness / abort guard, same pattern as /quote)
   6. tx.build({client}) → sponsorKeypair signs the bytes
   └──▶ { txBytes (base64), sponsorSig }

Frontend:
   holderSig = dAppKit.signTransaction({ transaction: txBytes }).signature   // signs the SAME bytes verbatim
   client.executeTransactionBlock({ transactionBlock: txBytes, signature: [holderSig, sponsorSig] })
   on any error → fallback: existing /claim-tx + signAndExecuteTransaction (self-pay)
```

**Submission point:** frontend (it already has the gRPC client and already executes claims). Backend **only builds + sponsor-signs**; it never sees or holds the holder signature — minimal trust surface.

**UX:** sponsored is the default Claim path; on any sponsored-path failure (gas station 503, sponsor sign error, insufficient sponsor balance, execute error) the frontend falls back to the existing self-pay claim. The self-pay path is unchanged — sponsored is layered on top, the existing closed loop is not broken.

## Components / files

- **`scripts/integration/sponsor.js` (new)**
  - `loadSponsor()` — load keypair from env `SPONSOR_KEY` (Bech32 `suiprivkey...` or base64; fail-loud if missing/malformed). Returns `{ keypair, address }`.
  - `pickGasCoins(client, sponsorAddr, budgetMist)` — select sponsor SUI coin(s) totalling ≥ budget; throws `NO_SPONSOR_GAS` if insufficient.
  - `signSponsored({ tx, client, sponsor })` — `tx.build({ client })` then sponsor signs; returns `{ txBytes /*base64*/, sponsorSig }`.
  - Pure-testable seams: gas-coin selection logic and env-parse/fail-loud are unit-tested; the build+sign is integration-tested.
- **`scripts/indexer/server.js` (changed)**
  - New route `POST /sponsor-claim` with body `{ sender, note, mgr, oracle }`.
    1. validate body (400 `BAD_PARAMS` on missing field)
    2. if sponsor not configured → 503 `NO_SPONSOR`
    3. `assertManagerOwner(client, mgr, sender)` (403 `MGR_NOT_OWNED` / 400 `BAD_MGR`)
    4. `assertClaimable(client, note, sender)` — new guard (see below)
    5. build claim tx, set sender + gas owner/payment/budget(CAP), dry-run (502 `CLAIM_DRYRUN_FAILED` on abort)
    6. sponsor-sign → 200 `{ tx: txBytes, sponsorSig }`
  - `loadSponsor()` runs at server start; failure leaves sponsor unconfigured (route → 503) rather than crashing the HTTP server (keeps `/notes`, `/leaderboard`, self-pay `/claim-tx` alive).
  - **`assertClaimable(client, note, sender)`** — `getObject(note)`: exists (else 400 `BAD_NOTE`), `owner.AddressOwner` normalized == sender normalized (else 403 `NOTE_NOT_OWNED`), and the note is in a settled/claimable state. Settled-ness is enforced primarily by the **dry-run** (claim aborts on-chain if not settled / already claimed); `assertClaimable` provides the cheap fail-fast and owner check before spending a dry-run.
- **`frontend/src/claimSponsored.js` (new)** — `sponsoredClaim({ dAppKit, client, sender, note, mgr, oracle, apiBase })`: POST `/sponsor-claim`, `signTransaction`, dual-sig `executeTransactionBlock`; throws on any step so the caller can fall back.
- **`frontend/src/MyNotes.jsx` (changed)** — Claim handler tries `sponsoredClaim`; on throw, falls back to the current self-pay claim. Optimistic-remove on success unchanged.

## Config / constants

- `SPONSOR_KEY` (env) — sponsor private key. **Never logged, never returned.** A funded testnet keypair for the hackathon.
- `SPONSOR_GAS_CAP` — server-pinned gas budget for sponsored claims. Claim is ~gas-negative; CAP set conservatively (proposed **0.05 SUI = 50_000_000 MIST**) as a hard ceiling. Client-supplied budget is **ignored**.

## Red Team (money-flow path) — 5 vectors + defense

1. **Arbitrary caller drains sponsor by requesting sponsorship** — attacker submits own/random note to `/sponsor-claim` to burn sponsor SUI. **Defense:** `assertManagerOwner` + `assertClaimable` (sender must be the real owner; note must be a real settled note); illegal → 400/403 before any signing.
2. **Inflated gasBudget drains sponsor per call** — **Defense:** server pins budget to `SPONSOR_GAS_CAP`; client budget ignored.
3. **Holder signs different bytes than sponsor signed (sponsor signs A, holder submits B)** — **Defense:** holder signs the *exact* sponsor-signed bytes verbatim (`signTransaction({ transaction: txBytesString })`, no re-build); both sigs bind the same `TransactionData`; execute rejects if either sig mismatches.
4. **Replay / double-claim to burn gas** — **Defense:** note is deleted on-chain on claim (by-value); a second `/sponsor-claim` fails `assertClaimable` / dry-run aborts before sponsor signs.
5. **Sponsor gas-coin contention (single coin, concurrent claims → version race / InsufficientGas)** — **Defense:** `pickGasCoins` selects sufficient coin(s); hackathon single-sponsor accepts serialization. **Roadmap (non-blocking):** multi-coin gas pool / coin locking for concurrent sponsorship.

## Testing / verification

- **Pure-function TDD:** gas-coin selection (sufficient / insufficient / multi-coin), `loadSponsor` fail-loud (missing/malformed key), sponsored-bytes assembly shape.
- **Backend route monkey:** foreign sender → 403, non-owned note → 403, unsettled/bad note → 400/502, missing sponsor → 503, inflated client budget ignored (CAP enforced).
- **Live (human-deferred = browser wallet):** testnet real wallet claims a settled note via sponsored path; confirm holder spends **0 SUI**, sponsor balance change reflects gas-negative ledger.

## Out of scope / roadmap

- Mint sponsorship.
- Multi-coin gas pool for concurrent sponsorship.
- Rate-limiting / per-address quotas on the gas station (single-sponsor hackathon; production concern).
```