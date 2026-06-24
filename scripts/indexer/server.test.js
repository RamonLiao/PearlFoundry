import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, ingestPage } from './db.js';
import { createServer } from './server.js';

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

const fakeClient = {
  getObject: async ({ id }) => {
    if (id === CFG_ID) {
      return { data: { content: { fields: { fee_bps: 30 } } } };
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
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: '0xS', mgr: '0xM', expiry: '1750000000' });
  assert.equal(status, 200);
  assert.equal(j.oracleId, '0xorc');
  assert.equal(j.tx, 'MINT:0xS:0xM');
  assert.equal(j.forward, '95000');
  assert.ok(BigInt(j.qtyPerLeg) > 0n);
});

test('POST /quote omits expiry — auto-picks via pickLiveExpiry', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: '0xS', mgr: '0xM' });
  assert.equal(status, 200);
  assert.equal(j.oracleId, '0xorc');
  assert.equal(j.expiry, '1750000000');
});

test('tx route 503 when no client wired', async () => {
  const srv = createServer(fakeDb); // intentionally no client
  const { status } = await callRoute(srv, 'POST', '/quote', { sender: '0xS', mgr: '0xM', expiry: '1750000000' });
  assert.equal(status, 503);
});

test('POST /quote returns leftover from mint dry-run', async () => {
  const srv = createServer(fakeDb, { client: fakeClient, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: '0xS', mgr: '0xM', expiry: '1750000000' });
  assert.equal(status, 200);
  assert.equal(j.leftover, '9370000'); // 9970000 − (300000+300000)
});

test('POST /quote 502 when mint dry-run fails', async () => {
  const bad = { ...fakeClient, dryRunTransactionBlock: async () => ({ effects: { status: { status: 'failure', error: 'MoveAbort … 7' } }, events: [] }) };
  const srv = createServer(fakeDb, { client: bad, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: '0xS', mgr: '0xM', expiry: '1750000000' });
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
