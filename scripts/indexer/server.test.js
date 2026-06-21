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

const fakeDb = { prepare: () => ({ all: () => [], get: () => ({}) }) };
const fakeTxdeps = {
  buildCreateManagerTx: ({ sender }) => ({ serialize: () => `CM:${sender}` }),
  computeLadder: async ({ sender, mgr }) => ({ lower: 1n, upper: 2n, step: 1n, oracleId: '0xorc' }),
  buildMintTx: ({ sender, mgr }) => ({ serialize: () => `MINT:${sender}:${mgr}` }),
  buildClaimTx: ({ sender, note }) => ({ serialize: () => `CLAIM:${sender}:${note}` }),
  pickDusdcCoin: async () => ({ coinId: '0xcoin', total: 1000n }),
};

test('POST /create-manager-tx returns serialized tx', async () => {
  const srv = createServer(fakeDb, { client: {}, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/create-manager-tx', { sender: '0xS' });
  assert.equal(status, 200);
  assert.equal(j.tx, 'CM:0xS');
});

test('POST /create-manager-tx 400 on missing sender', async () => {
  const srv = createServer(fakeDb, { client: {}, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/create-manager-tx', {});
  assert.equal(status, 400);
  assert.equal(j.code, 'BAD_PARAMS');
});

test('POST /quote returns ladder + tx', async () => {
  const srv = createServer(fakeDb, { client: {}, txdeps: fakeTxdeps });
  const { status, j } = await callRoute(srv, 'POST', '/quote', { sender: '0xS', mgr: '0xM', expiry: '1750000000' });
  assert.equal(status, 200);
  assert.equal(j.oracleId, '0xorc');
  assert.equal(j.tx, 'MINT:0xS:0xM');
});

test('tx route 503 when no client wired', async () => {
  const srv = createServer(fakeDb);
  const { status } = await callRoute(srv, 'POST', '/quote', { sender: '0xS', mgr: '0xM', expiry: '1750000000' });
  assert.equal(status, 503);
});
