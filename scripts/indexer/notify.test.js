import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyMatured } from './notify.js';

const NOTE = { note_id: '0xn1', issuer: '0xA', expiry_ts_ms: '500', strategy: '7261', notional: '1000' };

test('logs and POSTs payload with owner=issuer', async () => {
  const calls = [], logs = [];
  const fetch = (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true }); };
  await notifyMatured({ note: NOTE, webhookUrl: 'http://hook', fetch, log: (m) => logs.push(m) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://hook');
  assert.deepEqual(calls[0].body, { noteId: '0xn1', owner: '0xA', expiry_ts_ms: '500', strategy: '7261', notional: '1000' });
  assert.ok(logs.some((m) => m.includes('0xn1')));
});

test('no webhookUrl: never calls fetch, still logs', async () => {
  let called = false; const logs = [];
  await notifyMatured({ note: NOTE, fetch: () => { called = true; }, log: (m) => logs.push(m) });
  assert.equal(called, false);
  assert.ok(logs.some((m) => m.includes('0xn1')));
});

test('webhook failure is swallowed (no throw) and logged', async () => {
  const logs = [];
  await notifyMatured({ note: NOTE, webhookUrl: 'http://hook', fetch: () => Promise.reject(new Error('boom')), log: (m) => logs.push(m) });
  assert.ok(logs.some((m) => m.includes('failed')));
});

test('emits log BEFORE attempting webhook', async () => {
  const order = [];
  await notifyMatured({ note: NOTE, webhookUrl: 'http://hook',
    fetch: () => { order.push('fetch'); return Promise.resolve({ ok: true }); },
    log: () => order.push('log') });
  assert.deepEqual(order, ['log', 'fetch']);
});
