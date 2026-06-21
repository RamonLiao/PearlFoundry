import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, getCursor } from './db.js';
import { drainOnce } from './ingest.js';

const PKG = '0xpkg';
const ev = (txd, seq, note) => ({
  id: { txDigest: txd, eventSeq: seq }, type: `${PKG}::events::NoteMinted`, timestampMs: '100',
  parsedJson: { note_id: note, strategy: [1], issuer: '0xa', manager_id: '0xm',
    notional: '1000', expiry_ts_ms: '1', walrus_blob_id: [2], is_public: false },
});

// fake client returns scripted pages
function fakeClient(pages) {
  let i = 0;
  return { queryEvents: async () => pages[i++] };
}

test('drainOnce loops until hasNextPage=false and advances cursor', async () => {
  const db = openDb();
  const client = fakeClient([
    { data: [ev('T1', '0', '0xn1')], nextCursor: { txDigest: 'T1', eventSeq: '0' }, hasNextPage: true },
    { data: [ev('T2', '0', '0xn2')], nextCursor: { txDigest: 'T2', eventSeq: '0' }, hasNextPage: false },
  ]);
  const n = await drainOnce({ client, db, pkg: PKG });
  assert.equal(n, 2);
  assert.deepEqual(getCursor(db), { tx_digest: 'T2', event_seq: '0' });
});

test('drainOnce on empty page does not rewind cursor', async () => {
  const db = openDb();
  await drainOnce({ db, pkg: PKG, client: fakeClient([
    { data: [ev('T1', '0', '0xn1')], nextCursor: { txDigest: 'T1', eventSeq: '0' }, hasNextPage: false }]) });
  await drainOnce({ db, pkg: PKG, client: fakeClient([
    { data: [], nextCursor: null, hasNextPage: false }]) });
  assert.deepEqual(getCursor(db), { tx_digest: 'T1', event_seq: '0' });
});

test('drainOnce skips unknown event types (normalize null)', async () => {
  const db = openDb();
  const n = await drainOnce({ db, pkg: PKG, client: fakeClient([
    { data: [{ id: { txDigest: 'T1', eventSeq: '0' }, type: `${PKG}::x::Y`, parsedJson: {} }],
      nextCursor: { txDigest: 'T1', eventSeq: '0' }, hasNextPage: false }]) });
  assert.equal(n, 0);
});
