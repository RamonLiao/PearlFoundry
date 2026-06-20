// Monkey tests (test.md): try to break the pure ladder builder with degenerate inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLadder } from './ladder.js';

const T = 1_000_000_000n;

test('forward pinned at minStrike → lower clamps, ladder degenerates upward only', () => {
  const center = 50_000_000_000_000n;
  const r = buildLadder({ forward: center, tickSize: T, minStrike: center,
    loBound: center - 5n * T, hiBound: center + 3n * T });
  assert.ok(r.lower >= center, 'lower never dips below minStrike');
  assert.equal(r.center, center);
});

test('loBound > hiBound (probe found nothing) → single-leg center ladder', () => {
  const center = 62_500_000_000_000n;
  const r = buildLadder({ forward: center, tickSize: T, minStrike: 0n,
    loBound: center + T, hiBound: center - T });
  assert.equal(r.legs, 1);
  assert.equal(r.lower, center);
  assert.equal(r.upper, center);
});

test('huge tickSize coarser than band → at most a few legs', () => {
  const center = 62_500_000_000_000n;
  const big = 1_000_000_000_000n; // $1000 tick
  const r = buildLadder({ forward: center, tickSize: big, minStrike: 0n,
    loBound: center - big, hiBound: center + big });
  assert.ok(r.legs <= 3);
  assert.equal(r.step, big);
});

test('forward off-grid snaps to center; ladder stays grid-aligned', () => {
  const off = 62_500_400_000_000n; // not on the $1 grid
  const r = buildLadder({ forward: off, tickSize: T, minStrike: 0n,
    loBound: off - 3n * T, hiBound: off + 3n * T });
  assert.equal(r.center % T, 0n, 'center on grid');
  assert.equal(r.lower % T, 0n, 'lower on grid');
  assert.equal(r.upper % T, 0n, 'upper on grid');
  assert.equal((r.upper - r.lower) % r.step, 0n, 'span divisible by step');
});
