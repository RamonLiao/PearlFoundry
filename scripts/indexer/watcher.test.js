import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, ingestPage } from './db.js';
import { computeSeedCutoff, watchOnce, runWatcher } from './watcher.js';

function note(tx, note_id, expiry) {
  return { table: 'notes', row: {
    tx_digest: tx, event_seq: '0', note_id, strategy: '7261', issuer: '0xA', manager_id: '0xm',
    notional: '1000', expiry_ts_ms: String(expiry), walrus_blob_id: '01', is_public: 0, minted_at_ms: '0' } };
}
const collect = (sink) => (_url, opts) => { sink.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true }); };

test('fires a note maturing at/after cutoff exactly once', async () => {
  const db = openDb();
  ingestPage(db, [note('a', '0xn1', 2000)], { txDigest: 'a', eventSeq: '0' });
  const sink = [];
  const args = { db, nowFn: () => 3000, seedCutoff: 1000, fetch: collect(sink), log: () => {}, webhookUrl: 'http://h' };
  assert.equal(await watchOnce(args), 1);
  assert.equal(sink.length, 1);
  assert.equal(sink[0].noteId, '0xn1');
  assert.equal(await watchOnce(args), 0); // marked → JOIN excludes it
  assert.equal(sink.length, 1);
});

test('skips backlog (expiry < cutoff) without marking, every pass', async () => {
  const db = openDb();
  ingestPage(db, [note('a', '0xn2', 500)], { txDigest: 'a', eventSeq: '0' });
  const sink = [];
  const args = { db, nowFn: () => 3000, seedCutoff: 1000, fetch: collect(sink), log: () => {}, webhookUrl: 'http://h' };
  assert.equal(await watchOnce(args), 0);
  assert.equal(await watchOnce(args), 0); // cheap predicate, still skipped, no state needed
  assert.equal(sink.length, 0);
});

test('computeSeedCutoff persists across restarts (same db)', () => {
  const db = openDb();
  assert.equal(computeSeedCutoff(db, { nowFn: () => 1234 }), 1234);
  assert.equal(computeSeedCutoff(db, { nowFn: () => 9999 }), 1234); // 2nd call ignores new now
});

test('fireBacklog ignores cutoff and fires the pre-cutoff backlog', async () => {
  const db = openDb();
  ingestPage(db, [note('a', '0xn3', 500)], { txDigest: 'a', eventSeq: '0' });
  const sink = [];
  assert.equal(await watchOnce({ db, nowFn: () => 3000, seedCutoff: 1000, fireBacklog: true,
    fetch: collect(sink), log: () => {}, webhookUrl: 'http://h' }), 1);
});

test('log-before-mark: crash after log (before mark) re-fires next pass', async () => {
  const db = openDb();
  ingestPage(db, [note('a', '0xn4', 2000)], { txDigest: 'a', eventSeq: '0' });
  const sink = [];
  // log throws right after emitting → watchOnce rejects before markNotified runs
  await assert.rejects(watchOnce({ db, nowFn: () => 3000, seedCutoff: 1000,
    fetch: collect(sink), webhookUrl: 'http://h', log: () => { throw new Error('crash'); } }));
  // note left unmarked → a healthy pass fires it
  assert.equal(await watchOnce({ db, nowFn: () => 3000, seedCutoff: 1000,
    fetch: collect(sink), log: () => {}, webhookUrl: 'http://h' }), 1);
  assert.equal(sink.at(-1).noteId, '0xn4');
});

test('monkey: webhook rejecting every call does not stop the pass; note still marked', async () => {
  const db = openDb();
  ingestPage(db, [note('a', '0xn5', 2000)], { txDigest: 'a', eventSeq: '0' });
  const args = { db, nowFn: () => 3000, seedCutoff: 1000,
    fetch: () => Promise.reject(new Error('down')), log: () => {}, webhookUrl: 'http://h' };
  assert.equal(await watchOnce(args), 1); // notifyMatured swallowed the failure
  assert.equal(await watchOnce(args), 0); // and the note was marked
});

test('monkey: many notes maturing at once each fire exactly once', async () => {
  const db = openDb();
  for (let i = 0; i < 20; i++) ingestPage(db, [note(`t${i}`, `0xn${i}`, 2000)], { txDigest: `t${i}`, eventSeq: '0' });
  const sink = [];
  const args = { db, nowFn: () => 3000, seedCutoff: 1000, fetch: collect(sink), log: () => {}, webhookUrl: 'http://h' };
  assert.equal(await watchOnce(args), 20);
  assert.equal(await watchOnce(args), 0);
  assert.equal(new Set(sink.map((p) => p.noteId)).size, 20);
});

test('runWatcher exits promptly when signal aborts', async () => {
  const db = openDb();
  const controller = new AbortController();
  const p = runWatcher({ db, pollMs: 10, nowFn: () => 0, signal: controller.signal,
    log: () => {}, fetch: () => Promise.resolve({ ok: true }) });
  controller.abort();
  await p; // resolves (does not hang or reject)
  assert.ok(true);
});
