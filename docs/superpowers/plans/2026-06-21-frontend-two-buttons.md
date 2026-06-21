# Frontend Two Buttons (Mint + Claim) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browser dApp that closes the on-chain demo loop — connect wallet → Mint a range-accrual note (2-PTB) → list My Notes → Claim an expired note — reusing the already-verified Node pricing/PTB code with a thin backend.

**Architecture:** Backend exposes 3 POST routes that return **serialized, un-built** `Transaction`s (`tx.serialize()` JSON); the React frontend reconstructs them with `Transaction.from(json)` and signs via dapp-kit, so the connected wallet is always the sender and pays gas. PTB builders are extracted from the existing `scripts/integration/{mint,claim}.js` CLIs into one importable module; `computeLadder` (pricing) is parametrized by `sender`.

**Tech Stack:** Node http (existing indexer server), `@mysten/sui` v1.45.2 (`Transaction`, `SuiClient`), Vite + React + `@mysten/dapp-kit-react`, `@tanstack/react-query`.

## Global Constraints

- SDK package is `@mysten/sui` (NOT `@mysten/sui.js`); class is `Transaction` (NOT `TransactionBlock`). Pin `@mysten/sui` `^1.45.2` to match existing `scripts/*/package.json`.
- Network: testnet only. `RPC = https://fullnode.testnet.sui.io:443` (from `scripts/integration/config.js`).
- Addresses come from `scripts/integration/config.js` (`PKG`, `CFG`, `VAULT`, `PREDICT`, `DUSDC`, `CLOCK`) and `scripts/pricing/oracle.js` (`PREDICT_PKG`). NEVER hardcode `config.ADDR` into any PTB sender — sender is always a function parameter.
- Backend NEVER calls `tx.build({ client })` for the routes (that pins gas/sender). It returns `tx.serialize()`. Exception: the pricing band-probe and the pre-submit guard dry-run internally build throwaway txs — that is existing behavior, unchanged.
- Oracle ids are EPHEMERAL (15-min rolling) — always enumerate fresh per `/quote`, never cache.
- Fail loud (CLAUDE.md Rule 12): every backend error returns `{ error, code, detail }`; frontend surfaces it verbatim, never fakes success.
- maxLegs default 16 (gas-bound, not band-bound) — keep the existing `computeLadder` default.

---

### Task 1: Extract PTB builders + parametrize `computeLadder` sender

Pull the un-built `Transaction` construction out of the two CLI scripts into a single importable module, and make `computeLadder` accept a `sender` (it currently hardcodes `ADDR` in the probe ctx). CLIs keep working by importing the extracted functions.

**Files:**
- Create: `scripts/integration/txbuild.js`
- Create: `scripts/integration/txbuild.test.js`
- Modify: `scripts/integration/mint.js` (replace inline tx construction with `buildMintTx`)
- Modify: `scripts/integration/claim.js` (replace inline tx construction with `buildClaimTx`)
- Modify: `scripts/pricing/price.js:15` (`computeLadder` — add `sender` param, default `ADDR`, use in `ctx.sender`)
- Modify: `scripts/integration/package.json` (add `"type": "module"` if absent; add test script)

**Interfaces:**
- Produces:
  - `buildCreateManagerTx({ sender }) -> Transaction` — single moveCall `${PREDICT_PKG}::predict::create_manager` (no args; returns ID on-chain), `tx.setSender(sender)`, no gas budget set (wallet fills).
  - `buildMintTx({ sender, mgr, oracle, dusdcCoin, notional, lower, upper, step, expiryTotal, asset = 'BTC', walrusBlob = 'walrus-blob-test', isPublic = true }) -> Transaction` — the `mint_begin → mint_add_expiry → mint_finalize` sequence from `mint.js`, with `sender`/`mgr`/`oracle`/`dusdcCoin` as params, `tx.object(...)` left UNRESOLVED (no version), gas budget NOT set.
  - `buildClaimTx({ sender, note, mgr, oracle }) -> Transaction` — the `claim_begin → claim_settle_expiry → claim_finalize` sequence from `claim.js`.
  - `PREDICT_PKG` re-exported from `scripts/pricing/oracle.js`.
- Consumes: `RPC, PKG, CFG, VAULT, PREDICT, DUSDC, CLOCK` from `./config.js`; `PREDICT_PKG` from `../pricing/oracle.js`.

- [ ] **Step 1: Write the failing test** — `scripts/integration/txbuild.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCreateManagerTx, buildMintTx, buildClaimTx } from './txbuild.js';

const SENDER = '0x1509b5fdf09296b2cf749a710e36da06f5693ccd5b2144ad643b3a895abcbc4c';
const ID = '0x' + '1'.repeat(64);

test('buildCreateManagerTx: one moveCall, sender set, gas not pinned', () => {
  const tx = buildCreateManagerTx({ sender: SENDER });
  const d = tx.getData();
  assert.equal(d.sender, SENDER);
  assert.equal(d.gasData.budget, null);            // wallet fills gas
  const calls = d.commands.filter(c => c.MoveCall);
  assert.equal(calls.length, 1);
  assert.match(calls[0].MoveCall.function, /create_manager/);
});

test('buildMintTx: 3 moveCalls (begin/add/finalize) + a splitCoins', () => {
  const tx = buildMintTx({ sender: SENDER, mgr: ID, oracle: ID, dusdcCoin: ID,
    notional: 10000000n, lower: 62600000000000n, upper: 62800000000000n,
    step: 100000000000n, expiryTotal: 1 });
  const d = tx.getData();
  assert.equal(d.sender, SENDER);
  assert.equal(d.gasData.budget, null);
  const fns = d.commands.filter(c => c.MoveCall).map(c => c.MoveCall.function);
  assert.deepEqual(fns, ['mint_begin', 'mint_add_expiry', 'mint_finalize']);
  assert.ok(d.commands.some(c => c.SplitCoins));
});

test('buildClaimTx: 3 moveCalls (begin/settle/finalize)', () => {
  const tx = buildClaimTx({ sender: SENDER, note: ID, mgr: ID, oracle: ID });
  const fns = tx.getData().commands.filter(c => c.MoveCall).map(c => c.MoveCall.function);
  assert.deepEqual(fns, ['claim_begin', 'claim_settle_expiry', 'claim_finalize']);
});

test('buildMintTx: serialize round-trips to a Transaction', async () => {
  const { Transaction } = await import('@mysten/sui/transactions');
  const tx = buildMintTx({ sender: SENDER, mgr: ID, oracle: ID, dusdcCoin: ID,
    notional: 10000000n, lower: 1n, upper: 2n, step: 1n, expiryTotal: 1 });
  const json = tx.serialize();
  const back = Transaction.from(json);
  assert.equal(back.getData().sender, SENDER);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/integration && node --test txbuild.test.js`
Expected: FAIL — `Cannot find module './txbuild.js'`.

- [ ] **Step 3: Write `scripts/integration/txbuild.js`**

```js
// Importable, un-built PTB builders extracted from mint.js / claim.js.
// Every tx leaves object versions UNRESOLVED and gas UNSET — dapp-kit fills both at sign time.
import { Transaction } from '@mysten/sui/transactions';
import { PKG, CFG, VAULT, PREDICT, DUSDC, CLOCK } from './config.js';
import { PREDICT_PKG } from '../pricing/oracle.js';

export { PREDICT_PKG };
const bytes = s => [...new TextEncoder().encode(s)];

export function buildCreateManagerTx({ sender }) {
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({ target: `${PREDICT_PKG}::predict::create_manager`, arguments: [] });
  return tx;
}

export function buildMintTx({ sender, mgr, oracle, dusdcCoin, notional, lower, upper, step,
                             expiryTotal, asset = 'BTC', walrusBlob = 'walrus-blob-test', isPublic = true }) {
  const tx = new Transaction();
  tx.setSender(sender);
  const [pay] = tx.splitCoins(tx.object(dusdcCoin), [BigInt(notional)]);
  const ticket = tx.moveCall({
    target: `${PKG}::note_factory::mint_begin`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(CFG), tx.object(VAULT), tx.object(mgr), pay,
      tx.pure.vector('u8', bytes(asset)),
      tx.pure.u64(BigInt(lower)), tx.pure.u64(BigInt(upper)), tx.pure.u64(BigInt(step)),
      tx.pure.u8(expiryTotal),
      tx.pure.vector('u8', bytes(walrusBlob)),
      tx.pure.bool(isPublic),
    ],
  });
  tx.moveCall({
    target: `${PKG}::note_factory::mint_add_expiry`,
    typeArguments: [DUSDC],
    arguments: [ticket, tx.object(PREDICT), tx.object(mgr), tx.object(oracle), tx.object(CLOCK)],
  });
  tx.moveCall({ target: `${PKG}::note_factory::mint_finalize`, arguments: [ticket, tx.object(CLOCK)] });
  return tx;
}

export function buildClaimTx({ sender, note, mgr, oracle }) {
  const tx = new Transaction();
  tx.setSender(sender);
  const ct = tx.moveCall({
    target: `${PKG}::note_factory::claim_begin`,
    arguments: [tx.object(note), tx.object(mgr), tx.object(CLOCK)],
  });
  tx.moveCall({
    target: `${PKG}::note_factory::claim_settle_expiry`,
    typeArguments: [DUSDC],
    arguments: [ct, tx.object(PREDICT), tx.object(mgr), tx.object(oracle), tx.object(CLOCK)],
  });
  tx.moveCall({
    target: `${PKG}::note_factory::claim_finalize`,
    typeArguments: [DUSDC],
    arguments: [ct, tx.object(mgr), tx.object(VAULT)],
  });
  return tx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/integration && node --test txbuild.test.js`
Expected: PASS (4 tests). If `d.gasData.budget` is `undefined` not `null`, relax those asserts to `assert.ok(!d.gasData.budget)`.

- [ ] **Step 5: Refactor `mint.js` to use `buildMintTx`**

Replace the inline `tx` construction block in `scripts/integration/mint.js` (the `const tx = new Transaction()` through the third `moveCall`) with:

```js
import { buildMintTx } from './txbuild.js';
// ...after parsing env...
const tx = buildMintTx({ sender: ADDR, mgr: MGR, oracle: ORACLE, dusdcCoin: DUSDC_COIN,
  notional: NOTIONAL, lower: LOWER, upper: UPPER, step: STEP, expiryTotal: EXPIRY_TOTAL });
tx.setGasBudget(2_000_000_000); // CLI dry-run still needs an explicit budget
```

Keep the rest of `mint.js` (build, GUARD dry-run, output) unchanged.

- [ ] **Step 6: Refactor `claim.js` to use `buildClaimTx`**

Replace the inline `tx` construction in `scripts/integration/claim.js` with:

```js
import { buildClaimTx } from './txbuild.js';
const tx = buildClaimTx({ sender: ADDR, note: NOTE, mgr: MGR, oracle: ORACLE });
tx.setGasBudget(600_000_000);
```

- [ ] **Step 7: Parametrize `computeLadder` sender** — `scripts/pricing/price.js:15`

Change the signature and ctx:

```js
export async function computeLadder({ client, asset, expiry, notional, mgr, dusdcCoin,
                                      sender = ADDR, stepMult = 1, maxLegs = 16 }) {
  // ...
  const ctx = { client, sender, mgr, cfg: CFG, vault: VAULT, predict: PREDICT,
    dusdc: DUSDC, dusdcCoin, clock: CLOCK, oracleId, notional: BigInt(notional), asset, tickSize: o.tickSize };
  // ...unchanged...
}
```

- [ ] **Step 8: Verify CLIs + pricing tests still pass**

Run: `cd scripts/pricing && node --test ladder.test.js monkey.test.js`
Expected: PASS (existing pure tests unaffected).
Run: `cd scripts/integration && node --test txbuild.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/integration/txbuild.js scripts/integration/txbuild.test.js \
        scripts/integration/mint.js scripts/integration/claim.js \
        scripts/pricing/price.js scripts/integration/package.json
git commit -m "refactor(integration): extract importable PTB builders + sender-param computeLadder"
```

---

### Task 2: Backend dUSDC coin resolver + 3 tx routes

Add a read-only dUSDC coin picker and the 3 POST routes to the existing indexer server. Routes return `{ ... , tx: <serialized> }`. The server gains an optional `client` (SuiClient); tx routes 503 without it, so existing `createServer(db)` tests are untouched.

**Files:**
- Create: `scripts/integration/coins.js`
- Create: `scripts/integration/coins.test.js`
- Modify: `scripts/indexer/server.js` (add `client`/`txdeps` param + POST routing + body parse)
- Modify: `scripts/indexer/server.test.js` (add route tests with a fake client)
- Modify: `scripts/indexer/package.json` (ensure `@mysten/sui` present — it is, `^1.45.2`)

**Interfaces:**
- Produces:
  - `pickDusdcCoin(client, owner) -> Promise<{ coinId, total }>` — `client.getCoins({ owner, coinType: DUSDC })`; throws `{ code: 'NO_DUSDC' }`-shaped Error if none; returns the largest-balance coin's `coinObjectId` + summed balance.
  - Backend routes (all return JSON):
    - `POST /create-manager-tx` `{ sender }` → `{ tx }` (serialized PTB1).
    - `POST /quote` `{ sender, mgr }` → `{ ladder, oracleId, tx }` (serialized PTB2) or 4xx `{ error, code }`.
    - `POST /claim-tx` `{ sender, note, mgr, oracle }` → `{ tx }` (serialized claim PTB).
- Consumes: `buildCreateManagerTx, buildMintTx, buildClaimTx` (Task 1); `computeLadder` (Task 1, sender-param); `pickDusdcCoin`; `DUSDC` from config.

- [ ] **Step 1: Write the failing test for `pickDusdcCoin`** — `scripts/integration/coins.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDusdcCoin } from './coins.js';

const fakeClient = (coins) => ({ getCoins: async () => ({ data: coins }) });

test('pickDusdcCoin: picks largest balance coin', async () => {
  const c = fakeClient([
    { coinObjectId: '0xa', balance: '5' },
    { coinObjectId: '0xb', balance: '12' },
  ]);
  const r = await pickDusdcCoin(c, '0xowner');
  assert.equal(r.coinId, '0xb');
  assert.equal(r.total, 17n);
});

test('pickDusdcCoin: throws NO_DUSDC when empty', async () => {
  await assert.rejects(() => pickDusdcCoin(fakeClient([]), '0xowner'),
    (e) => e.code === 'NO_DUSDC');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/integration && node --test coins.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `scripts/integration/coins.js`**

```js
import { DUSDC } from './config.js';

export async function pickDusdcCoin(client, owner) {
  const { data } = await client.getCoins({ owner, coinType: DUSDC });
  if (!data || data.length === 0) {
    const e = new Error('connected wallet holds no testnet dUSDC — use the faucet first');
    e.code = 'NO_DUSDC';
    throw e;
  }
  const total = data.reduce((a, c) => a + BigInt(c.balance), 0n);
  const largest = data.reduce((a, c) => (BigInt(c.balance) > BigInt(a.balance) ? c : a));
  return { coinId: largest.coinObjectId, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/integration && node --test coins.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing route test** — append to `scripts/indexer/server.test.js`

```js
// --- tx routes (Task 2) ---
import { test as test2 } from 'node:test';
import assert2 from 'node:assert/strict';
import { createServer } from './server.js';

function callRoute(server, method, path, body) {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const { port } = server.address();
      fetch(`http://127.0.0.1:${port}${path}`, {
        method, headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      }).then(async (r) => { const j = await r.json(); server.close(); resolve({ status: r.status, j }); });
    });
  });
}

const fakeDb = { prepare: () => ({ all: () => [], get: () => ({}) }) };
const fakeTxdeps = {
  buildCreateManagerTx: ({ sender }) => ({ serialize: () => `CM:${sender}` }),
  computeLadder: async ({ sender, mgr }) => ({ lower: 1n, upper: 2n, step: 1n, oracleId: '0xorc' }),
  buildMintTx: ({ sender, mgr }) => ({ serialize: () => `MINT:${sender}:${mgr}` }),
  buildClaimTx: ({ sender, note }) => ({ serialize: () => `CLAIM:${sender}:${note}` }),
  pickDusdcCoin: async () => ({ coinId: '0xcoin', total: 1000n }),
};

test2('POST /create-manager-tx returns serialized tx', async () => {
  const srv = createServer(fakeDb, { client: {}, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/create-manager-tx', { sender: '0xS' });
  assert2.equal(status, 200);
  assert2.equal(j.tx, 'CM:0xS');
});

test2('POST /create-manager-tx 400 on missing sender', async () => {
  const srv = createServer(fakeDb, { client: {}, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/create-manager-tx', {});
  assert2.equal(status, 400);
  assert2.equal(j.code, 'BAD_PARAMS');
});

test2('POST /quote returns ladder + tx', async () => {
  const srv = createServer(fakeDb, { client: {}, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: '0xS', mgr: '0xM' });
  assert2.equal(status, 200);
  assert2.equal(j.oracleId, '0xorc');
  assert2.equal(j.tx, 'MINT:0xS:0xM');
});

test2('tx route 503 when no client wired', async () => {
  const srv = createServer(fakeDb);
  const { status } = await callRoute(srv, 'POST', '/quote', { sender: '0xS', mgr: '0xM' });
  assert2.equal(status, 503);
});
```

- [ ] **Step 6: Run route test to verify it fails**

Run: `cd scripts/indexer && node --test server.test.js`
Expected: FAIL — `createServer` ignores 2nd arg / no POST handling.

- [ ] **Step 7: Extend `scripts/indexer/server.js`**

Add body-parse helper and POST routing. Replace `export function createServer(db) {` block:

```js
const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve(null); } });
});

export function createServer(db, { client, txdeps } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      if (req.method === 'GET') {
        if (p === '/leaderboard') return json(res, 200, leaderboard(db));
        if (p === '/notes') return json(res, 200, listNotes(db, {
          issuer: url.searchParams.get('issuer') ?? undefined,
          isPublic: url.searchParams.has('public') ? url.searchParams.get('public') === '1' : undefined,
        }).map(decodeNote));
        if (p === '/pending-settle') return json(res, 200, pendingSettle(db, Date.now()).map(decodeNote));
        if (p === '/fees') return json(res, 200, feeStats(db));
      }
      if (req.method === 'POST') {
        if (!client || !txdeps) return json(res, 503, { error: 'tx routes not configured', code: 'NO_CLIENT' });
        const body = await readBody(req);
        if (body == null) return json(res, 400, { error: 'bad json', code: 'BAD_JSON' });
        if (p === '/create-manager-tx') {
          if (!body.sender) return json(res, 400, { error: 'sender required', code: 'BAD_PARAMS' });
          return json(res, 200, { tx: txdeps.buildCreateManagerTx({ sender: body.sender }).serialize() });
        }
        if (p === '/quote') {
          if (!body.sender || !body.mgr) return json(res, 400, { error: 'sender, mgr required', code: 'BAD_PARAMS' });
          return json(res, 200, await quote(client, txdeps, body));
        }
        if (p === '/claim-tx') {
          if (!body.sender || !body.note || !body.mgr || !body.oracle)
            return json(res, 400, { error: 'sender, note, mgr, oracle required', code: 'BAD_PARAMS' });
          return json(res, 200, { tx: txdeps.buildClaimTx(body).serialize() });
        }
      }
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      return json(res, e.code === 'NO_DUSDC' ? 400 : 500, { error: e.message, code: e.code ?? 'INTERNAL' });
    }
  });
}

async function quote(client, txdeps, { sender, mgr, asset = 'BTC', expiry, notional = '10000000' }) {
  const coin = await txdeps.pickDusdcCoin(client, sender);
  const lad = await txdeps.computeLadder({ client, asset, expiry, notional, mgr, dusdcCoin: coin.coinId, sender });
  const tx = txdeps.buildMintTx({ sender, mgr, oracle: lad.oracleId, dusdcCoin: coin.coinId,
    notional, lower: lad.lower, upper: lad.upper, step: lad.step, expiryTotal: 1, asset });
  return { ladder: { lower: lad.lower.toString(), upper: lad.upper.toString(), step: lad.step.toString() },
           oracleId: lad.oracleId, tx: tx.serialize() };
}
```

Note: `expiry` for `/quote` is required by `computeLadder` (resolveOracle needs it). Add to BAD_PARAMS check in a follow-up if the frontend always sends it — for now the frontend (Task 4) sends `expiry`. Update the `/quote` param guard to also require `body.expiry`.

- [ ] **Step 8: Add `expiry` to the /quote guard**

In the `/quote` branch change the guard to:
```js
if (!body.sender || !body.mgr || !body.expiry) return json(res, 400, { error: 'sender, mgr, expiry required', code: 'BAD_PARAMS' });
```
And in the `/quote` route test (Step 5) add `expiry: '1750000000'` to the body so it stays 200.

- [ ] **Step 9: Run route tests to verify they pass**

Run: `cd scripts/indexer && node --test server.test.js`
Expected: PASS (existing GET tests + new tx-route tests).

- [ ] **Step 10: Wire the real server CLI entrypoint**

At the bottom of `server.js`, replace the CLI block so it constructs a real `client` + `txdeps`:

```js
if (import.meta.url === `file://${process.argv[1]}`) {
  const { openDb } = await import('./db.js');
  const { SuiClient } = await import('@mysten/sui/client');
  const { RPC } = await import('../integration/config.js');
  const txbuild = await import('../integration/txbuild.js');
  const { pickDusdcCoin } = await import('../integration/coins.js');
  const { computeLadder } = await import('../pricing/price.js');
  const db = openDb(process.argv[2] ?? 'indexer.db');
  const port = Number(process.argv[3] ?? 8787);
  const client = new SuiClient({ url: RPC });
  const txdeps = { ...txbuild, pickDusdcCoin, computeLadder };
  createServer(db, { client, txdeps }).listen(port, () => console.log(`[indexer+tx] serving on :${port}`));
}
```

- [ ] **Step 11: Manual smoke (live) — create-manager-tx route**

Run: `cd scripts/indexer && node server.js /tmp/smoke.db 8787 &` then
`curl -s -XPOST localhost:8787/create-manager-tx -H 'content-type: application/json' -d '{"sender":"0x1509b5fdf09296b2cf749a710e36da06f5693ccd5b2144ad643b3a895abcbc4c"}' | head -c 200`
Expected: JSON with a `tx` string (serialized Transaction). Kill the server after.

- [ ] **Step 12: Commit**

```bash
git add scripts/integration/coins.js scripts/integration/coins.test.js \
        scripts/indexer/server.js scripts/indexer/server.test.js
git commit -m "feat(backend): dUSDC coin resolver + create-manager/quote/claim tx routes"
```

---

### Task 3: Frontend scaffold (Vite + React + dapp-kit providers)

Stand up the app shell with wallet connection and a backend API client. No mint/claim yet — just connect + an empty layout that compiles and runs.

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.js`
- Create: `frontend/index.html`
- Create: `frontend/src/main.jsx`
- Create: `frontend/src/config.js`
- Create: `frontend/src/api.js`
- Create: `frontend/src/App.jsx`

**Interfaces:**
- Produces:
  - `frontend/src/config.js` → `export const API = 'http://localhost:8787'; export const EXPLORER = 'https://suiscan.xyz/testnet/tx/';`
  - `frontend/src/api.js` → `postTx(path, body) -> Promise<json>` (throws `Error` with `.code` on non-2xx), `getNotes(issuer) -> Promise<note[]>`.
- Consumes: `@mysten/dapp-kit`, `@mysten/sui`, `@tanstack/react-query`, `react`, `react-dom`, `vite`.

- [ ] **Step 1: Write `frontend/package.json`**

```json
{
  "name": "note-factory-frontend",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build" },
  "dependencies": {
    "@mysten/dapp-kit": "^0.18.0",
    "@mysten/sui": "^1.45.2",
    "@tanstack/react-query": "^5.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": { "@vitejs/plugin-react": "^4.3.1", "vite": "^5.4.0" }
}
```

- [ ] **Step 2: Write `frontend/vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()] });
```

- [ ] **Step 3: Write `frontend/index.html`**

```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Structured Note Factory</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>
</html>
```

- [ ] **Step 4: Write `frontend/src/config.js`**

```js
export const API = 'http://localhost:8787';
export const EXPLORER = 'https://suiscan.xyz/testnet/tx/';
```

- [ ] **Step 5: Write `frontend/src/api.js`**

```js
import { API } from './config.js';

export async function postTx(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) { const e = new Error(j.error || 'request failed'); e.code = j.code; e.detail = j.detail; throw e; }
  return j;
}

export async function getNotes(issuer) {
  const r = await fetch(`${API}/notes?issuer=${issuer}`);
  if (!r.ok) throw new Error('failed to load notes');
  return r.json();
}
```

- [ ] **Step 6: Write `frontend/src/main.jsx`**

```jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SuiClientProvider, WalletProvider, createNetworkConfig } from '@mysten/dapp-kit';
import { getFullnodeUrl } from '@mysten/sui/client';
import '@mysten/dapp-kit/dist/index.css';
import App from './App.jsx';

const { networkConfig } = createNetworkConfig({ testnet: { url: getFullnodeUrl('testnet') } });
const qc = new QueryClient();

createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={qc}>
    <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
      <WalletProvider autoConnect>
        <App />
      </WalletProvider>
    </SuiClientProvider>
  </QueryClientProvider>,
);
```

- [ ] **Step 7: Write `frontend/src/App.jsx` (shell only)**

```jsx
import { ConnectButton, useCurrentAccount } from '@mysten/dapp-kit';

export default function App() {
  const account = useCurrentAccount();
  return (
    <div style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'system-ui' }}>
      <h1>Structured Note Factory</h1>
      <ConnectButton />
      {account && <p>Connected: {account.address}</p>}
    </div>
  );
}
```

- [ ] **Step 8: Install + run dev server to verify it boots**

Run: `cd frontend && npm install && npm run dev`
Expected: Vite serves on `http://localhost:5173`; page shows the title + a Connect button. Stop the dev server (Ctrl-C) after confirming it compiles with no errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/package.json frontend/vite.config.js frontend/index.html frontend/src
git commit -m "feat(frontend): Vite+React+dapp-kit scaffold with wallet connect"
```

---

### Task 4: Frontend Mint flow (2-PTB orchestration)

Wire the Mint button: sign PTB1 (create manager), wait for finality, extract MGR id, quote PTB2, sign it. Includes sender-assert and SUI/dUSDC failure surfacing (fail loud).

**Files:**
- Create: `frontend/src/mint.js`
- Modify: `frontend/src/App.jsx` (add Mint button + status display)

**Interfaces:**
- Consumes: `postTx` (Task 3); dapp-kit `useSignAndExecuteTransaction`, `useSuiClient`, `useCurrentAccount`; `Transaction.from` from `@mysten/sui/transactions`.
- Produces: `runMint({ signAndExecute, client, sender, expiry }) -> Promise<{ mgr, mintDigest }>` (throws on any stage; never returns partial-success silently).

- [ ] **Step 1: Write `frontend/src/mint.js`**

```js
import { Transaction } from '@mysten/sui/transactions';
import { postTx } from './api.js';

// signExec(serializedJson) -> resolves to { digest, objectChanges } (caller wraps dapp-kit hook).
export async function runMint({ signExec, client, sender, expiry }) {
  // PTB1: create manager
  const { tx: cmTx } = await postTx('/create-manager-tx', { sender });
  const r1 = await signExec(cmTx, { showObjectChanges: true });
  // A3: wait finality so the shared manager's initialSharedVersion is resolvable for PTB2.
  await client.waitForTransaction({ digest: r1.digest });
  const changes = r1.objectChanges
    ?? (await client.getTransactionBlock({ digest: r1.digest, options: { showObjectChanges: true } })).objectChanges;
  const mgrChange = changes.find((c) => c.type === 'created' && /::predict_manager::PredictManager/.test(c.objectType));
  if (!mgrChange) throw new Error('PTB1 landed but no PredictManager created — mint NOT completed');
  const mgr = mgrChange.objectId;

  // PTB2: quote + mint
  const q = await postTx('/quote', { sender, mgr, expiry });
  const r2 = await signExec(q.tx, { showObjectChanges: true });
  await client.waitForTransaction({ digest: r2.digest });
  return { mgr, mintDigest: r2.digest, ladder: q.ladder };
}
```

- [ ] **Step 2: Add Mint button to `App.jsx`**

```jsx
import { useState } from 'react';
import { ConnectButton, useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { runMint } from './mint.js';
import { EXPLORER } from './config.js';

export default function App() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: sign } = useSignAndExecuteTransaction();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const signExec = (json, opts) =>
    sign({ transaction: Transaction.from(json), options: opts });

  async function onMint() {
    setBusy(true); setStatus('');
    try {
      // sender-assert (spec §5): never sign a tx built for a different address.
      const sender = account.address;
      const out = await runMint({ signExec, client, sender, expiry: '1' /* set in Step 3 */ });
      setStatus(`Minted ✓ ${EXPLORER}${out.mintDigest}`);
    } catch (e) {
      setStatus(`FAILED: ${e.message}${e.code ? ` [${e.code}]` : ''}`);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'system-ui' }}>
      <h1>Structured Note Factory</h1>
      <ConnectButton />
      {account && (
        <>
          <p>Connected: {account.address}</p>
          <button disabled={busy} onClick={onMint}>{busy ? 'Minting…' : 'Mint Range Note'}</button>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{status}</pre>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Set the real `expiry` value**

`computeLadder`/`resolveOracle` needs a concrete expiry timestamp (ms) that has a live oracle. Reuse the enumeration the indexer/integration already does. For the demo, hardcode the nearest live BTC expiry discovered at calibration time (Task 6) into a constant `frontend/src/config.js → export const DEMO_EXPIRY = '<expiry-ms>';` and pass it: `expiry: DEMO_EXPIRY`. Update the `onMint` call and import.

- [ ] **Step 4: Verify it compiles + balance failure is loud (manual)**

Run: `cd frontend && npm run dev`, connect a wallet with **no dUSDC**, click Mint.
Expected: status shows `FAILED: connected wallet holds no testnet dUSDC … [NO_DUSDC]` after PTB1 (the quote step raises it). Confirms fail-loud path. (Full happy path is Task 6.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/mint.js frontend/src/App.jsx frontend/src/config.js
git commit -m "feat(frontend): 2-PTB mint flow with finality wait + fail-loud surfacing"
```

---

### Task 5: Frontend My Notes + Claim flow

List the connected address's notes from the indexer and add a Claim button per expired note.

**Files:**
- Create: `frontend/src/MyNotes.jsx`
- Modify: `frontend/src/App.jsx` (render `<MyNotes />` when connected)

**Interfaces:**
- Consumes: `getNotes` (Task 3); `postTx` for `/claim-tx`; dapp-kit hooks; note row shape from indexer `/notes` (`note_id`, `manager_id`/`mgr`, `oracle_id`, `expiry_ts_ms`, `settled`). Verify exact column names against `scripts/indexer/db.js` schema before relying on them (calibration).
- Produces: `<MyNotes account client signExec />` component.

- [ ] **Step 1: Verify note row column names**

Run: `cd scripts/indexer && node -e "import('./db.js').then(({openDb})=>{const d=openDb(process.argv[1]);console.log(d.prepare('SELECT * FROM notes LIMIT 1').all());})" <path-to-live.db>`
Expected: prints one note row — note the exact keys for note id, manager id, oracle id, expiry. Use those keys in Step 2 (the column names below — `note_id`, `manager_id`, `oracle_id`, `expiry_ts_ms` — are the assumed schema; correct them if they differ).

- [ ] **Step 2: Write `frontend/src/MyNotes.jsx`**

```jsx
import { useEffect, useState } from 'react';
import { getNotes } from './api.js';
import { postTx } from './api.js';
import { EXPLORER } from './config.js';

export default function MyNotes({ account, client, signExec }) {
  const [notes, setNotes] = useState([]);
  const [msg, setMsg] = useState('');

  async function load() { try { setNotes(await getNotes(account.address)); } catch (e) { setMsg(e.message); } }
  useEffect(() => { load(); }, [account.address]);

  async function claim(n) {
    setMsg('');
    try {
      const { tx } = await postTx('/claim-tx', {
        sender: account.address, note: n.note_id, mgr: n.manager_id, oracle: n.oracle_id,
      });
      const r = await signExec(tx, { showEffects: true });
      await client.waitForTransaction({ digest: r.digest });
      setMsg(`Claimed ✓ ${EXPLORER}${r.digest}`);
      load();
    } catch (e) { setMsg(`CLAIM FAILED: ${e.message}${e.code ? ` [${e.code}]` : ''}`); }
  }

  const now = Date.now();
  return (
    <div>
      <h2>My Notes</h2>
      <button onClick={load}>Refresh</button>
      {notes.length === 0 && <p>No notes yet.</p>}
      <ul>
        {notes.map((n) => {
          const expired = Number(n.expiry_ts_ms) < now;
          return (
            <li key={n.note_id}>
              {n.note_id.slice(0, 10)}… · expiry {new Date(Number(n.expiry_ts_ms)).toISOString()}
              {n.settled ? ' · settled' : expired
                ? <button onClick={() => claim(n)}>Claim</button>
                : ' · not yet expired'}
            </li>
          );
        })}
      </ul>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{msg}</pre>
    </div>
  );
}
```

- [ ] **Step 3: Render `<MyNotes />` in `App.jsx`**

Inside the `{account && ( ... )}` block, after the mint `<pre>`, add:
```jsx
<MyNotes account={account} client={client} signExec={signExec} />
```
And import: `import MyNotes from './MyNotes.jsx';`

- [ ] **Step 4: Verify it compiles + lists notes (manual)**

Run: `cd frontend && npm run dev` (with the backend server running and an indexer db that has notes for the connected address).
Expected: My Notes shows the address's notes; expired+unsettled rows show a Claim button.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/MyNotes.jsx frontend/src/App.jsx
git commit -m "feat(frontend): My Notes list + per-note Claim button"
```

---

### Task 6: Live E2E round-trip + calibration + Monkey

Run the full loop against testnet through the browser wallet, calibrating the live-verified assumptions (A3/A4 object-change shape, DEMO_EXPIRY, note column names), then the Monkey adversarial cases. No new production code unless calibration reveals a mismatch.

**Files:**
- Modify: `frontend/src/config.js` (set real `DEMO_EXPIRY`)
- Modify (only if calibration mismatches): `frontend/src/mint.js`, `frontend/src/MyNotes.jsx`
- Create: `tasks/e2e-two-buttons-log.md` (round-trip evidence)

- [ ] **Step 1: Discover a live BTC expiry + set DEMO_EXPIRY**

Run: `cd scripts/pricing && node -e "import('./oracle.js').then(async ({resolveOracle})=>{const {SuiClient}=await import('@mysten/sui/client');const c=new SuiClient({url:'https://fullnode.testnet.sui.io:443'});/* enumerate OracleCreated for BTC, print expiries */})"`
Use the existing oracle-enumeration path (`resolveOracle` / `suix_queryEvents OracleCreated`) to list live BTC expiries; pick the nearest future one. Set `frontend/src/config.js → DEMO_EXPIRY`.

- [ ] **Step 2: Calibrate PTB1 objectChange shape (A4)**

Start backend (`cd scripts/indexer && node server.js indexer.db 8787`), `cd frontend && npm run dev`, connect a wallet funded with dUSDC + SUI, click Mint. Watch the browser console / network. Confirm `runMint` finds the `PredictManager` created object. If the type regex `::predict_manager::PredictManager` doesn't match the live `objectType`, fix the regex in `mint.js` to the real string and re-run.

- [ ] **Step 3: Complete the happy-path mint**

Expected: both signatures succeed; status shows `Minted ✓ <explorer link>`. Open the link — verify a note object was created and soulbound to the wallet. Record the two digests in `tasks/e2e-two-buttons-log.md`.

- [ ] **Step 4: Verify the note appears in My Notes**

Ensure the indexer has ingested the new mint (run `scripts/indexer/ingest.js` if the indexer isn't tailing live). Refresh My Notes — the new note shows. Confirm `note_id`/`manager_id`/`oracle_id`/`expiry_ts_ms` keys matched (Task 5 Step 1); fix `MyNotes.jsx` if any differ.

- [ ] **Step 5: Claim round-trip**

For a note past expiry (use a near-term expiry so it lapses during the session, or a previously-minted expired note), click Claim. Expected: `Claimed ✓ <link>`. Verify on explorer: payout returned, note deleted, FeeVault credited — to the Task 8 reconciliation bar. Record digest + FeeVault delta in the log.

- [ ] **Step 6: Monkey (per test.md)** — confirm each loud-fails, nothing silent:

  - **User-reject mid-flow**: reject PTB1 → status `FAILED` (not stuck "Minting…"); reject PTB2 after PTB1 lands → status shows mint NOT completed, no fake success.
  - **Stale quote**: quote, wait > one oracle roll (~15 min) before signing PTB2 → backend pre-submit guard or on-chain dry-run rejects; status shows the band/abort code, prompts re-quote (re-click Mint).
  - **Insufficient dUSDC**: wallet with SUI but no dUSDC → `NO_DUSDC` surfaced at quote.
  - **Sender mismatch**: in devtools, tamper the `/quote` body `sender` to another address → frontend sender-assert (or wallet) refuses; document the observed guard. If the assert isn't actually enforced in `onMint`, add `if (body.sender !== account.address) throw` and re-test.
  - **Oversized params**: not user-reachable (ladder maxLegs=16 caps it); note this is structurally prevented, not silently dropped.

  Record each outcome (one line each) in `tasks/e2e-two-buttons-log.md`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/config.js tasks/e2e-two-buttons-log.md
# include mint.js / MyNotes.jsx only if calibration changed them
git commit -m "test(e2e): live testnet mint->claim round-trip + Monkey; calibrate A3/A4/expiry/schema"
```

---

## Self-Review

**Spec coverage:**
- §2.1 serialized-un-built signing model → Task 1 (builders leave gas unset), Task 4 (`Transaction.from` + dapp-kit). ✓
- §3 three routes + dUSDC coin input (A2) + shared-mgr finality (A3) → Task 2 (routes, `pickDusdcCoin`), Task 4 (`waitForTransaction` before PTB2). ✓
- §3.1 extract importable functions → Task 1. ✓
- §4 frontend buttons + My Notes → Tasks 3–5. ✓
- §4 A4 objectChanges → Task 4 Step 1 (`showObjectChanges`) + Task 6 Step 2 calibration. ✓
- §5 error handling (oracle roll, 2-stage interrupt, balance, structured errors, sender guard) → Task 2 (structured codes, NO_DUSDC), Task 4 (fail-loud status, mint-not-completed), Task 6 Step 6 (Monkey, sender-assert). ✓
- §6 testing (routes, e2e, monkey) → Tasks 1,2 (unit) + Task 6 (e2e/monkey). ✓
- §7 out-of-scope → not built. ✓
- §8 A1 JSON-RPC (no Quorum Driver in demo paths) → respected (wallet exec + dryRun only). ✓

**Placeholder scan:** `expiry`/`DEMO_EXPIRY` and note column names are explicitly deferred to Task 6 calibration with concrete discovery commands, not vague TODOs. Regexes/type tags flagged for live verification. No bare "add error handling".

**Type consistency:** `buildMintTx`/`buildClaimTx`/`buildCreateManagerTx` signatures identical across Task 1 (def), Task 2 (`txdeps` calls), Task 4. `computeLadder({ ..., sender, dusdcCoin })` consistent Task 1 ↔ Task 2 `quote()`. `signExec(json, opts)` consistent Task 4 ↔ Task 5. `postTx`/`getNotes` consistent Task 3 ↔ 4 ↔ 5.
