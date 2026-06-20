import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLadder, snapToGrid } from './ladder.js';

const T = 1_000_000_000n; // tickSize $1

test('snapToGrid rounds to nearest tick', () => {
  assert.equal(snapToGrid(62_447_400_000_000n, T), 62_447_000_000_000n);
  assert.equal(snapToGrid(62_447_600_000_000n, T), 62_448_000_000_000n);
});

test('ladder is forward-centered and symmetric when bounds allow', () => {
  const center = 62_500_000_000_000n;
  const r = buildLadder({ forward: center, tickSize: T, minStrike: 50_000_000_000_000n,
    loBound: center - 3n * T, hiBound: center + 3n * T });
  assert.equal(r.step, T);
  assert.equal(r.lower, center - 3n * T);
  assert.equal(r.upper, center + 3n * T);
  assert.equal(r.legs, 7); // (6T)/T + 1
  assert.equal(r.center, center);
});

test('legs formula with stepMult', () => {
  const center = 62_500_000_000_000n;
  const r = buildLadder({ forward: center, tickSize: T, minStrike: 0n,
    loBound: center - 4n * T, hiBound: center + 4n * T, stepMult: 2 });
  assert.equal(r.step, 2n * T);
  assert.equal((r.upper - r.lower) % r.step, 0n);
  assert.equal(r.legs, Number((r.upper - r.lower) / r.step) + 1);
});

test('minStrike clamps lower bound', () => {
  const center = 51_000_000_000_000n;
  const r = buildLadder({ forward: center, tickSize: T, minStrike: 50_000_000_000_000n,
    loBound: 49_000_000_000_000n, hiBound: center + 2n * T });
  assert.ok(r.lower >= 50_000_000_000_000n);
});

test('asymmetric band: shrink clamps into probed bounds, never emits out-of-band leg', () => {
  const center = 62_500_000_000_000n;
  // band wide below, but exact (narrow) edge 3 ticks above the center
  const hiBound = center + 3n * T;
  const loBound = center - 100n * T;
  const r = buildLadder({ forward: center, tickSize: T, minStrike: 0n,
    loBound, hiBound, maxLegs: 8 });
  assert.ok(r.upper <= hiBound, 'upper never exceeds probed hiBound');
  assert.ok(r.lower >= loBound, 'lower never below probed loBound');
  assert.equal(r.upper, hiBound); // clamped to the narrow side
});

test('MAX_LEGS shrink stays forward-centered and symmetric', () => {
  const center = 62_500_000_000_000n;
  const r = buildLadder({ forward: center, tickSize: T, minStrike: 0n,
    loBound: center - 500n * T, hiBound: center + 500n * T, maxLegs: 128 });
  assert.equal(r.legs, 128);
  assert.ok(r.lower <= center && r.upper >= center);
  assert.ok((r.upper - center) - (center - r.lower) <= r.step);
});
