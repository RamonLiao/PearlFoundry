// scripts/pricing/qty.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQtyPerLeg } from './qty.js';

test('matches on-chain: fee=30bps, net split equally across legs', () => {
  // notional 10 dUSDC = 10_000_000 (6dp); fee = 10_000_000*30/10000 = 30_000; net = 9_970_000
  // legs 7 → qty = floor(9_970_000 / 7) = 1_424_285
  assert.equal(computeQtyPerLeg({ notional: 10_000_000n, feeBps: 30, legs: 7 }), 1_424_285n);
});

test('accepts string/number inputs', () => {
  assert.equal(computeQtyPerLeg({ notional: '10000000', feeBps: '30', legs: '7' }), 1_424_285n);
});

test('fee uses floor division (no rounding up)', () => {
  // notional 1_000_001, fee = floor(1_000_001*30/10000) = floor(3000.003) = 3000
  assert.equal(computeQtyPerLeg({ notional: 1_000_001n, feeBps: 30, legs: 1 }), 997_001n);
});

test('throws when qty would be 0 (dust over too many legs)', () => {
  assert.throws(() => computeQtyPerLeg({ notional: 100n, feeBps: 30, legs: 128 }), /qty|zero/i);
});
