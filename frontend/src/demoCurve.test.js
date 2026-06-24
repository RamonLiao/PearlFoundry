import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_CURVE, DEMO_FORWARD } from './demoCurve.js';

test('DEMO_CURVE is a valid monotonic staircase with a visible floor and few legs', () => {
  assert.ok(DEMO_CURVE.legs >= 4 && DEMO_CURVE.legs <= 8, 'few legs so the staircase reads clearly');
  assert.ok(DEMO_CURVE.baseline > 0, 'non-zero leftover so the floor tick is visible');
  assert.equal(DEMO_CURVE.maxPayout, DEMO_CURVE.baseline + DEMO_CURVE.qtyPerLeg * DEMO_CURVE.legs);
  // strikes strictly increasing
  for (let i = 1; i < DEMO_CURVE.strikes.length; i++) {
    assert.ok(DEMO_CURVE.strikes[i] > DEMO_CURVE.strikes[i - 1]);
  }
});

test('DEMO_FORWARD sits inside the band so the marker lands on the staircase', () => {
  assert.ok(DEMO_FORWARD > DEMO_CURVE.strikes[0]);
  assert.ok(DEMO_FORWARD < DEMO_CURVE.strikes[DEMO_CURVE.strikes.length - 1]);
});
