import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, isNotified, markNotified, getOrInitMeta } from './db.js';

test('markNotified then isNotified round-trips and is idempotent', () => {
  const db = openDb();
  assert.equal(isNotified(db, '0xn1'), false);
  markNotified(db, '0xn1', 100);
  assert.equal(isNotified(db, '0xn1'), true);
  markNotified(db, '0xn1', 999); // insert-or-ignore: no throw, no overwrite
  const row = db.prepare('SELECT notified_at FROM notified WHERE note_id=?').get('0xn1');
  assert.equal(row.notified_at, 100); // original timestamp preserved
});

test('getOrInitMeta initializes once and is stable across calls (restart-safe)', () => {
  const db = openDb();
  const first = getOrInitMeta(db, 'seed_cutoff_ts', () => 1234);
  const second = getOrInitMeta(db, 'seed_cutoff_ts', () => 9999); // initFn ignored on 2nd read
  assert.equal(first, '1234');
  assert.equal(second, '1234');
});
