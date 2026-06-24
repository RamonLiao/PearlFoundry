import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDusdc, fmtBand, fmtExpiry, fmtPerStep } from './metricRail.js';

test('fmtDusdc renders base units (6 decimals) as 2dp dUSDC, em-dash on null', () => {
  assert.equal(fmtDusdc(5070000), '5.07');
  assert.equal(fmtDusdc('10000000'), '10.00');
  assert.equal(fmtDusdc(null), '—');
  assert.equal(fmtDusdc(undefined), '—');
});

test('fmtBand shows distinct k-labels even for narrow BTC bands', () => {
  // 62.812k vs 62.827k must not both collapse to 63k
  assert.equal(fmtBand(62812_000000000, 62827_000000000), '62.812k–62.827k');
  assert.equal(fmtBand(62000_000000000, 65000_000000000), '62k–65k');
  assert.equal(fmtBand(null, 1), '—');
});

test('fmtExpiry handles SECONDS (10-digit) and millis, em-dash on bad input', () => {
  // 1750000000 s = 2025-06-15T...; result is a yyyy-mm-dd hh:mm string
  assert.match(fmtExpiry('1750000000'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.match(fmtExpiry(1750000000000), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/); // already ms
  assert.equal(fmtExpiry(null), '—');
  assert.equal(fmtExpiry('not-a-number'), '—');
  // monkey: finite-but-out-of-Date-range must not throw RangeError, em-dash instead
  assert.equal(fmtExpiry(1e20), '—');
  assert.equal(fmtExpiry(-1e20), '—');
});

test('fmtPerStep shows +qty × legs', () => {
  assert.equal(fmtPerStep(623125, 16), '+0.62 × 16');
  assert.equal(fmtPerStep(null, 16), '—');
});
