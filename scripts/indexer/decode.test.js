import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToUtf8, hexToBase64 } from './decode.js';

test('hexToUtf8 decodes strategy name', () => {
  assert.equal(hexToUtf8('7261'), 'ra');           // [114,97]
  assert.equal(hexToUtf8(''), '');
});
test('hexToBase64 keeps raw blob id (not utf8)', () => {
  assert.equal(hexToBase64('010203'), Buffer.from([1, 2, 3]).toString('base64'));
});
