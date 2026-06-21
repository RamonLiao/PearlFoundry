# Settlement Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A notify-only off-chain daemon that detects matured-but-unsettled prediction notes and fires a log line + optional best-effort webhook, with persistent dedup and a race-free cold-start boundary.

**Architecture:** Single process, two decoupled loops sharing one `better-sqlite3` handle and one `AbortController`. The existing `runPoller` keeps the sqlite indexer DB fresh; a new `runWatcher` reads matured-unsettled-unnotified notes via one SQL JOIN and dispatches notifications. A persistent `seed_cutoff_ts` (not a start-time snapshot) defines "backlog" so cold-start can't race ingest. The daemon performs NO signing and touches no funds.

**Tech Stack:** Node.js ESM, `better-sqlite3` (synchronous), `node:test` + `node:assert/strict`, `@mysten/sui` SuiClient (poller only). Test runner: `node --test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-22-settlement-watcher-design.md` (authoritative).
- Working dir for all commands: `scripts/indexer/`.
- ESM only (`"type": "module"`), import paths carry `.js`.
- `better-sqlite3` is **synchronous** — never wrap DB calls in `async`/Promise.
- All TEXT u64 columns (`expiry_ts_ms`, `notional`, …) are strings; coerce with `Number(...)` only for comparison/aggregation (dUSDC-scale < 2^63).
- `owner` in any webhook payload is `note.issuer` (schema has no `owner` column; soulbound mint-to-self → owner == issuer).
- Log is source of truth, emitted BEFORE mark. Webhook is best-effort: failures logged, never thrown, never retried, never block the loop. Webhook POST uses a webhook-local `AbortSignal.timeout(3000)`, distinct from the loop signal.
- Existing `pendingSettle` and the `/pending-settle` route stay UNCHANGED. Add `pendingUnnotified` alongside.
- Out of scope (do not build): re-notify/escalation, `notified` pruning, sponsored-tx.

---

### Task 1: DB layer — `notified` + `meta` tables and helpers

**Files:**
- Modify: `scripts/indexer/db.js` (extend `SCHEMA`; add `isNotified`, `markNotified`, `getOrInitMeta`)
- Test: `scripts/indexer/meta.test.js` (create)

**Interfaces:**
- Consumes: `openDb` (existing).
- Produces:
  - `isNotified(db, noteId) -> boolean`
  - `markNotified(db, noteId, ts)` — insert-or-ignore into `notified`
  - `getOrInitMeta(db, key, initFn) -> string` — read `key`, else insert `String(initFn())` once and return the stored value (stable across restarts)

- [ ] **Step 1: Write the failing test**

Create `scripts/indexer/meta.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, isNotified, markNotified, getOrInitMeta } from './db.js';

test('markNotified then isNotified round-trips and is idempotent', () => {
  const db = openDb();
  assert.equal(isNotified(db, '0xn1'), false);
  markNotified(db, '0xn1', 100);
  assert.equal(isNotified(db, '0xn1'), true);
  markNotified(db, '0xn1', 999); // insert-or-ignore: no throw, no overwrite
  const row = db.prepare('SELECT notified_at FROM notified WHERE note_id=?').get('0xn1');
  assert.equal(row.notified_at, 100); // original timestamp preserved
});

test('getOrInitMeta initializes once and is stable across calls (restart-safe)', () => {
  const db = openDb();
  const first = getOrInitMeta(db, 'seed_cutoff_ts', () => 1234);
  const second = getOrInitMeta(db, 'seed_cutoff_ts', () => 9999); // initFn ignored on 2nd read
  assert.equal(first, '1234');
  assert.equal(second, '1234');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/indexer && node --test meta.test.js`
Expected: FAIL — `isNotified`/`markNotified`/`getOrInitMeta` not exported.

- [ ] **Step 3: Extend the schema**

In `scripts/indexer/db.js`, inside the `SCHEMA` template literal, append these two tables before the closing backtick (after the `cursor` table):

```sql
CREATE TABLE IF NOT EXISTS notified (
  note_id     TEXT PRIMARY KEY,
  notified_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL);
```

- [ ] **Step 4: Add the helpers**

Append to `scripts/indexer/db.js`:

```js
export function isNotified(db, noteId) {
  return db.prepare('SELECT 1 FROM notified WHERE note_id=?').get(noteId) != null;
}

export function markNotified(db, noteId, ts) {
  db.prepare('INSERT OR IGNORE INTO notified (note_id, notified_at) VALUES (?, ?)').run(noteId, Number(ts));
}

// Read key; if absent, insert String(initFn()) once (insert-or-ignore so a concurrent
// init can't double-write) and return the stored value. Stable across restarts.
export function getOrInitMeta(db, key, initFn) {
  const existing = db.prepare('SELECT value FROM meta WHERE key=?').get(key);
  if (existing) return existing.value;
  db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(key, String(initFn()));
  return db.prepare('SELECT value FROM meta WHERE key=?').get(key).value;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd scripts/indexer && node --test meta.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full suite (no regressions)**

Run: `cd scripts/indexer && node --test`
Expected: PASS — all existing tests still green (the two new tables are `IF NOT EXISTS`, no behavior change to `openDb`).

- [ ] **Step 7: Commit**

```bash
git add scripts/indexer/db.js scripts/indexer/meta.test.js
git commit -m "feat(keeper): notified + meta tables and helpers"
```

---

### Task 2: Query — `pendingUnnotified`

**Files:**
- Modify: `scripts/indexer/queries.js` (add `pendingUnnotified`)
- Test: `scripts/indexer/queries.test.js` (append one test)

**Interfaces:**
- Consumes: `notified` table (Task 1), `markNotified` (Task 1).
- Produces: `pendingUnnotified(db, nowMs) -> note rows` — matured (`expiry < now`), unsettled, AND not in `notified`, in one JOIN. Replaces the N+1 `isNotified` JS loop.

- [ ] **Step 1: Write the failing test**

Append to `scripts/indexer/queries.test.js` (the file already imports `openDb, ingestPage` from `./db.js` and defines `seed()` which creates note `0xn3` for issuer B, expiry 500, unsettled):

```js
import { markNotified } from './db.js';
import { pendingUnnotified } from './queries.js';

test('pendingUnnotified excludes already-notified notes', () => {
  const db = seed();
  assert.equal(pendingUnnotified(db, 600).length, 1); // 0xn3 matured (500<600), unsettled, not notified
  markNotified(db, '0xn3', 600);
  assert.equal(pendingUnnotified(db, 600).length, 0); // now suppressed by the JOIN
});

test('pendingUnnotified still excludes settled and not-yet-expired (same as pendingSettle)', () => {
  assert.equal(pendingUnnotified(seed(), 400).length, 0); // 0xn3 expiry 500 not passed
});
```

> Note: `import` statements must sit at the top of the ESM module. Move the two `import` lines up next to the existing imports in `queries.test.js`; keep the two `test(...)` blocks at the end.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/indexer && node --test queries.test.js`
Expected: FAIL — `pendingUnnotified` not exported.

- [ ] **Step 3: Add the query**

Append to `scripts/indexer/queries.js`:

```js
export function pendingUnnotified(db, nowMs) {
  return db.prepare(`
    SELECT n.* FROM notes n
    LEFT JOIN settlements s USING(note_id)
    LEFT JOIN notified x USING(note_id)
    WHERE s.note_id IS NULL AND x.note_id IS NULL
      AND CAST(n.expiry_ts_ms AS INTEGER) < @now`).all({ now: Number(nowMs) });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/indexer && node --test queries.test.js`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add scripts/indexer/queries.js scripts/indexer/queries.test.js
git commit -m "feat(keeper): pendingUnnotified query (JOIN-dedup, pendingSettle untouched)"
```

---

### Task 3: Notification dispatch — `notify.js`

**Files:**
- Create: `scripts/indexer/notify.js`
- Test: `scripts/indexer/notify.test.js`

**Interfaces:**
- Consumes: nothing internal.
- Produces: `async notifyMatured({ note, webhookUrl, fetch = globalThis.fetch, log = console.log }) -> void` — emits a structured log line FIRST; if `webhookUrl` set, best-effort POSTs `{ noteId, owner, expiry_ts_ms, strategy, notional }` (owner = `note.issuer`) with a 3s webhook-local timeout; never throws on webhook failure.

- [ ] **Step 1: Write the failing test**

Create `scripts/indexer/notify.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/indexer && node --test notify.test.js`
Expected: FAIL — cannot find `./notify.js`.

- [ ] **Step 3: Implement `notify.js`**

Create `scripts/indexer/notify.js`:

```js
// Notify a holder that an owned soulbound note has matured. Log is the durable record
// (emitted first); the webhook is a best-effort side-channel that can never throw or block.
export async function notifyMatured({ note, webhookUrl, fetch = globalThis.fetch, log = console.log }) {
  const payload = {
    noteId: note.note_id,
    owner: note.issuer, // schema has no `owner`; soulbound mint-to-self → owner == issuer
    expiry_ts_ms: note.expiry_ts_ms,
    strategy: note.strategy,
    notional: note.notional,
  };
  log(`[keeper] matured note=${payload.noteId} owner=${payload.owner} expiry=${payload.expiry_ts_ms} notional=${payload.notional}`);
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload), // chain-derived, untrusted by downstream; body only, never the URL
      signal: AbortSignal.timeout(3000), // webhook-local, distinct from the loop signal
    });
  } catch (e) {
    log(`[keeper] webhook POST failed for note=${payload.noteId}: ${e.message}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/indexer && node --test notify.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/indexer/notify.js scripts/indexer/notify.test.js
git commit -m "feat(keeper): notifyMatured — log-first, best-effort webhook"
```

---

### Task 4: Watcher loop — `watcher.js`

**Files:**
- Modify: `scripts/indexer/ingest.js` (export `sleep` so the watcher reuses the abort-aware sleep)
- Create: `scripts/indexer/watcher.js`
- Test: `scripts/indexer/watcher.test.js`

**Interfaces:**
- Consumes: `pendingUnnotified` (Task 2), `markNotified` + `getOrInitMeta` (Task 1), `notifyMatured` (Task 3), `sleep` (ingest.js).
- Produces:
  - `computeSeedCutoff(db, { fireBacklog = false, nowFn = Date.now }) -> number` — `0` if `fireBacklog`, else persisted `seed_cutoff_ts`.
  - `async watchOnce({ db, nowFn, seedCutoff, fireBacklog = false, webhookUrl, fetch, log }) -> number` — one scan/notify pass; returns count fired. Backlog (`expiry < seedCutoff`) is skipped without marking.
  - `async runWatcher({ db, nowFn = Date.now, pollMs = 3000, webhookUrl, fireBacklog = false, maxFails = 3, signal, log, fetch }) -> void` — loop with `runPoller`-style fail/backoff discipline.

- [ ] **Step 1: Export `sleep` from ingest.js**

In `scripts/indexer/ingest.js`, change the `sleep` declaration (currently `const sleep = (ms, signal) => ...`) to export it:

```js
export const sleep = (ms, signal) => new Promise((res, rej) => {
  const onAbort = () => { clearTimeout(t); rej(new Error('aborted')); };
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); res(); }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});
```

(Only the leading `const` → `export const` changes; body is identical. The existing in-file callers keep working.)

- [ ] **Step 2: Run existing ingest tests to confirm the export didn't break anything**

Run: `cd scripts/indexer && node --test ingest.test.js`
Expected: PASS — unchanged behavior.

- [ ] **Step 3: Write the failing test**

Create `scripts/indexer/watcher.test.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd scripts/indexer && node --test watcher.test.js`
Expected: FAIL — cannot find `./watcher.js`.

- [ ] **Step 5: Implement `watcher.js`**

Create `scripts/indexer/watcher.js`:

```js
import { pendingUnnotified } from './queries.js';
import { markNotified, getOrInitMeta } from './db.js';
import { notifyMatured } from './notify.js';
import { sleep } from './ingest.js';

const SEED_KEY = 'seed_cutoff_ts';

// Persistent boundary: notes that matured before the watcher first ran are "backlog".
// A pure predicate on each note's own expiry — order-independent, immune to the poller race.
export function computeSeedCutoff(db, { fireBacklog = false, nowFn = Date.now } = {}) {
  return fireBacklog ? 0 : Number(getOrInitMeta(db, SEED_KEY, nowFn));
}

// One scan/notify pass. Log-before-mark: notifyMatured emits the durable log, THEN we mark.
// A crash between the two leaves the note unmarked → re-fired next pass (at-least-once log).
export async function watchOnce({ db, nowFn = Date.now, seedCutoff, fireBacklog = false, webhookUrl, fetch = globalThis.fetch, log = console.log }) {
  const rows = pendingUnnotified(db, nowFn());
  const fresh = fireBacklog ? rows : rows.filter((r) => Number(r.expiry_ts_ms) >= seedCutoff);
  for (const note of fresh) {
    await notifyMatured({ note, webhookUrl, fetch, log });
    markNotified(db, note.note_id, nowFn());
  }
  return fresh.length;
}

export async function runWatcher({ db, nowFn = Date.now, pollMs = 3000, webhookUrl, fireBacklog = false, maxFails = 3, signal, log = console.log, fetch = globalThis.fetch }) {
  const seedCutoff = computeSeedCutoff(db, { fireBacklog, nowFn });
  let fails = 0;
  while (!signal?.aborted) {
    try {
      await watchOnce({ db, nowFn, seedCutoff, fireBacklog, webhookUrl, fetch, log });
      fails = 0;
      await sleep(pollMs, signal);
    } catch (e) {
      if (signal?.aborted) return;
      fails += 1;
      log(`[keeper] watch failed (${fails}/${maxFails}): ${e.message}`);
      if (fails >= maxFails) throw new Error(`watcher stopped after ${maxFails} consecutive failures`);
      await sleep(pollMs * 2 ** fails, signal);
    }
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd scripts/indexer && node --test watcher.test.js`
Expected: PASS (8 tests).

- [ ] **Step 7: Commit**

```bash
git add scripts/indexer/ingest.js scripts/indexer/watcher.js scripts/indexer/watcher.test.js
git commit -m "feat(keeper): runWatcher — cutoff boundary, log-before-mark, abort-aware loop"
```

---

### Task 5: Combined daemon — `keeper.js` + supervision

**Files:**
- Create: `scripts/indexer/keeper.js`
- Test: `scripts/indexer/keeper.test.js`

**Interfaces:**
- Consumes: `runPoller` (ingest.js), `runWatcher` (watcher.js).
- Produces: `async runKeeper({ db, client, pkg, controller, pollMs, webhookUrl, fireBacklog, log, runPollerFn = runPoller, runWatcherFn = runWatcher }) -> void` — starts both loops on the shared `controller.signal`; on either loop throwing, aborts both and rejects (fail-loud). `runPollerFn`/`runWatcherFn` are injectable for tests.

- [ ] **Step 1: Write the failing test**

Create `scripts/indexer/keeper.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runKeeper } from './keeper.js';

test('poller throwing aborts the watcher and rejects (fail-loud supervision)', async () => {
  const controller = new AbortController();
  let watcherAborted = false;
  const runPollerFn = async () => { throw new Error('poller died'); };
  const runWatcherFn = async ({ signal }) => {
    await new Promise((res) => signal.addEventListener('abort', res, { once: true }));
    watcherAborted = true;
  };
  await assert.rejects(
    runKeeper({ db: {}, client: {}, pkg: '0x0', controller, runPollerFn, runWatcherFn, log: () => {} }),
    /poller died/,
  );
  assert.equal(controller.signal.aborted, true);
  assert.equal(watcherAborted, true);
});

test('watcher throwing aborts the poller and rejects', async () => {
  const controller = new AbortController();
  let pollerAborted = false;
  const runWatcherFn = async () => { throw new Error('watcher died'); };
  const runPollerFn = async ({ signal }) => {
    await new Promise((res) => signal.addEventListener('abort', res, { once: true }));
    pollerAborted = true;
  };
  await assert.rejects(
    runKeeper({ db: {}, client: {}, pkg: '0x0', controller, runPollerFn, runWatcherFn, log: () => {} }),
    /watcher died/,
  );
  assert.equal(pollerAborted, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/indexer && node --test keeper.test.js`
Expected: FAIL — cannot find `./keeper.js`.

- [ ] **Step 3: Implement `keeper.js`**

Create `scripts/indexer/keeper.js`:

```js
import { runPoller } from './ingest.js';
import { runWatcher } from './watcher.js';

// Single process, two loops, one AbortController. If EITHER loop throws, abort both and
// reject — a dead poller must not leave the watcher polling a stale db (fail-loud, Rule 12).
export async function runKeeper({ db, client, pkg, controller, pollMs, webhookUrl, fireBacklog = false,
  log = console.log, runPollerFn = runPoller, runWatcherFn = runWatcher }) {
  const signal = controller.signal;
  const poller = runPollerFn({ client, db, pkg, pollMs, log, signal });
  const watcher = runWatcherFn({ db, pollMs, webhookUrl, fireBacklog, log, signal });
  try {
    await Promise.race([poller, watcher]);
  } catch (e) {
    controller.abort();
    await Promise.allSettled([poller, watcher]); // let the other loop unwind on the abort
    throw e;
  }
}

// CLI: node keeper.js <dbPath> [--fire-backlog]   env: WATCHER_WEBHOOK_URL
if (import.meta.url === `file://${process.argv[1]}`) {
  const { PKG, RPC } = await import('../integration/config.js');
  const { openDb } = await import('./db.js');
  const { SuiClient } = await import('@mysten/sui/client');
  const db = openDb(process.argv[2] ?? 'indexer.db');
  const client = new SuiClient({ url: RPC });
  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => controller.abort());
  runKeeper({
    db, client, pkg: PKG, controller,
    webhookUrl: process.env.WATCHER_WEBHOOK_URL,
    fireBacklog: process.argv.includes('--fire-backlog'),
  })
    .then(() => process.exit(0))
    .catch((e) => { console.error(`[keeper] fatal: ${e.message}`); process.exit(1); });
  console.log(`[keeper] poller+watcher on ${RPC}${process.env.WATCHER_WEBHOOK_URL ? ' (webhook on)' : ' (log-only)'}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/indexer && node --test keeper.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite**

Run: `cd scripts/indexer && node --test`
Expected: PASS — all suites green (existing 37 + meta 2 + queries 2 + notify 4 + watcher 8 + keeper 2).

- [ ] **Step 6: Smoke-test the CLI wiring (log-only, no webhook)**

Run (against the existing test db if present, else a throwaway path):
```bash
cd scripts/indexer && timeout 6 node keeper.js indexer.db || true
```
Expected: prints `[keeper] poller+watcher on <RPC> (log-only)` and `[indexer] ingested N events` lines; no crash before the timeout. (If `indexer.db` doesn't exist it is created empty — the poller backfills from cursor null.)

- [ ] **Step 7: Commit**

```bash
git add scripts/indexer/keeper.js scripts/indexer/keeper.test.js
git commit -m "feat(keeper): combined poller+watcher daemon with fail-loud supervision"
```

---

## Verification (whole feature)

- [ ] `cd scripts/indexer && node --test` → all green.
- [ ] Spec coverage walked: cutoff boundary (Task 4 `computeSeedCutoff`), log-before-mark (Task 3 + Task 4), JOIN-dedup (Task 2), persistent dedup (Task 1), keeper supervision (Task 5), webhook best-effort + 3s timeout + owner=issuer (Task 3), `--fire-backlog` (Task 4/5). Non-goals (re-notify, prune, sponsored-tx) intentionally absent.
- [ ] Update `tasks/progress.md` and, if anything was corrected during execution, `tasks/lessons.md`.
- [ ] Two-round dual-review per `~/.claude/rules/general/dev-rules.md` (`/dual-review`) before declaring complete.
