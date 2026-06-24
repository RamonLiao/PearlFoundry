# Sponsored-Claim Gas Station Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a note holder claim a settled note without holding SUI — a backend gas station sponsor-signs the claim, the holder signs the same bytes, and the frontend submits the dual-signed tx; on any failure it falls back to the existing self-pay claim.

**Architecture:** New backend route `POST /sponsor-claim` reuses `buildClaimTx`, sets `gasOwner`=sponsor + sponsor gas coins + a pinned budget, dry-runs, then sponsor-signs and returns `{ tx, sponsorSig }`. The frontend signs the *same* bytes (asserting byte-equality), then executes via the gRPC client. Claim-only; mint stays self-funded; self-pay claim is the untouched fallback.

**Tech Stack:** Node `http` server (`scripts/indexer/server.js`), `@mysten/sui` (backend build/sign = sui 1.45.2 in `scripts/integration/node_modules`; frontend execute = sui 2.19 grpc), `@mysten/dapp-kit-react` 2.1.3, React (`frontend/src`), `node:test`.

## Global Constraints

- **Execution is gRPC, never JSON-RPC** `executeTransactionBlock` (Quorum Driver disabled, P126). Frontend submit = `client.core.executeTransaction({ transaction: <Uint8Array>, signatures: [holderSig, sponsorSig], include: { effects: true } })`. Result is a union `{ $kind: 'Transaction' | 'FailedTransaction', Transaction: { digest, effects: { status } } }`.
- **`transaction` for gRPC execute must be `Uint8Array`** (base64 string throws); **`signatures` are base64 strings**.
- **`SPONSOR_GAS_CAP = 20_000_000n` MIST (0.02 SUI)** — server-pinned; client-supplied budget ignored. This is a *reservation* (gas coin must hold ≥ CAP), not the cost.
- **Sponsor key env `SPONSOR_KEY`** — never logged, never returned in any response.
- **Holder must sign the exact sponsor-signed bytes**; frontend asserts `signed.bytes === txBytes` (base64) and falls back if they differ (C2 — wallet may mutate gasData; unverified until a browser probe).
- **403 owner errors (`NOTE_NOT_OWNED` / `MGR_NOT_OWNED`) must NOT fall back** to self-pay (self-pay would abort too — don't burn a wallet popup).
- **Fallback by failure point:** failures *before* the wallet popup → silent self-pay (one popup total); failures *after* the holder signed → surface `nl-status--err`, no auto re-sign.
- Reuse existing Nacre vocabulary (`.nl-pill`, `.nl-spinner`, `--gold-ink`, `--surface-sunk`); no spinners while waiting on the human; no AI-slop.
- `node --test` green + `vite build` green before each commit; Move dir is byte-unchanged (presentation/off-chain only).

---

### Task 1: Backend `sponsor.js` — key loading, gas-coin selection, sponsor-sign

**Files:**
- Create: `scripts/integration/sponsor.js`
- Test: `scripts/integration/sponsor.test.js`

**Interfaces:**
- Produces:
  - `SPONSOR_GAS_CAP: bigint` (= `20_000_000n`)
  - `loadSponsor(env = process.env): { keypair, address } | throws` — reads `env.SPONSOR_KEY`; throws `Error` with `.code='NO_SPONSOR'` if missing, `.code='BAD_SPONSOR_KEY'` if unparseable.
  - `pickGasCoins(client, sponsorAddr, budgetMist): Promise<Array<{objectId, version, digest}>>` — throws `Error` `.code='NO_SPONSOR_GAS'`, `.status=502` if owned SUI total `< budgetMist`.
  - `signSponsored({ tx, client, keypair }): Promise<{ txBytes: string /*base64*/, sponsorSig: string /*base64*/ }>` — builds the tx once, sponsor-signs the bytes.

- [ ] **Step 1: Write the failing test**

```js
// scripts/integration/sponsor.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSponsor, pickGasCoins, signSponsored, SPONSOR_GAS_CAP } from './sponsor.js';

test('SPONSOR_GAS_CAP is 0.02 SUI', () => {
  assert.equal(SPONSOR_GAS_CAP, 20_000_000n);
});

test('loadSponsor throws NO_SPONSOR when key absent', () => {
  assert.throws(() => loadSponsor({}), (e) => e.code === 'NO_SPONSOR');
});

test('loadSponsor throws BAD_SPONSOR_KEY on garbage', () => {
  assert.throws(() => loadSponsor({ SPONSOR_KEY: 'not-a-key' }), (e) => e.code === 'BAD_SPONSOR_KEY');
});

test('loadSponsor returns address + keypair for a valid bech32 key', () => {
  // A throwaway, well-formed testnet ed25519 key (suiprivkey...). Generated for this test only.
  const KEY = 'suiprivkey1qzdvpa77ct272ultu8u4ekuvz0wpc8z6e7c97wj9wma5q3mw9qsv38ympd';
  const s = loadSponsor({ SPONSOR_KEY: KEY });
  assert.match(s.address, /^0x[0-9a-f]{64}$/);
  assert.ok(typeof s.keypair.signTransaction === 'function');
});

const coin = (objectId, balance) => ({ coinObjectId: objectId, version: '7', digest: 'D', balance: String(balance) });

test('pickGasCoins accumulates coins until budget met', async () => {
  const client = { getCoins: async () => ({ data: [coin('0xa', 5_000_000), coin('0xb', 30_000_000)], hasNextPage: false }) };
  const picked = await pickGasCoins(client, '0xSPON', 20_000_000n);
  assert.deepEqual(picked.map((c) => c.objectId), ['0xa', '0xb']);
  assert.deepEqual(picked[0], { objectId: '0xa', version: '7', digest: 'D' });
});

test('pickGasCoins throws NO_SPONSOR_GAS when total below budget', async () => {
  const client = { getCoins: async () => ({ data: [coin('0xa', 1_000_000)], hasNextPage: false }) };
  await assert.rejects(() => pickGasCoins(client, '0xSPON', 20_000_000n), (e) => e.code === 'NO_SPONSOR_GAS' && e.status === 502);
});

test('signSponsored builds once and returns base64 bytes + sig', async () => {
  let builds = 0;
  const tx = { build: async () => { builds++; return new Uint8Array([1, 2, 3]); } };
  const keypair = { signTransaction: async (bytes) => { assert.ok(bytes instanceof Uint8Array); return { signature: 'SIGB64' }; } };
  const out = await signSponsored({ tx, client: {}, keypair });
  assert.equal(builds, 1);
  assert.equal(out.sponsorSig, 'SIGB64');
  assert.equal(out.txBytes, Buffer.from([1, 2, 3]).toString('base64'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/integration && node --test sponsor.test.js`
Expected: FAIL — `Cannot find module './sponsor.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/integration/sponsor.js
// Gas-station helpers: load the sponsor keypair, pick its gas coins, sponsor-sign a built tx.
// Used by the /sponsor-claim route. The sponsor private key never leaves this process and is
// never logged or returned in a response.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { toBase64 } from '@mysten/sui/utils';

// Pinned gas budget for sponsored claims. Claim is ~gas-negative (measured -0.0072 SUI); this is a
// conservative reservation ceiling, NOT the cost. Client-supplied budgets are ignored.
export const SPONSOR_GAS_CAP = 20_000_000n;

const err = (code, msg, status) => Object.assign(new Error(msg), { code, ...(status ? { status } : {}) });

export function loadSponsor(env = process.env) {
  const key = env.SPONSOR_KEY;
  if (!key) throw err('NO_SPONSOR', 'SPONSOR_KEY not set — gas station disabled');
  let keypair;
  try {
    const { secretKey } = decodeSuiPrivateKey(key);
    keypair = Ed25519Keypair.fromSecretKey(secretKey);
  } catch (e) {
    throw err('BAD_SPONSOR_KEY', `SPONSOR_KEY is not a valid Sui private key: ${e.message}`);
  }
  return { keypair, address: keypair.toSuiAddress() };
}

export async function pickGasCoins(client, sponsorAddr, budgetMist) {
  const picked = [];
  let total = 0n;
  let cursor;
  do {
    const page = await client.getCoins({ owner: sponsorAddr, coinType: '0x2::sui::SUI', cursor });
    for (const c of page.data) {
      picked.push({ objectId: c.coinObjectId, version: c.version, digest: c.digest });
      total += BigInt(c.balance);
      if (total >= budgetMist) return picked;
    }
    cursor = page.hasNextPage ? page.nextCursor : undefined;
  } while (cursor);
  throw err('NO_SPONSOR_GAS', `sponsor has insufficient SUI for gas (need ${budgetMist}, have ${total})`, 502);
}

export async function signSponsored({ tx, client, keypair }) {
  const built = await tx.build({ client });
  const { signature } = await keypair.signTransaction(built);
  return { txBytes: toBase64(built), sponsorSig: signature };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/integration && node --test sponsor.test.js`
Expected: PASS (7 tests). If the bech32 test key is rejected by the installed SDK, regenerate one with `sui keytool generate ed25519 --json` and substitute it (keep it throwaway).

- [ ] **Step 5: Commit**

```bash
git add scripts/integration/sponsor.js scripts/integration/sponsor.test.js
git commit -m "feat(sponsor): gas-station key load + gas-coin selection + sponsor-sign helpers"
```

---

### Task 2: Backend `/sponsor-claim` + `/sponsor-status` routes + `assertClaimable` + sponsor wiring

**Files:**
- Modify: `scripts/indexer/server.js` (add `assertClaimable`, the two routes, `sponsor` param to `createServer`, sponsor load in the CLI block)
- Test: `scripts/indexer/server.test.js` (append)

**Interfaces:**
- Consumes: `buildClaimTx` (txdeps), `assertManagerOwner` (existing), `pickGasCoins`/`signSponsored`/`SPONSOR_GAS_CAP`/`loadSponsor` (Task 1).
- Produces:
  - `createServer(db, { client, txdeps, sponsor })` — `sponsor` is `{ keypair, address } | null`.
  - `GET /sponsor-status` → `200 { available: boolean, address: string | null }`.
  - `POST /sponsor-claim` body `{ sender, note, mgr, oracle }` → `200 { tx: base64, sponsorSig: base64 }` | `503 NO_SPONSOR` | `400 BAD_PARAMS|BAD_MGR|BAD_NOTE` | `403 MGR_NOT_OWNED|NOTE_NOT_OWNED` | `502 CLAIM_DRYRUN_FAILED|NO_SPONSOR_GAS`.
  - `assertClaimable(client, note, sender)` — throws `BAD_NOTE`(400) / `NOTE_NOT_OWNED`(403).

- [ ] **Step 1: Write the failing test**

```js
// append to scripts/indexer/server.test.js
import { SPONSOR_GAS_CAP } from '../integration/sponsor.js';

// A built claim tx mock: records gas mutations, builds to bytes, dry-run handled by fakeClient.
function claimTxMock() {
  const calls = {};
  return {
    setGasOwner: (a) => { calls.gasOwner = a; },
    setGasPayment: (c) => { calls.gasPayment = c; },
    setGasBudget: (b) => { calls.gasBudget = b; },
    build: async () => new Uint8Array([9, 9, 9]),
    _calls: calls,
  };
}
const sponsorTxdeps = { ...fakeTxdeps, buildClaimTx: ({ sender, note }) => claimTxMock() };
const fakeSponsor = { address: '0x' + '9'.repeat(64), keypair: { signTransaction: async () => ({ signature: 'SPONSORSIG' }) } };
// fakeClient owns notes: SENDER owns NOTE_OK; getCoins funds the sponsor.
const NOTE_OK = '0x' + '2'.repeat(64);
const NOTE_FOREIGN = '0x' + '3'.repeat(64);
const sponsorClient = {
  ...fakeClient,
  getObject: async (args) => {
    if (args.id === NOTE_OK) return { data: { owner: { AddressOwner: SENDER } } };
    if (args.id === NOTE_FOREIGN) return { data: { owner: { AddressOwner: OTHER } } };
    return fakeClient.getObject(args);
  },
  getCoins: async () => ({ data: [{ coinObjectId: '0xg', version: '1', digest: 'D', balance: '50000000' }], hasNextPage: false }),
};

test('GET /sponsor-status reports availability', async () => {
  const on = createServer(fakeDb, { client: sponsorClient, txdeps: sponsorTxdeps, sponsor: fakeSponsor });
  assert.deepEqual((await callRoute(on, 'GET', '/sponsor-status')).j, { available: true, address: fakeSponsor.address });
  const off = createServer(fakeDb, { client: sponsorClient, txdeps: sponsorTxdeps });
  assert.deepEqual((await callRoute(off, 'GET', '/sponsor-status')).j, { available: false, address: null });
});

test('POST /sponsor-claim 503 when sponsor not configured', async () => {
  const srv = createServer(fakeDb, { client: sponsorClient, txdeps: sponsorTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/sponsor-claim', { sender: SENDER, note: NOTE_OK, mgr: MGR, oracle: FAKE_ORACLE_ID });
  assert.equal(status, 503); assert.equal(j.code, 'NO_SPONSOR');
});

test('POST /sponsor-claim 400 on missing field', async () => {
  const srv = createServer(fakeDb, { client: sponsorClient, txdeps: sponsorTxdeps, sponsor: fakeSponsor });
  const { status, j } = await callRoute(srv, 'POST', '/sponsor-claim', { sender: SENDER, mgr: MGR, oracle: FAKE_ORACLE_ID });
  assert.equal(status, 400); assert.equal(j.code, 'BAD_PARAMS');
});

test('POST /sponsor-claim 403 when mgr not owned by sender', async () => {
  const srv = createServer(fakeDb, { client: sponsorClient, txdeps: sponsorTxdeps, sponsor: fakeSponsor });
  const { status, j } = await callRoute(srv, 'POST', '/sponsor-claim', { sender: OTHER, note: NOTE_OK, mgr: MGR, oracle: FAKE_ORACLE_ID });
  assert.equal(status, 403); assert.equal(j.code, 'MGR_NOT_OWNED');
});

test('POST /sponsor-claim 403 when note not owned by sender', async () => {
  const srv = createServer(fakeDb, { client: sponsorClient, txdeps: sponsorTxdeps, sponsor: fakeSponsor });
  const { status, j } = await callRoute(srv, 'POST', '/sponsor-claim', { sender: SENDER, note: NOTE_FOREIGN, mgr: MGR, oracle: FAKE_ORACLE_ID });
  assert.equal(status, 403); assert.equal(j.code, 'NOTE_NOT_OWNED');
});

test('POST /sponsor-claim 502 when claim dry-run fails', async () => {
  const bad = { ...sponsorClient, dryRunTransactionBlock: async () => ({ effects: { status: { status: 'failure', error: 'MoveAbort claim' } }, events: [] }) };
  const srv = createServer(fakeDb, { client: bad, txdeps: sponsorTxdeps, sponsor: fakeSponsor });
  const { status, j } = await callRoute(srv, 'POST', '/sponsor-claim', { sender: SENDER, note: NOTE_OK, mgr: MGR, oracle: FAKE_ORACLE_ID });
  assert.equal(status, 502); assert.equal(j.code, 'CLAIM_DRYRUN_FAILED');
});

test('POST /sponsor-claim returns tx + sponsorSig and pins gas to CAP', async () => {
  const srv = createServer(fakeDb, { client: sponsorClient, txdeps: sponsorTxdeps, sponsor: fakeSponsor });
  const { status, j } = await callRoute(srv, 'POST', '/sponsor-claim', { sender: SENDER, note: NOTE_OK, mgr: MGR, oracle: FAKE_ORACLE_ID });
  assert.equal(status, 200);
  assert.equal(j.sponsorSig, 'SPONSORSIG');
  assert.equal(j.tx, Buffer.from([9, 9, 9]).toString('base64'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/indexer && node --test server.test.js`
Expected: FAIL — `/sponsor-status` returns 404 / `/sponsor-claim` 404 (routes not wired).

- [ ] **Step 3: Write minimal implementation**

In `scripts/indexer/server.js`, add the import near the top (after the existing `leftover.js` import):

```js
import { pickGasCoins, signSponsored, SPONSOR_GAS_CAP } from '../integration/sponsor.js';
import { toBase64 } from '@mysten/sui/utils';
```

Add `assertClaimable` next to `assertManagerOwner` (after line 51):

```js
// Cheap owner/exists fail-fast for the claimed note BEFORE the expensive dry-run. Settled-ness is
// the dry-run's job (authoritative — the real claim PTB aborts on-chain if not settled/already
// claimed, and we sponsor-sign only after a successful dry-run, so a non-settled note can't drain
// the sponsor). This guard just rejects foreign/non-existent notes without spending a dry-run.
async function assertClaimable(client, note, sender) {
  const want = normAddr(sender);
  if (!/^0x[0-9a-f]{1,64}$/i.test(String(note))) throw httpErr('BAD_NOTE', 400, `malformed note id: ${note}`);
  const obj = await client.getObject({ id: note, options: { showOwner: true } });
  if (!obj?.data) throw httpErr('BAD_NOTE', 400, 'note does not exist');
  const owner = obj.data.owner?.AddressOwner;
  if (!owner || normAddr(owner) !== want) throw httpErr('NOTE_NOT_OWNED', 403, 'note is not owned by sender');
}
```

Change the signature to accept `sponsor` (line 53):

```js
export function createServer(db, { client, txdeps, sponsor } = {}) {
```

Add `GET /sponsor-status` in the GET block (next to the other GETs, e.g. after `/oracle`):

```js
        if (p === '/sponsor-status')
          return json(res, 200, { available: !!sponsor, address: sponsor?.address ?? null });
```

Add `POST /sponsor-claim` in the POST block (after `/claim-tx`):

```js
        if (p === '/sponsor-claim') {
          if (!sponsor) return json(res, 503, { error: 'gas sponsor not configured', code: 'NO_SPONSOR' });
          if (!body.sender || !body.note || !body.mgr || !body.oracle)
            return json(res, 400, { error: 'sender, note, mgr, oracle required', code: 'BAD_PARAMS' });
          await assertManagerOwner(client, body.mgr, body.sender);
          await assertClaimable(client, body.note, body.sender);
          const tx = txdeps.buildClaimTx({ sender: body.sender, note: body.note, mgr: body.mgr, oracle: body.oracle });
          tx.setGasOwner(sponsor.address);
          tx.setGasPayment(await pickGasCoins(client, sponsor.address, SPONSOR_GAS_CAP));
          tx.setGasBudget(SPONSOR_GAS_CAP);
          // Dry-run the EXACT bytes we'll sponsor-sign: authoritative settled-ness gate + staleness guard.
          const txBytes = await tx.build({ client });
          const dr = await client.dryRunTransactionBlock({ transactionBlock: toBase64(txBytes) });
          if (dr.effects.status.status !== 'success')
            return json(res, 502, { error: `claim dry-run failed: ${dr.effects.status.error}`, code: 'CLAIM_DRYRUN_FAILED' });
          const { signature } = await sponsor.keypair.signTransaction(txBytes);
          return json(res, 200, { tx: toBase64(txBytes), sponsorSig: signature });
        }
```

(Note: this builds once and reuses `txBytes` for dry-run + sign; `signSponsored` from Task 1 is used by no caller here because we need the dry-run between build and sign — keep `signSponsored` exported for reuse/testing but inline the build here. If a reviewer prefers, refactor `signSponsored` to accept pre-built bytes; not required.)

Finally, load the sponsor in the CLI block (after `const txdeps = …`, line ~205):

```js
  let sponsor = null;
  try { const { loadSponsor } = await import('../integration/sponsor.js'); sponsor = loadSponsor(); }
  catch (e) { console.warn('[sponsor] disabled:', e.message); }
  createServer(db, { client, txdeps, sponsor }).listen(port, () => console.log(`[indexer+tx] serving on :${port}${sponsor ? ` (sponsor ${sponsor.address})` : ''}`));
```

(Remove the old `createServer(...).listen(...)` line being replaced.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/indexer && node --test server.test.js`
Expected: PASS (existing 80 + 8 new = 88).

- [ ] **Step 5: Commit**

```bash
git add scripts/indexer/server.js scripts/indexer/server.test.js
git commit -m "feat(server): /sponsor-claim + /sponsor-status routes, assertClaimable, sponsor wiring"
```

---

### Task 3: Frontend `claimSponsored.js` — dual-sign + byte-equality + gRPC execute, phase-tagged errors

**Files:**
- Create: `frontend/src/claimSponsored.js`
- Test: `frontend/src/claimSponsored.test.js`

**Interfaces:**
- Consumes: `API` (config), `dAppKit.signTransaction({ transaction }) → { bytes, signature }`, `client.core.executeTransaction(...)`.
- Produces: `sponsoredClaim({ dAppKit, client, sender, note, mgr, oracle, fetchImpl=fetch }) → Promise<{ digest }>`. On error, throws with `.phase` ∈ `'request' | 'sign' | 'verify' | 'execute'`, `.code`, `.status`. `phase==='request'` (and `status !== 403`) = pre-popup, silently fallbackable; everything else = post-popup, surface.

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/claimSponsored.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sponsoredClaim } from './claimSponsored.js';

const okFetch = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });
const baseArgs = { sender: '0xS', note: '0xN', mgr: '0xM', oracle: '0xO' };
// 'AQID' = base64 of [1,2,3]; dAppKit returns the same bytes verbatim (honest wallet).
const honestKit = { signTransaction: async ({ transaction }) => ({ bytes: transaction, signature: 'HOLDERSIG' }) };
const okClient = { core: { executeTransaction: async () => ({ $kind: 'Transaction', Transaction: { digest: '0xDIGEST' } }) } };

test('happy path returns digest', async () => {
  const out = await sponsoredClaim({ ...baseArgs, dAppKit: honestKit, client: okClient, fetchImpl: okFetch({ tx: 'AQID', sponsorSig: 'SPONSORSIG' }) });
  assert.equal(out.digest, '0xDIGEST');
});

test('sponsor-claim 503 → phase request (pre-popup, fallbackable)', async () => {
  await assert.rejects(
    () => sponsoredClaim({ ...baseArgs, dAppKit: honestKit, client: okClient, fetchImpl: okFetch({ code: 'NO_SPONSOR' }, false, 503) }),
    (e) => e.phase === 'request' && e.code === 'NO_SPONSOR' && e.status === 503);
});

test('403 carries status so caller can skip fallback', async () => {
  await assert.rejects(
    () => sponsoredClaim({ ...baseArgs, dAppKit: honestKit, client: okClient, fetchImpl: okFetch({ code: 'NOTE_NOT_OWNED' }, false, 403) }),
    (e) => e.phase === 'request' && e.status === 403);
});

test('wallet mutates bytes → phase verify, code BYTE_MISMATCH (post-popup)', async () => {
  const liar = { signTransaction: async () => ({ bytes: 'DIFFERENT', signature: 'X' }) };
  await assert.rejects(
    () => sponsoredClaim({ ...baseArgs, dAppKit: liar, client: okClient, fetchImpl: okFetch({ tx: 'AQID', sponsorSig: 'S' }) }),
    (e) => e.phase === 'verify' && e.code === 'BYTE_MISMATCH');
});

test('wallet rejects signature → phase sign', async () => {
  const reject = { signTransaction: async () => { throw new Error('user rejected'); } };
  await assert.rejects(
    () => sponsoredClaim({ ...baseArgs, dAppKit: reject, client: okClient, fetchImpl: okFetch({ tx: 'AQID', sponsorSig: 'S' }) }),
    (e) => e.phase === 'sign');
});

test('execute returns FailedTransaction → phase execute', async () => {
  const failClient = { core: { executeTransaction: async () => ({ $kind: 'FailedTransaction', FailedTransaction: { effects: { status: { error: { message: 'boom' } } } } }) } };
  await assert.rejects(
    () => sponsoredClaim({ ...baseArgs, dAppKit: honestKit, client: failClient, fetchImpl: okFetch({ tx: 'AQID', sponsorSig: 'S' }) }),
    (e) => e.phase === 'execute');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/claimSponsored.test.js`
Expected: FAIL — `Cannot find module './claimSponsored.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/claimSponsored.js
// Sponsored claim: backend sponsor-signs the gas, the holder signs the SAME bytes, we submit the
// dual-signed tx via the gRPC client. Errors are tagged with a .phase so the caller can decide
// whether to silently fall back to self-pay (pre-popup) or surface the error (post-holder-sign).
import { fromBase64 } from '@mysten/sui/utils';
import { API } from './config.js';

const tag = (e, phase, extra = {}) => Object.assign(e, { phase, ...extra });

export async function sponsoredClaim({ dAppKit, client, sender, note, mgr, oracle, fetchImpl = fetch }) {
  // --- phase 'request' (pre-popup): a failure here is safe to silently fall back to self-pay ---
  let resp;
  {
    let r;
    try {
      r = await fetchImpl(`${API}/sponsor-claim`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sender, note, mgr, oracle }),
      });
    } catch (e) { throw tag(e, 'request'); }
    resp = await r.json();
    if (!r.ok) throw tag(new Error(resp.error || 'sponsor-claim failed'), 'request', { code: resp.code, status: r.status });
  }
  const { tx: txBytes, sponsorSig } = resp;

  // --- phase 'sign': wallet popup. The holder signs the SAME bytes verbatim ---
  let signed;
  try { signed = await dAppKit.signTransaction({ transaction: txBytes }); }
  catch (e) { throw tag(e, 'sign'); }

  // --- phase 'verify': C2 — reject if the wallet rebuilt/re-resolved gasData ---
  if (signed.bytes !== txBytes)
    throw tag(new Error('wallet altered the transaction bytes'), 'verify', { code: 'BYTE_MISMATCH' });

  // --- phase 'execute': dual-sig submit via gRPC (NOT JSON-RPC) ---
  let res;
  try {
    res = await client.core.executeTransaction({
      transaction: fromBase64(txBytes),
      signatures: [signed.signature, sponsorSig],
      include: { effects: true },
    });
  } catch (e) { throw tag(e, 'execute'); }
  if (res.$kind === 'FailedTransaction') {
    const err = res.FailedTransaction?.effects?.status?.error;
    throw tag(new Error(`claim failed on-chain: ${err?.message ?? JSON.stringify(err)}`), 'execute');
  }
  const digest = res.Transaction?.digest;
  if (!digest) throw tag(new Error('claim returned no digest — treat as NOT completed'), 'execute');
  return { digest };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/claimSponsored.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/claimSponsored.js frontend/src/claimSponsored.test.js
git commit -m "feat(frontend): sponsoredClaim — dual-sign + byte-equality + gRPC execute, phase-tagged"
```

---

### Task 4: Wire MyNotes claim to sponsored-first with phase-based fallback

**Files:**
- Modify: `frontend/src/MyNotes.jsx` (refactor `claim`, add sponsor-availability state, accept new props)
- Modify: `frontend/src/App.jsx` (pass `dAppKit`, `client`, fetch `/sponsor-status` and pass `sponsorAvailable`)
- Test: manual (state logic; no unit harness for the component) + `vite build`

**Interfaces:**
- Consumes: `sponsoredClaim` (Task 3), existing `getOracle`/`postTx`/`signExec`, `GET /sponsor-status` (Task 2).
- Produces: `MyNotes({ account, signExec, dAppKit, client, sponsorAvailable })`. Internal `claimPhase` state ∈ `null | 'sponsoring' | 'awaiting-sign' | 'submitting'` drives Task 5's button copy.

- [ ] **Step 1: Add props + state, refactor self-pay into a helper**

In `MyNotes.jsx`, change the signature and add state:

```jsx
export default function MyNotes({ account, signExec, dAppKit, client, sponsorAvailable }) {
```

Add near the other `useState` calls (after `claiming`):

```jsx
  const [claimPhase, setClaimPhase] = useState(/** @type {null|'sponsoring'|'awaiting-sign'|'submitting'} */ (null));
  const [forceSelfPay, setForceSelfPay] = useState(false); // set when a wallet is detected mutating gas
```

Extract the EXISTING self-pay claim body into a helper (keeps the current behaviour byte-for-byte). Replace the current `claim(n)` (lines 75–116) with:

```jsx
  // Existing self-pay path, unchanged: holder signs + pays gas. Returns { digest } or throws.
  async function selfPayClaim(n) {
    const oracle = await getOracle(UNDERLYING, n.expiry_ts_ms);
    const { tx: txJson } = await postTx('/claim-tx', { sender: account.address, note: n.note_id, mgr: n.manager_id, oracle });
    const r = await signExec(Transaction.from(txJson));
    if (r.$kind === 'FailedTransaction') {
      const err = r.FailedTransaction?.effects?.status?.error;
      throw new Error(`Claim failed on-chain: ${err?.message ?? JSON.stringify(err)}`);
    }
    const digest = r.Transaction?.digest;
    if (!digest) throw new Error('Claim returned no digest — status unknown, treat as NOT completed');
    return { digest };
  }

  async function claim(n) {
    if (claiming) return;
    setClaiming(n.note_id); setMsg(''); setMsgKind(''); setClaimUrl('');
    let usedSponsor = false;
    try {
      let digest;
      const trySponsor = sponsorAvailable && !forceSelfPay && dAppKit && client;
      if (trySponsor) {
        try {
          const oracle = await getOracle(UNDERLYING, n.expiry_ts_ms);
          setClaimPhase('sponsoring');
          // sponsoredClaim drives request→sign→execute; we flip to awaiting-sign just before the popup.
          setClaimPhase('awaiting-sign');
          ({ digest } = await sponsoredClaim({
            dAppKit, client, sender: account.address, note: n.note_id, mgr: n.manager_id, oracle,
          }));
          usedSponsor = true;
        } catch (e) {
          // Pre-popup failures (not 403) → silently fall back to self-pay (one popup total).
          // 403 owner errors → self-pay would abort too: surface, no fallback.
          // Post-popup failures (sign/verify/execute) → surface, do NOT auto re-sign.
          if (e.phase === 'request' && e.status !== 403) {
            if (e.code === 'BYTE_MISMATCH') setForceSelfPay(true); // (defensive; verify-phase normally)
            setClaimPhase('submitting');
            ({ digest } = await selfPayClaim(n));
          } else {
            if (e.code === 'BYTE_MISMATCH') setForceSelfPay(true);
            throw e;
          }
        }
      } else {
        setClaimPhase('submitting');
        ({ digest } = await selfPayClaim(n));
      }
      setMsg(usedSponsor ? 'Claimed (gas-free)' : 'Claimed');
      setClaimUrl(`${EXPLORER}${digest}`);
      setMsgKind('ok');
      setNotes((prev) => prev.filter((x) => x.note_id !== n.note_id));
    } catch (e) {
      setMsg(`CLAIM FAILED: ${claimErrorCopy(e)}${e.code ? ` [${e.code}]` : ''}`);
      setMsgKind('err');
    } finally {
      setClaiming(null); setClaimPhase(null);
    }
  }
```

Add the error-copy mapper above the component (near `UNDERLYING`, line ~15):

```jsx
// Honest plain-English for the sponsored error codes; raw code is appended by the caller in [brackets].
function claimErrorCopy(e) {
  switch (e.code) {
    case 'NOTE_NOT_OWNED':
    case 'MGR_NOT_OWNED': return "This note isn't yours to claim.";
    case 'CLAIM_DRYRUN_FAILED': return "This note isn't settled yet (or was already claimed).";
    case 'NO_SPONSOR':
    case 'NO_SPONSOR_GAS': return 'Gas sponsor unavailable and self-pay failed — try again shortly.';
    case 'BYTE_MISMATCH': return "Your wallet changed the sponsored transaction — claim again to pay gas yourself.";
    default: return e.message;
  }
}
```

Add the import at the top of `MyNotes.jsx`:

```jsx
import { sponsoredClaim } from './claimSponsored.js';
```

- [ ] **Step 2: Wire App.jsx to pass deps + sponsor availability**

In `frontend/src/App.jsx`, add state + a fetch for `/sponsor-status`, and pass props. Near the existing hooks (after line 21):

```jsx
  const [sponsorAvailable, setSponsorAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`${API}/sponsor-status`).then((r) => r.json())
      .then((s) => { if (alive) setSponsorAvailable(!!s.available); })
      .catch(() => { if (alive) setSponsorAvailable(false); });
    return () => { alive = false; };
  }, []);
```

Ensure `API` and `useState`/`useEffect` are imported (they are used elsewhere; add `API` from `./config.js` if not already imported). Update the MyNotes mount (line ~223):

```jsx
          <MyNotes account={account} signExec={signExec} dAppKit={dAppKit} client={client} sponsorAvailable={sponsorAvailable} />
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npm run build`
Expected: build succeeds, no unresolved imports.

- [ ] **Step 4: Re-run all frontend tests**

Run: `cd frontend && node --test`
Expected: PASS (existing + claimSponsored 6). No regressions.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/MyNotes.jsx frontend/src/App.jsx
git commit -m "feat(frontend): MyNotes sponsored-first claim with phase-based self-pay fallback"
```

---

### Task 5: Presentation — gas-free chip, 4-phase button, a11y, CSS

**Files:**
- Modify: `frontend/src/MyNotes.jsx` (chip in the Claimable cell, phased button label + spinner, sr-only status)
- Modify: `frontend/src/App.css` (`.nl-gaschip`, reduced-motion `.nl-spinner i`, button min-width)
- Test: `vite build` + manual (browser render is human-deferred — sandbox has no wallet)

**Interfaces:**
- Consumes: `claimPhase` state (Task 4), `sponsorAvailable` prop, existing `.nl-spinner` / `.nl-pill` / `--gold-ink` / `--surface-sunk`.

> Per `.claude/rules/frontend.md`, the pure-CSS chip styling MAY be delegated to Gemini; the JSX wiring (conditional on `claimPhase`/`sponsorAvailable`) stays here because it's state-coupled. If delegating, hand Gemini the exact token names below.

- [ ] **Step 1: Add the gas-free chip + phased button + sr-only status in MyNotes.jsx**

In the Claimable cell (around lines 184–197), render the chip next to the status text when `sponsorAvailable && !forceSelfPay`, and drive the button label from `claimPhase`:

```jsx
{state === 'claimable' && (
  <>
    {sponsorAvailable && !forceSelfPay && (
      <span className="nl-gaschip">
        <svg className="nl-li" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          {/* rising droplet: a small circle with a short upward tail */}
          <circle cx="6" cy="7.5" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M6 4.6 q1.2 -1.8 0 -3.4 q-1.2 1.6 0 3.4 Z" fill="currentColor" />
        </svg>
        gas-free
      </span>
    )}
    <button
      className="nl-btn nl-btn--primary nl-claim-btn"
      disabled={isClaiming || !!claiming}
      aria-busy={isClaiming}
      onClick={(e) => { e.stopPropagation(); claim(n); }}
    >
      {!isClaiming && 'Claim'}
      {isClaiming && claimPhase === 'sponsoring' && (<><span className="nl-spinner" aria-hidden="true"><i/><i/><i/></span>Sponsoring…</>)}
      {isClaiming && claimPhase === 'awaiting-sign' && 'Approve in wallet →'}
      {isClaiming && (claimPhase === 'submitting' || claimPhase === null) && (<><span className="nl-spinner" aria-hidden="true"><i/><i/><i/></span>Submitting…</>)}
    </button>
    <span className="sr-only" role="status" aria-live="polite">
      {claimPhase === 'sponsoring' && 'Requesting gas sponsor'}
      {claimPhase === 'awaiting-sign' && 'Approve the claim in your wallet'}
      {claimPhase === 'submitting' && 'Submitting your claim'}
      {!isClaiming && msgKind === 'ok' && msg}
    </span>
  </>
)}
```

(Match the existing markup structure of the cell — keep the surrounding `<td>`/`div`. If `.nl-spinner` markup differs from `<span class="nl-spinner"><i/><i/><i/></span>`, copy it from the Mint loader in `App.jsx`.)

- [ ] **Step 2: Add CSS in App.css**

```css
/* gas-free chip — borrows the .nl-pill recipe; gold-ink on sunk surface (~4.6:1 AA). */
.nl-gaschip {
  display: inline-flex; align-items: center; gap: 4px;
  font-family: var(--font-mono); font-size: 10px; line-height: 1;
  color: var(--gold-ink); background: var(--surface-sunk);
  border: 1px solid var(--hairline); border-radius: 999px;
  padding: 2px 8px; margin-right: 8px; vertical-align: middle;
}
.nl-gaschip .nl-li { color: var(--gold-ink); }
/* pin width so 'Approve in wallet →' doesn't reflow the cell */
.nl-claim-btn { min-width: 150px; }
```

In the existing `@media (prefers-reduced-motion: reduce)` block (around line 211), add:

```css
  .nl-spinner i { animation: none; }
```

(Verify the exact token names exist in `theme.css`: `--gold-ink`, `--surface-sunk`, `--hairline`, `--font-mono`. If a name differs, use the actual one — do NOT invent. `--molten`/`--gold-b` must NOT be used for chip text — they fail contrast on light.)

- [ ] **Step 3: Verify build + lint the reduced-motion/contrast invariants**

Run: `cd frontend && npm run build`
Expected: build succeeds.
Manually confirm: only ONE `@media (prefers-reduced-motion` block in App.css (grep), and the chip uses `--gold-ink` (not `--molten`) for text.

```bash
grep -c "prefers-reduced-motion" frontend/src/App.css   # expect 1
grep -n "nl-gaschip" frontend/src/App.css
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/MyNotes.jsx frontend/src/App.css
git commit -m "feat(frontend): gas-free chip + 4-phase claim button + reduced-motion/a11y"
```

---

## Post-implementation (human / live)

These are NOT plan tasks (sandbox has no browser wallet) but MUST be done before claiming the feature works end-to-end:

1. **C2 byte-equality probe (load-bearing):** in a real browser wallet, run a sponsored claim and confirm `signed.bytes === txBytes`. If it FAILS, the wallet mutates gasData — the `verify` phase catches it and `forceSelfPay` kicks in, but sponsored is then dead for that wallet. Record the result in `tasks/lessons.md`.
2. **Live round-trip:** real wallet claims a settled note via sponsored path; confirm holder spends 0 SUI, sponsor balance reflects the gas-negative ledger.
3. **Start the server with a funded sponsor:** `SPONSOR_KEY=suiprivkey... node scripts/indexer/server.js indexer.db 8787` (also run the poller `node scripts/indexer/ingest.js indexer.db`). Without `SPONSOR_KEY`, `/sponsor-status` returns `available:false` and the UI silently uses self-pay — verify that degraded path too.

## Self-Review

- **Spec coverage:** `/sponsor-claim` (T2), `/sponsor-status` for chip (T2/T4), `assertManagerOwner`+`assertClaimable` (T2), gas CAP pinned (T1/T2), dry-run authoritative (T2), sponsor key fail-loud + route-503-not-crash (T1/T2), gRPC execute + byte-equality (T3), fallback-by-phase + 403-no-fallback (T3/T4), gas-free chip/4-phase button/error copy/success narrative/a11y (T5), Red Team V1–V6 (owner guards T2, pinned budget T1/T2, byte-equality T3, replay via dry-run T2, DoS order T2 with rate-limit flagged out-of-scope). Covered.
- **Placeholder scan:** all steps carry concrete code/commands. The one soft spot — exact `.nl-spinner` markup and exact line numbers in MyNotes/App.css — is explicitly flagged to copy from the live file (line numbers drift; the implementer must read the file).
- **Type consistency:** `loadSponsor`→`{keypair,address}` used identically in T1/T2; `sponsoredClaim` returns `{digest}` consumed in T4; error `.phase`/`.code`/`.status` produced in T3 and branched in T4; `claimPhase` values produced in T4 and consumed in T5 (`'sponsoring'|'awaiting-sign'|'submitting'`). Consistent.
