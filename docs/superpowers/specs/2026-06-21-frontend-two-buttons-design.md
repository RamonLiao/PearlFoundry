# Spec — Frontend Two Buttons (Mint + Claim)

> 2026-06-21 · Structured Note Factory · Track 2 DeepBook Predict
> Scope **A** (minimal demo loop). B/C recorded as future upgrades (§7).

## 1. Goal

Browser dApp that closes the on-chain demo loop: connect wallet → **Mint** a
Range Accrual note → see **My Notes** → **Claim** an expired note. Reuses the
already-verified Node code (`scripts/pricing/`, `scripts/integration/`,
`scripts/indexer/`) — no pricing/PTB logic rewrite, no Move change.

Success criteria:
- Connected browser wallet mints a range-accrual note on testnet (2 signatures).
- My Notes lists the connected address's notes from the indexer.
- An expired note claims successfully on testnet; FeeVault reconciles and note
  is deleted — same bar as the Task 8 round-trip.

## 2. Architecture

Thin backend (extends the existing indexer server, same process) + React dApp.
Both reuse verified Node code.

### 2.1 Key signing decision

Backend does **NOT** `build({ client })`. Building pins gas coins and forces the
backend to know the sender's coins. Instead the backend returns a **serialized,
un-built `Transaction`** (`tx.serialize()` JSON). Frontend reconstructs with
`Transaction.from(json)` and hands it to dapp-kit `signAndExecuteTransaction`,
which auto-fills the connected wallet as sender, selects gas, builds, and signs.

Consequence: sender is always the connected wallet; gas is paid by the wallet.
PTB builders must take `sender` as a parameter (never hardcode `config.ADDR`),
because some moveCalls/coin selection reference the sender.

## 3. Backend (extend `scripts/indexer/server.js`)

New POST routes in the same process. Existing read-only routes
(`/notes`, `/leaderboard`, `/pending-settle`, `/fees`) unchanged.

- `POST /create-manager-tx` — body `{ sender }`.
  Returns serialized PTB1 (`predict::create_manager`, owner = sender).
- `POST /quote` — body `{ sender }`.
  Runs the existing `scripts/pricing/` dry-run band probe live (enumerates the
  ORACLE id fresh each call, never cached), returns
  `{ ladder, oracleId, mintTx }` where `mintTx` is the serialized un-built PTB2
  (`mint_begin → mint_add_expiry×N → mint_finalize`).
  Before serializing, run the existing pre-submit dry-run guard (`GUARD=1`
  logic). If the band moved out (oracle rolled), return 4xx `{ error, code }`
  → frontend prompts re-quote.
- `POST /claim-tx` — body `{ sender, note, mgr, oracle }`.
  Returns serialized claim PTB (`claim_begin → claim_settle_expiry×N →
  claim_finalize`).

### 3.1 Refactor needed

`scripts/pricing/price.js` and `scripts/integration/{mint,claim}.js` currently
build + dry-run inside CLI scripts. Extract the PTB-builder and ladder-compute
bodies into importable functions (`sender` as param). Keep existing logic;
this is a mechanical extraction, not a rewrite. CLI entrypoints stay working by
calling the extracted functions.

## 4. Frontend (`frontend/`, Vite + React + @mysten/dapp-kit-react)

- `<ConnectButton>` from dapp-kit.
- **Mint button** flow:
  1. `POST /create-manager-tx { sender }` → `signAndExecuteTransaction(PTB1)`.
  2. Extract MGR id from effects (created shared object / objectChanges).
  3. `POST /quote { sender }` → `signAndExecuteTransaction(PTB2)`.
  4. Show explorer link + note id.
- **My Notes**: `GET /notes?issuer=<addr>`; each expired note gets a **Claim**
  button → `POST /claim-tx { sender, note, mgr, oracle }` →
  `signAndExecuteTransaction` → show result.
- Insufficient dUSDC/SUI → block with faucet hint (no auto-faucet).

### 4.1 Data flow

```
[Mint] click → /create-manager-tx → wallet sign(PTB1) → MGR id
            → /quote(sender)       → wallet sign(PTB2) → minted
[Claim] /notes → pick expired → /claim-tx → wallet sign → settled
```

## 5. Error handling (fail loud — per CLAUDE.md Rule 12, lessons)

- **Oracle 15-min roll**: `/quote` enumerates oracle fresh; pre-submit dry-run
  guard before serialize; band-out → 4xx `{ error, code }` → "re-quote".
- **2-stage mint interrupted**: PTB1 lands but PTB2 fails / user rejects →
  harmless empty manager (consistent with one-note-one-manager; next mint makes
  a fresh one). Frontend shows "PTB1 on-chain, mint NOT completed" — never fake
  success.
- **Insufficient balance**: check dUSDC + SUI before mint; block and name which
  is missing + faucet link.
- **Structured errors**: backend returns `{ error, code, detail }`; frontend
  surfaces abort code verbatim (never swallows).
- **Sender guard**: backend builds PTB with body `sender`; frontend asserts
  `body.sender === connectedAddress` before submit, rejects mismatch (prevents
  signing someone else's tx).

## 6. Testing

- **Backend routes**: extend `server.test.js` style for the 3 POST routes —
  happy path, missing params, sender injection. Extracted pricing/PTB pure
  functions reuse existing pricing tests.
- **E2E live (testnet)**: manual mint→claim round-trip via browser wallet, to
  the Task 8 bar (FeeVault reconcile, note deleted).
- **Monkey** (per test.md): user-reject mid-flow, stale quote, insufficient
  balance, sender mismatch, > maxLegs params — each must loud-fail, not silent.
- Frontend UI logic is thin; no heavy component tests. Weight on backend routes
  + live loop.

## 7. Out of scope (YAGNI — future upgrades)

Recorded for later (B/C from brainstorming):
- **B**: leaderboard / fees read-only view (backend already serves it).
- **C**: payoff diagram, Monte-Carlo, parameter wizard, backtest replay.
- Walrus term-sheet upload; sponsored-tx / gas station settlement; faucet
  button; other strategy templates (capped-upside, principal-protected, roll).

## 8. Known assumptions / risks

- Connected wallet already holds testnet dUSDC + SUI (manual faucet).
- MGR-id extraction from PTB1 effects must be verified against real
  `signAndExecuteTransaction` response shape (objectChanges vs effects.created)
  — calibrate live, per the project's "runtime assumptions = dry-run verify"
  rule.
- dapp-kit `Transaction.from(serializedJson)` round-trip must preserve the
  un-built PTB (verify the serialize/deserialize path early).
