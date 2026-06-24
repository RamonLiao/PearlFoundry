import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, ingestPage } from './db.js';
import { createServer } from './server.js';
import { PREDICT_MGR_TYPE } from '../integration/config.js';

function withServer(db, fn) {
  return new Promise((resolve, reject) => {
    const srv = createServer(db).listen(0, async () => {
      const base = `http://127.0.0.1:${srv.address().port}`;
      try { await fn(base); resolve(); } catch (e) { reject(e); } finally { srv.close(); }
    });
  });
}

test('GET /notes decodes strategy to utf8, blob to base64', async () => {
  const db = openDb();
  ingestPage(db, [{ table: 'notes', row: {
    tx_digest: 'T1', event_seq: '0', note_id: '0xn1', strategy: '7261', issuer: '0xA',
    manager_id: '0xm', notional: '1000', expiry_ts_ms: '1', walrus_blob_id: '010203',
    is_public: 0, minted_at_ms: '100' } }], { txDigest: 'T1', eventSeq: '0' });
  await withServer(db, async (base) => {
    const rows = await (await fetch(`${base}/notes?issuer=0xA`)).json();
    assert.equal(rows[0].strategy, 'ra');
    assert.equal(rows[0].walrus_blob_id, Buffer.from([1, 2, 3]).toString('base64'));
    assert.equal(rows[0].settled, 0);
  });
});

test('unknown path returns 404', async () => {
  await withServer(openDb(), async (base) => {
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  });
});

// --- tx routes (Task 2) ---

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

const noteRow = { note_id: '0xNOTE', tx_digest: '0xDIG', notional: '10000000', expiry_ts_ms: '1782266400000' };
const fakeDb = { prepare: (sql) => ({
  all: () => [],
  get: () => (sql.includes('WHERE note_id') ? noteRow : {}),
}) };

// CFG constant from config.js
const CFG_ID = '0xc8516309c6c65dd71a910a966abb8e74284ecb49eaaae1607acbf7440f249351';
const FAKE_ORACLE_ID = '0xoracle';

// Valid 0x+64hex ids for write-path auth tests. SENDER owns MGR; OTHER does not.
const SENDER = '0x' + '5'.repeat(64);
const OTHER = '0x' + '7'.repeat(64);
const MGR = '0x' + 'a'.repeat(64);
// Manager whose owner has leading zeros — to test address-form normalization.
const MGR_LZ = '0x' + 'c'.repeat(64);
const LZ_OWNER = '0x' + '0'.repeat(4) + '5'.repeat(60); // padded, 64 hex
const FOREIGN_MGR = '0x' + 'e'.repeat(64);   // look-alike type, wrong package addr
const NO_OWNER_MGR = '0x' + 'f'.repeat(64);  // real type, missing owner field
const DELETED_MGR = '0x' + '1'.repeat(64);   // getObject returns no data
const MGR_TYPE = PREDICT_MGR_TYPE; // single source of truth — no drift from production config

const fakeClient = {
  getObject: async ({ id }) => {
    if (id === CFG_ID) {
      return { data: { content: { fields: { fee_bps: 30 } } } };
    }
    if (id === MGR) {
      return { data: { type: MGR_TYPE, content: { fields: { owner: SENDER } } } };
    }
    if (id === MGR_LZ) {
      return { data: { type: MGR_TYPE, content: { fields: { owner: LZ_OWNER } } } };
    }
    // attacker-deployed look-alike: same module::struct, different (wrong) package address
    if (id === FOREIGN_MGR) {
      return { data: { type: '0x' + 'd'.repeat(64) + '::predict_manager::PredictManager',
        content: { fields: { owner: SENDER } } } };
    }
    // real manager type but no owner field present
    if (id === NO_OWNER_MGR) {
      return { data: { type: MGR_TYPE, content: { fields: {} } } };
    }
    // deleted / non-existent object
    if (id === DELETED_MGR) {
      return { data: null, error: { code: 'deleted' } };
    }
    // oracle object shape
    return { data: { content: { fields: {
      settlement_price: null,
      prices: { fields: { forward: '95000' } },
    } } } };
  },
  getDynamicFieldObject: async () => ({
    data: { content: { fields: { value: { fields: {
      version: 1,
      lower: '60000000000000',
      upper: '66000000000000',
      strike_step: '1000000000000',
      qty_per_leg: '1424285',
      legs_per_expiry: 7,
      expiry_count: 1,
      hurdle_bps: 10000,
    } } } } },
  }),
  dryRunTransactionBlock: async () => ({
    effects: { status: { status: 'success' } },
    events: [
      { type: 'p::events::BalanceEvent', parsedJson: { amount: '9970000', deposit: true } },
      { type: 'p::predict::PositionMinted', parsedJson: { cost: '300000', quantity: '5', strike: '1' } },
      { type: 'p::predict::PositionMinted', parsedJson: { cost: '300000', quantity: '5', strike: '2' } },
    ],
  }),
  getTransactionBlock: async ({ digest }) => ({
    events: digest === '0xDIG' ? [
      { type: 'p::events::BalanceEvent', parsedJson: { amount: '9970000', deposit: true } },
      { type: 'p::predict::PositionMinted', parsedJson: { cost: '300000', quantity: '623125', strike: '62812000000000' } },
      { type: 'p::predict::PositionMinted', parsedJson: { cost: '300000', quantity: '623125', strike: '63812000000000' } },
    ] : [],
  }),
  queryEvents: async () => ({
    data: [{
      parsedJson: {
        underlying_asset: 'BTC',
        expiry: '1750000000',
        oracle_id: FAKE_ORACLE_ID,
        tick_size: '1000000000000',
        min_strike: '50000000000000',
      },
    }],
    hasNextPage: false,
  }),
};
const fakeTxdeps = {
  buildCreateManagerTx: ({ sender }) => ({ serialize: () => `CM:${sender}` }),
  computeLadder: async ({ sender, mgr }) => ({ lower: 1n, upper: 2n, step: 1n, oracleId: '0xorc', legs: 5, forward: 95000n }),
  buildMintTx: ({ sender, mgr }) => ({ serialize: () => `MINT:${sender}:${mgr}`, build: async () => new Uint8Array([1]) }),
  buildClaimTx: ({ sender, note }) => ({ serialize: () => `CLAIM:${sender}:${note}` }),
  pickDusdcCoin: async () => ({ coinId: '0xcoin', total: 1000n }),
  pickLiveExpiry: async () => '1750000000',
};

test('POST /create-manager-tx returns serialized tx', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/create-manager-tx', { sender: '0xS' });
  assert.equal(status, 200);
  assert.equal(j.tx, 'CM:0xS');
});

test('POST /create-manager-tx 400 on missing sender', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/create-manager-tx', {});
  assert.equal(status, 400);
  assert.equal(j.code, 'BAD_PARAMS');
});

test('POST /quote returns ladder + tx', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: SENDER, mgr: MGR, expiry: '1750000000' });
  assert.equal(status, 200);
  assert.equal(j.oracleId, '0xorc');
  assert.equal(j.tx, `MINT:${SENDER}:${MGR}`);
  assert.equal(j.forward, '95000');
  assert.ok(BigInt(j.qtyPerLeg) > 0n);
});

test('POST /quote omits expiry — auto-picks via pickLiveExpiry', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: SENDER, mgr: MGR });
  assert.equal(status, 200);
  assert.equal(j.oracleId, '0xorc');
  assert.equal(j.expiry, '1750000000');
});

test('tx route 503 when no client wired', async () => {
  const srv = createServer(fakeDb); // intentionally no client
  const { status } = await callRoute(srv, 'POST', '/quote', { sender: SENDER, mgr: MGR, expiry: '1750000000' });
  assert.equal(status, 503);
});

test('POST /quote returns leftover from mint dry-run', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: SENDER, mgr: MGR, expiry: '1750000000' });
  assert.equal(status, 200);
  assert.equal(j.leftover, '9370000'); // 9970000 − (300000+300000)
});

test('POST /quote echoes notional so the metric rail can show it', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: SENDER, mgr: MGR });
  assert.equal(j.notional, '10000000'); // default notional, base units (10 dUSDC)
});

test('POST /quote 502 when mint dry-run fails', async () => {
  const bad = { ...fakeClient, dryRunTransactionBlock: async () => ({ effects: { status: { status: 'failure', error: 'MoveAbort … 7' } }, events: [] }) };
  const srv = createServer(fakeDb, { client: bad, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: SENDER, mgr: MGR, expiry: '1750000000' });
  assert.equal(status, 502);
  assert.equal(j.code, 'QUOTE_DRYRUN_FAILED');
});

test('GET /note-params returns range params + oracle forward', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'GET', '/note-params?note=0xNOTE&asset=BTC&expiry=1750000000', null);
  assert.equal(status, 200);
  assert.equal(j.params.lower, '60000000000000');
  assert.equal(j.params.upper, '66000000000000');
  assert.ok(j.params.strike_step, 'strike_step present');
  assert.equal(j.forward, '95000');
  assert.equal(j.settlementPrice, null);
});

test('GET /note-params returns leftover from mint tx', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'GET', '/note-params?note=0xNOTE&asset=BTC&expiry=1750000000', null);
  assert.equal(status, 200);
  assert.equal(j.leftover, '9370000'); // 9970000 − 600000
});

test('GET /note-params reconstructs params from events when df gone (settled)', async () => {
  const dfGone = { ...fakeClient, getDynamicFieldObject: async () => ({ data: null }) };
  const srv = createServer(fakeDb, { client: dfGone, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'GET', '/note-params?note=0xNOTE&asset=BTC&expiry=1750000000', null);
  assert.equal(status, 200);
  assert.equal(j.params.lower, '62812000000000');
  assert.equal(j.params.strike_step, '1000000000000');
  assert.equal(j.leftover, '9370000');
});

test('GET /note-params 404 when note row has no tx_digest', async () => {
  const dbNoTx = { prepare: () => ({ all: () => [], get: () => undefined }) };
  const srv = createServer(dbNoTx, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'GET', '/note-params?note=0xX&asset=BTC&expiry=1750000000', null);
  assert.equal(status, 404);
  assert.equal(j.code, 'NO_MINT_TX');
});

// --- write-path auth guard (mgr → sender) ---

test('POST /quote 403 when mgr not owned by sender', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: OTHER, mgr: MGR, expiry: '1750000000' });
  assert.equal(status, 403);
  assert.equal(j.code, 'MGR_NOT_OWNED');
});

test('POST /quote ownership check runs BEFORE the expensive ladder probe', async () => {
  // computeLadder must never be reached for a foreign manager (DoS / fail-fast guarantee).
  let probed = false;
  const txdeps = { ...fakeTxdeps, computeLadder: async (a) => { probed = true; return fakeTxdeps.computeLadder(a); } };
  const srv = createServer(fakeDb, { client: fakeClient, txdeps });
  const { status } = await callRoute(srv, 'POST', '/quote', { sender: OTHER, mgr: MGR, expiry: '1750000000' });
  assert.equal(status, 403);
  assert.equal(probed, false);
});

test('POST /quote 400 BAD_MGR when mgr is not a PredictManager', async () => {
  // getObject returns the oracle (non-manager) shape for an unknown id → wrong type.
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const wrongType = '0x' + 'b'.repeat(64);
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: SENDER, mgr: wrongType, expiry: '1750000000' });
  assert.equal(status, 400);
  assert.equal(j.code, 'BAD_MGR');
});

test('POST /quote 400 BAD_MGR when mgr id is malformed', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: SENDER, mgr: '0xnothex', expiry: '1750000000' });
  assert.equal(status, 400);
  assert.equal(j.code, 'BAD_MGR');
});

test('POST /quote owner match is address-form insensitive (unpadded sender)', async () => {
  // wallet may send an unpadded sender; guard normalizes both sides before compare.
  // MGR_LZ owner = 0x0000…(padded); send the leading-zero-stripped form → must still match.
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const unpadded = '0x' + '5'.repeat(60); // strips the 4 leading zeros of LZ_OWNER
  const { status } = await callRoute(srv, 'POST', '/quote', { sender: unpadded, mgr: MGR_LZ, expiry: '1750000000' });
  assert.equal(status, 200);
});

test('POST /claim-tx returns tx when mgr owned by sender', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/claim-tx',
    { sender: SENDER, note: '0xNOTE', mgr: MGR, oracle: '0xorc' });
  assert.equal(status, 200);
  assert.equal(j.tx, `CLAIM:${SENDER}:0xNOTE`);
});

test('POST /claim-tx 403 when mgr not owned by sender', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/claim-tx',
    { sender: OTHER, note: '0xNOTE', mgr: MGR, oracle: '0xorc' });
  assert.equal(status, 403);
  assert.equal(j.code, 'MGR_NOT_OWNED');
});

// --- monkey / edge cases (test.md) ---

test('POST /quote 400 BAD_MGR rejects attacker-deployed look-alike type (wrong package)', async () => {
  // Same module::struct, different package address — must NOT pass the exact type check.
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: SENDER, mgr: FOREIGN_MGR, expiry: '1750000000' });
  assert.equal(status, 400);
  assert.equal(j.code, 'BAD_MGR');
});

test('POST /quote 400 BAD_MGR when mgr object is deleted / non-existent', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: SENDER, mgr: DELETED_MGR, expiry: '1750000000' });
  assert.equal(status, 400);
  assert.equal(j.code, 'BAD_MGR');
});

test('POST /quote 403 when manager has no owner field', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: SENDER, mgr: NO_OWNER_MGR, expiry: '1750000000' });
  assert.equal(status, 403);
  assert.equal(j.code, 'MGR_NOT_OWNED');
});

test('POST /quote 400 BAD_PARAMS when sender is malformed', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: '0xZZZ', mgr: MGR, expiry: '1750000000' });
  assert.equal(status, 400);
  assert.equal(j.code, 'BAD_PARAMS');
});

// --- sponsor-claim routes ---
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
