import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, getCursor, ingestPage } from './db.js';

const mint = (txd, seq, note, notional = '1000000') => ({ table: 'notes', row: {
  tx_digest: txd, event_seq: seq, note_id: note, strategy: '7261', issuer: '0xa',
  manager_id: '0xm', notional, expiry_ts_ms: '1800000000000', walrus_blob_id: '01',
  is_public: 0, minted_at_ms: '1700000000000' } });
const settle = (txd, seq, note, payout) => ({ table: 'settlements', row: {
  tx_digest: txd, event_seq: seq, note_id: note, payout, perf_fee: '0',
  settled_by: '0xa', settled_at_ms: '1700000000001' } });

test('openDb starts with null cursor', () => {
  assert.equal(getCursor(openDb()), null);
});

test('ingestPage inserts rows and advances cursor', () => {
  const db = openDb();
  const n = ingestPage(db, [mint('T1', '0', '0xn1')], { txDigest: 'T1', eventSeq: '0' });
  assert.equal(n, 1);
  assert.deepEqual(getCursor(db), { tx_digest: 'T1', event_seq: '0' });
});

test('replay of same envelope is idempotent (no duplicate, no error)', () => {
  const db = openDb();
  ingestPage(db, [mint('T1', '0', '0xn1')], { txDigest: 'T1', eventSeq: '0' });
  const n = ingestPage(db, [mint('T1', '0', '0xn1')], { txDigest: 'T1', eventSeq: '0' });
  assert.equal(n, 0); // ignored
  assert.equal(db.prepare('SELECT COUNT(*) c FROM notes').get().c, 1);
});

test('double-settle same note_id is rejected by UNIQUE (no fan-out)', () => {
  const db = openDb();
  ingestPage(db, [mint('T1', '0', '0xn1')], { txDigest: 'T1', eventSeq: '0' });
  ingestPage(db, [settle('T2', '0', '0xn1', '500')], { txDigest: 'T2', eventSeq: '0' });
  // a SECOND distinct settlement event for the same note (different envelope)
  ingestPage(db, [settle('T3', '0', '0xn1', '999')], { txDigest: 'T3', eventSeq: '0' });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM settlements WHERE note_id=?').get('0xn1').c, 1);
});

test('nextCursor=null preserves prior cursor (empty page does not rewind)', () => {
  const db = openDb();
  ingestPage(db, [mint('T1', '0', '0xn1')], { txDigest: 'T1', eventSeq: '0' });
  ingestPage(db, [], null); // empty poll
  assert.deepEqual(getCursor(db), { tx_digest: 'T1', event_seq: '0' });
});

test('u64 TEXT survives values above MAX_SAFE_INTEGER', () => {
  const db = openDb();
  const big = '9223372036854775808';
  ingestPage(db, [mint('T1', '0', '0xn1', big)], { txDigest: 'T1', eventSeq: '0' });
  assert.equal(db.prepare('SELECT notional FROM notes WHERE note_id=?').get('0xn1').notional, big);
});
