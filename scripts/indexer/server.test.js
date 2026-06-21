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
