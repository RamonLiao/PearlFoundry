import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mascotSrc, treatmentClass } from './mascot.js';

test('mascotSrc maps variant number to the public clear-png path', () => {
  assert.equal(mascotSrc(1), '/logo_1-clear.png');
  assert.equal(mascotSrc(2), '/logo_2-clear.png');
  assert.equal(mascotSrc(3), '/logo_3-clear.png');
});

test('mascotSrc rejects out-of-range / non-integer variants (fail loud, not a 404 src)', () => {
  assert.throws(() => mascotSrc(0), /variant/);
  assert.throws(() => mascotSrc(4), /variant/);
  assert.throws(() => mascotSrc('1'), /variant/);
});

test('treatmentClass maps each treatment to its modifier class', () => {
  assert.equal(treatmentClass('duotone'), 'nl-mascot-img--duotone');
  assert.equal(treatmentClass('full'), 'nl-mascot-img--full');
});

test('treatmentClass rejects an unknown treatment (fail loud)', () => {
  assert.throws(() => treatmentClass('sparkly'), /treatment/);
});
