import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortId } from './format.js';

// 66-char normalized id: 0x + 64 hex
const FULL = '0x' + '1a2b3c4d'.repeat(8); // length 66

test('shortId truncates a normalized id to head…tail', () => {
  assert.equal(shortId(FULL), '0x1a2b…3c4d');           // head 6, tail 4
});

test('shortId default byte-identity vs slice(0,6)…slice(-4)', () => {
  assert.equal(shortId(FULL), `${FULL.slice(0, 6)}…${FULL.slice(-4)}`);
});

// THE BUG THIS FIXES: a left-zero-padded id renders all-zeros under slice(0,12);
// head…tail keeps the meaningful tail bytes visible.
test('shortId on a zero-padded id still shows the tail (the slice(0,12) bug)', () => {
  const padded = '0x' + '0'.repeat(60) + 'dead'; // length 66, tail = "dead"
  const out = shortId(padded);
  assert.equal(out, '0x0000…dead');
  assert.ok(out.endsWith('dead'), 'tail bytes must survive truncation');
});

test('shortId custom head/tail matches Leaderboard issuer slicing byte-for-byte', () => {
  assert.equal(shortId(FULL, 8, 4), `${FULL.slice(0, 8)}…${FULL.slice(-4)}`);
});

// monkey: degenerate inputs must never throw and never emit a bare "…"
test('shortId returns empty string for null/undefined/empty/non-string', () => {
  assert.equal(shortId(null), '');
  assert.equal(shortId(undefined), '');
  assert.equal(shortId(''), '');
  assert.equal(shortId(12345), '');
});

test('shortId returns short input unchanged (no negative-index surprise)', () => {
  assert.equal(shortId('0xabcd'), '0xabcd'); // length 6 <= 6+4
  assert.equal(shortId('0x', 6, 4), '0x');
});

// boundary: at head+tail+1 (=11 with defaults) truncation would only drop ONE char and
// add "…" — not shorter, so the id must be returned unchanged. One char longer DOES truncate.
test('shortId leaves a head+tail+1 length id unchanged, truncates at +2', () => {
  assert.equal(shortId('0x123456789'), '0x123456789'); // length 11 = 6+4+1 → unchanged
  assert.equal(shortId('0x1234567890'), '0x1234…7890'); // length 12 → truncates
});
