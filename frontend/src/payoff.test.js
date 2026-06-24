import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePayoffCurve } from './payoff.js';

const T = 1_000_000_000_000n;            // $1k tick for readable numbers
const base = { lower: 60n * T, upper: 66n * T, step: T, qtyPerLeg: 2_000_000n }; // 7 legs

test('legs count = (upper-lower)/step + 1', () => {
  const c = computePayoffCurve(base);
  assert.equal(c.legs, 7);
});

test('maxPayout = qtyPerLeg * legs', () => {
  const c = computePayoffCurve(base);
  assert.equal(c.maxPayout, 7 * 2_000_000);
});

test('payout is monotonic non-decreasing across points', () => {
  const c = computePayoffCurve(base);
  for (let i = 1; i < c.points.length; i++) {
    assert.ok(c.points[i].payout >= c.points[i - 1].payout, `drop at ${i}`);
  }
});

test('each riser steps up by exactly qtyPerLeg', () => {
  const c = computePayoffCurve(base);
  // points come in (bottom,top) pairs per strike; top-bottom == qtyPerLeg
  for (let i = 0; i + 1 < c.points.length; i += 2) {
    assert.equal(c.points[i + 1].payout - c.points[i].payout, 2_000_000);
  }
});

test('first strike payout starts at 0, last reaches maxPayout', () => {
  const c = computePayoffCurve(base);
  assert.equal(c.points[0].payout, 0);
  assert.equal(c.points[c.points.length - 1].payout, c.maxPayout);
  assert.equal(c.strikes.length, 7);
  assert.equal(c.strikes[0], Number(60n * T));
  assert.equal(c.strikes[6], Number(66n * T));
});

test('accepts string and number inputs', () => {
  const c = computePayoffCurve({ lower: '60000000000000', upper: '66000000000000', step: '1000000000000', qtyPerLeg: '2000000' });
  assert.equal(c.legs, 7);
});

// Monkey / fail-loud guards
test('throws on step <= 0', () => {
  assert.throws(() => computePayoffCurve({ ...base, step: 0n }), /step/);
});
test('throws on upper <= lower', () => {
  assert.throws(() => computePayoffCurve({ ...base, upper: 60n * T }), /range/i);
});
test('throws on grid misalignment ((upper-lower) % step != 0)', () => {
  assert.throws(() => computePayoffCurve({ ...base, step: 700_000_000_000n }), /grid|align/i);
});
test('throws on legs > 128', () => {
  assert.throws(() => computePayoffCurve({ lower: 0n, upper: 200n * T, step: T, qtyPerLeg: 1n }), /128|legs/i);
});
test('grid guard uses BigInt (no float precision loss at e9)', () => {
  // (upper-lower) = 6e12, step = 1e12 → exactly 7 legs; a float % would be fine here,
  // but a misaligned e9 grid must still be caught:
  assert.throws(() => computePayoffCurve({ lower: 60_000_000_000_000n, upper: 66_000_000_000_001n, step: 1_000_000_000_000n, qtyPerLeg: 1n }), /grid|align/i);
});
