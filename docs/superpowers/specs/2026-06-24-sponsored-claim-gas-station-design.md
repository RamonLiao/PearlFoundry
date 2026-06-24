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
  - `@mysten/dapp-kit-react` 2.1.3 exposes `useDAppKit()` → singleton with `signTransaction({ transaction })` (sign-only; `transaction` accepts a serialized base64 string) → returns `{ bytes, signature }`. Also `useCurrentClient()` → gRPC client (`SuiGrpcClient`, per existing `frontend/src/dapp-kit.js`).
  - `@mysten/sui` `Transaction` has `setSender` / `setGasOwner` / `setGasPayment` / `setGasBudget` (and `setExpiration`).
  - `SuiGrpcClient.executeTransaction({ transaction, signatures: [...] })` (verified in `@mysten/sui/grpc` d.ts) — this is the execution path. **JSON-RPC `executeTransactionBlock` is NOT used** (Quorum Driver disabled under Protocol 126, permanent deactivation 2026-07-31). `dryRunTransactionBlock` (used by `/quote`) is unaffected.
- Sui sponsored-tx mechanism: a tx with `GasData.owner = sponsor` and `gasPayment` = sponsor's coins requires **two signatures** (sponsor + sender). Either party can submit once both sigs exist. Signature array order is **not** significant — the verifier matches each signature to its required signer (sender address + gas-owner address) by address.
- **Unverified SDK behavior (speculation until probed):** that dapp-kit 2.1.3 `signTransaction` with a base64 *string* arg signs the bytes verbatim and does **not** re-resolve `gasData` when `gasOwner != sender`. Some wallet adapters historically rebuild/overwrite gas on sponsored txs. The frontend MUST byte-compare the wallet-returned `bytes` against the sponsor-signed `txBytes` and fall back if they differ (see Architecture + C2-hardening). Confirm against a testnet probe before relying on it.

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
   { bytes: holderBytes, signature: holderSig } = dAppKit.signTransaction({ transaction: txBytes })
   ASSERT holderBytes === txBytes  (byte-for-byte; wallet must NOT have rebuilt/re-resolved gasData)
       → if mismatch: abort sponsored path, fall back to self-pay
   client.executeTransaction({ transaction: txBytes, signatures: [holderSig, sponsorSig] })  // gRPC, NOT JSON-RPC
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
  - **`assertClaimable(client, note, sender)`** — `getObject(note)`: exists (else 400 `BAD_NOTE`), `owner.AddressOwner` normalized == sender normalized (else 403 `NOTE_NOT_OWNED`). Settled-ness is the **dry-run's** job — it is the authoritative gate (the real `claim_begin→settle→finalize` PTB aborts on-chain if not settled / already claimed, and the sponsor signs only *after* a successful dry-run, so a non-settled note can't drain the sponsor). `assertClaimable` is the cheap owner/exists fail-fast that runs **before** the expensive dry-run. *(Optimization, not a security boundary: if the note's settled flag is a readable struct field, check it here to skip the dry-run for the obvious "not yet settled" case.)*
- **`frontend/src/claimSponsored.js` (new)** — `sponsoredClaim({ dAppKit, client, sender, note, mgr, oracle, apiBase })`: POST `/sponsor-claim` → `signTransaction({ transaction: txBytes })` → **assert returned `bytes === txBytes`** (else throw, wallet mutated gasData) → dual-sig `client.executeTransaction({ transaction: txBytes, signatures: [holderSig, sponsorSig] })` (gRPC). Throws on any step (and surfaces *where* it failed: pre-popup vs post-holder-sign) so the caller can branch the fallback per the Frontend-presentation rules.
- **`frontend/src/MyNotes.jsx` (changed)** — Claim handler tries `sponsoredClaim`; on throw, falls back to the current self-pay claim. Optimistic-remove on success unchanged.

## Frontend presentation (Nacre vocabulary — layout & aesthetics)

The Claim cell currently cycles `Claim` → `Claiming…` with no loader. The sponsored flow has 4 distinct async beats and needs affordance. All reuse existing tokens (`--molten`, `--gold-ink`, `--surface-sunk`, `--hairline`, `--font-mono`, `.nl-spinner`, `.nl-pill`, `.nl-statuspip`, `sr-only role=status`). No spinners-while-waiting-on-human, no AI-slop.

- **gas-free chip (MUST)** — a conditional `nl-gaschip` next to the Claimable status text (NOT on the button — bloating the label reflows the narrow num cell). Copy: lowercase **"gas-free"** (understated mono voice). Style borrows `.nl-pill`: `font-mono` 10px, `--gold-ink` on `--surface-sunk`, 1px `--hairline`, radius 999px, `padding:2px 8px` (≈4.6:1 contrast, AA). Icon: a hand-drawn **rising bubble/droplet** inline SVG (`class="nl-li"` 12px, `stroke=currentColor` 1.6) — on-theme "you carry no weight." **Conditional on a sponsor-availability signal**; if unknown at render, **omit** the chip (don't promise then retract). Do NOT use `--molten`/`--gold-b` for chip *text* (fails on light); gradient ok only for an optional dot.
- **4-phase button copy (MUST)** — pin `min-width` (~150px, like `nl-issue-row`) so swaps don't reflow:
  | step | label | loader |
  |---|---|---|
  | idle | `Claim` | — (chip on row) |
  | POST /sponsor-claim | `Sponsoring…` | `.nl-spinner` |
  | awaiting wallet sig | `Approve in wallet →` | **no spinner** (waits on human; spinner falsely implies app busy — an arrow cues *their* action) |
  | executing | `Submitting…` | `.nl-spinner` |
  | done | row optimistically removed | `nl-status--ok` |
- **fallback branches by failure point (MUST)** — pre-popup failures (503 `NO_SPONSOR`, 502 dry-run, sponsor-sign error, `NO_SPONSOR_GAS`, **byte-equality mismatch**) → fall back **silently** to self-pay (one wallet popup total; optional quiet `nl-note` "Gas sponsor unavailable — you'll cover gas this time"). Failure **after** holder already signed (execute error) → surface `nl-status--err`, **do NOT auto re-sign** (that's the confusing double-prompt). When self-pay is used, drop the gas-free chip on next render so realized state isn't a lie.
- **error copy (MUST)** — honest prose + raw code in brackets (matches existing `[${e.code}]`): 403 `NOTE_NOT_OWNED`/`MGR_NOT_OWNED` → "This note isn't yours to claim." and **skip fallback** (self-pay would abort too — don't burn a popup); 502 `CLAIM_DRYRUN_FAILED` → "This note isn't settled yet (or was already claimed)."; never surface a bare HTTP status.
- **success narrative (SHOULD)** — `✓ Claimed (gas-free)` vs `✓ Claimed` so the 0-SUI demo story is visible. Ensure the status renders **before** the optimistic row-removal (MyNotes.jsx:109) — don't let removal race the status-set.
- **a11y (MUST)** — `sr-only role=status aria-live=polite` mirroring each step ("Requesting sponsor" / "Approve in your wallet" / "Submitting claim" / "Claimed gas-free"); reuse existing pattern. **Add `.nl-spinner i { animation: none; }` to the `@media (prefers-reduced-motion)` block** (currently only kills `nl-statuspip--claimable`); static chip; keep focus on the Claim button across the disabled→enabled toggle / optimistic removal.

Key files for implementer: `frontend/src/MyNotes.jsx` (Claim cell ~186–197, status ~236–241, optimistic removal ~109), `frontend/src/App.css` (`nl-btn--primary` ~88–102, `nl-spinner` ~286–296, `nl-statuspip` ~144–158, reduced-motion ~211–220, `nl-pill` ~278–284), `frontend/src/theme.css` (tokens ~6–33).

## Config / constants

- `SPONSOR_KEY` (env) — sponsor private key. **Never logged, never returned.** A funded testnet keypair for the hackathon.
- `SPONSOR_GAS_CAP` — server-pinned gas budget for sponsored claims. Claim is ~gas-negative (measured −0.0072 SUI); CAP set conservatively as a hard ceiling (**0.02 SUI = 20_000_000 MIST**). This is a *reservation* (the gas coin must hold ≥ CAP), not the cost — same trap as `buildMintTx`'s pinned-budget comment. Client-supplied budget is **ignored**.

## Red Team (money-flow path) — 5 vectors + defense

1. **Arbitrary caller drains sponsor by requesting sponsorship** — attacker submits own/random note to `/sponsor-claim` to burn sponsor SUI. **Defense:** `assertManagerOwner` + `assertClaimable` (sender must be the real owner; note must be a real settled note); illegal → 400/403 before any signing.
2. **Inflated gasBudget drains sponsor per call** — **Defense:** server pins budget to `SPONSOR_GAS_CAP`; client budget ignored.
3. **Holder signs different bytes than sponsor signed (sponsor signs A, holder submits B)** — **Defense:** holder signs the *exact* sponsor-signed bytes verbatim (`signTransaction({ transaction: txBytesString })`, no re-build); both sigs bind the same `TransactionData`; execute rejects if either sig mismatches.
4. **Replay / double-claim to burn gas** — **Defense:** note is deleted on-chain on claim (by-value); a second `/sponsor-claim` fails `assertClaimable` / dry-run aborts before sponsor signs.
5. **Sponsor gas-coin contention (single coin, concurrent claims → version race)** — concurrent `/sponsor-claim` calls may `pickGasCoins` the *same* coin at the same observed version, both sponsor-sign; the first to execute wins, the second **fails** with object-version mismatch → frontend falls back to self-pay. **Liveness-only, not fund loss** (nothing actually serializes the requests). Acceptable for single-sponsor hackathon. **Roadmap (non-blocking):** per-request coin reservation / multi-coin gas pool.
6. **Unauthenticated `/sponsor-claim` spam (DoS / RPC-cost amplifier)** — each request costs 2 gRPC `getObject`s (foreign/bad note, rejected pre-dry-run) or, for an owned settled note, a full 3-move-call dry-run. No fund loss (sponsor signs only post-dry-run-success on an owned settled note). Cheap owner/exists checks correctly gate the expensive dry-run (order matters). Mitigated only by deployment-level rate-limiting — **out of scope, flagged** (single-sponsor demo).

**Staleness window (liveness, not safety):** sponsor builds+signs on the backend; holder signs+submits seconds-to-minutes later. `TransactionData` has no default expiration so the tx doesn't time out — but the pre-signed payload pins specific sponsor gas-coin versions; any other sponsor-address tx in between invalidates them → execution fails → fallback. Optionally cap with `tx.setExpiration({ Epoch: currentEpoch + 1 })`. RGP drift is a non-issue (epoch-boundary only; stale-low RGP tx simply rejected). **Not a fund-loss vector.**

## Testing / verification

- **Pure-function TDD:** gas-coin selection (sufficient / insufficient / multi-coin), `loadSponsor` fail-loud (missing/malformed key), sponsored-bytes assembly shape.
- **Backend route monkey:** foreign sender → 403, non-owned note → 403, unsettled/bad note → 400/502, missing sponsor → 503, inflated client budget ignored (CAP enforced).
- **Live (human-deferred = browser wallet):** testnet real wallet claims a settled note via sponsored path; confirm (a) holder spends **0 SUI**; (b) sponsor balance change reflects gas-negative ledger; (c) **byte-equality holds** — `signTransaction`'s returned `bytes` matches the sponsor-signed `txBytes` (confirms the unverified-SDK assumption; if it fails, the fallback catches it but the sponsored path is dead until fixed). This C2 probe should be run early — it's the single load-bearing unknown.

## Out of scope / roadmap

- Mint sponsorship.
- Multi-coin gas pool for concurrent sponsorship.
- Rate-limiting / per-address quotas on the gas station (single-sponsor hackathon; production concern).
```