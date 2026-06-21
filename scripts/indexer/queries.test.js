import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, ingestPage, markNotified } from './db.js';
import { leaderboard, listNotes, pendingSettle, feeStats, pendingUnnotified } from './queries.js';

function seed() {
  const db = openDb();
  const note = (tx, note_id, issuer, notional, expiry) => ({ table: 'notes', row: {
    tx_digest: tx, event_seq: '0', note_id, strategy: '7261', issuer, manager_id: '0xm',
    notional, expiry_ts_ms: expiry, walrus_blob_id: '01', is_public: 0, minted_at_ms: '100' } });
  const set = (tx, note_id, issuer, payout, perf) => ({ table: 'settlements', row: {
    tx_digest: tx, event_seq: '0', note_id, payout, perf_fee: perf, settled_by: issuer, settled_at_ms: '200' } });
  const fee = (tx, note_id, kind, amount) => ({ table: 'fees', row: {
    tx_digest: tx, event_seq: '0', note_id, kind, amount } });
  // issuer A: one win (payout 1500 > notional 1000 → +500), one loss (800 < 1000 → -200) → pnl +300, win_rate 0.5
  ingestPage(db, [note('a1','0xn1','0xA','1000','1000'), set('s1','0xn1','0xA','1500','50')], { txDigest: 's1', eventSeq: '0' });
  ingestPage(db, [note('a2','0xn2','0xA','1000','1000'), set('s2','0xn2','0xA','800','0')], { txDigest: 's2', eventSeq: '0' });
  // issuer B: minted but unsettled, expiry already passed
  ingestPage(db, [note('b1','0xn3','0xB','1000','500')], { txDigest: 'b1', eventSeq: '0' });
  ingestPage(db, [fee('f1','0xn1',0,'30'), fee('f2','0xn1',1,'50')], { txDigest: 'f2', eventSeq: '0' });
  return db;
}

test('leaderboard computes pnl, win_rate, omits 0-settlement issuers', () => {
  const lb = leaderboard(seed());
  assert.equal(lb.length, 1); // B omitted (no settlements)
  assert.equal(lb[0].issuer, '0xA');
  assert.equal(lb[0].realized_pnl, 300);
  assert.equal(lb[0].win_rate, 0.5);
  assert.equal(lb[0].note_count, 2);
});

test('pendingSettle returns expired unsettled notes only', () => {
  const ps = pendingSettle(seed(), 600); // now=600
  assert.equal(ps.length, 1);
  assert.equal(ps[0].note_id, '0xn3'); // B's note, expiry 500 < 600, unsettled
});

test('pendingSettle excludes settled and not-yet-expired', () => {
  assert.equal(pendingSettle(seed(), 400).length, 0); // n3 expiry 500 not passed
});

test('listNotes marks settled and filters by issuer', () => {
  const rows = listNotes(seed(), { issuer: '0xA' });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.settled === 1));
});

test('feeStats sums by kind', () => {
  const f = feeStats(seed());
  assert.equal(f.issuance, 30);
  assert.equal(f.perf, 50);
});

test('pendingUnnotified excludes already-notified notes', () => {
  const db = seed();
  assert.equal(pendingUnnotified(db, 600).length, 1); // 0xn3 matured (500<600), unsettled, not notified
  markNotified(db, '0xn3', 600);
  assert.equal(pendingUnnotified(db, 600).length, 0); // now suppressed by the JOIN
});

test('pendingUnnotified still excludes settled and not-yet-expired (same as pendingSettle)', () => {
  assert.equal(pendingUnnotified(seed(), 400).length, 0); // 0xn3 expiry 500 not passed
});
