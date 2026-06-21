// test.md: break it with degenerate inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, ingestPage, getCursor } from './db.js';
import { leaderboard, pendingSettle } from './queries.js';

const settle = (tx, note, payout) => ({ table: 'settlements', row: {
  tx_digest: tx, event_seq: '0', note_id: note, payout, perf_fee: '0', settled_by: '0xa', settled_at_ms: '1' } });

test('orphan settlement (no matching mint) does not appear in leaderboard', () => {
  const db = openDb();
  ingestPage(db, [settle('T1', '0xghost', '500')], { txDigest: 'T1', eventSeq: '0' });
  assert.equal(leaderboard(db).length, 0); // JOIN on notes drops orphan
});

test('repeated empty pages never rewind cursor', () => {
  const db = openDb();
  ingestPage(db, [], { txDigest: 'T1', eventSeq: '5' });
  for (let i = 0; i < 5; i++) ingestPage(db, [], null);
  assert.deepEqual(getCursor(db), { tx_digest: 'T1', event_seq: '5' });
});

test('pendingSettle with no notes returns empty (not error)', () => {
  assert.deepEqual(pendingSettle(openDb(), 999), []);
});

test('two distinct fee events same note both retained (envelope PK, not note_id)', () => {
  const db = openDb();
  const fee = (tx, kind, amt) => ({ table: 'fees', row: { tx_digest: tx, event_seq: '0', note_id: '0xn1', kind, amount: amt } });
  ingestPage(db, [fee('T1', 0, '30'), fee('T2', 1, '50')], { txDigest: 'T2', eventSeq: '0' });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM fees WHERE note_id=?').get('0xn1').c, 2);
});
