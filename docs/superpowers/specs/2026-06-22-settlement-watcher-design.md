# Settlement Watcher — Design

Date: 2026-06-22
Status: APPROVED (brainstorming) + sui-indexer & sui-architect skill review integrated

## Goal

A long-running off-chain daemon that detects matured-but-unsettled notes and pushes a
proactive notification (log + optional webhook) to holders who are not actively watching
the frontend. This is the "watcher / notify" half of the settlement-keeper work.

**Out of scope (next round):** sponsored-tx gas station (holder-signs claim, project pays
gas). This spec is notification-only and performs **no signing and touches no funds**.

## Background / Constraints (already established)

- **A keeper structurally cannot execute `claim` for the holder.** `claim` consumes a
  by-value owned soulbound note; only the owner can sign for an owned object. (Decided
  2026-06-19, see `move-notes.md`.) So the keeper's legitimate job is detection +
  notification; the holder still signs their own claim.
- **Infrastructure already exists:**
  - `scripts/indexer/queries.js::pendingSettle(db, nowMs)` returns notes past expiry with
    no settlement row.
  - `scripts/indexer/ingest.js::runPoller(...)` continuously tails `events`-module events
    into the sqlite db every `pollMs` (default 3000).
  - The frontend already polls `/notes` and renders a Claim button per matured note.
- Therefore this watcher is a **supplementary side-channel**, not the primary claim path.

## Architecture

Single process, two decoupled loops sharing one db handle and one `AbortController`
(topology A — avoids multi-process sqlite WAL writer contention; keeps ingest and notify
as separate, independently-testable units).

```
keeper.js (CLI)
 ├─ runPoller(...)    ← existing; keeps db fresh (ingest.js)
 └─ runWatcher(...)   ← new; reads pendingSettle → notifies (watcher.js)
                          └─ notifyMatured(...)  ← new; log + optional webhook (notify.js)
```

### Units

**`scripts/indexer/notify.js`** — pure notification dispatch.
- `notifyMatured({ note, webhookUrl, fetch, log })`
  - Always emits a structured log line **synchronously first** (see Key Decision 1).
  - If `webhookUrl` set: best-effort `POST` JSON `{ noteId, owner, expiry_ts_ms, strategy, notional }`
    where `owner := note.issuer` (the schema column is `issuer`; for soulbound mint-to-self
    owner == issuer). POST uses a **webhook-local** `AbortSignal.timeout(3000)` — distinct from
    the loop `signal`, so a slow webhook self-aborts and an aborting loop doesn't truncate an
    in-flight POST mid-decision. Failures are caught and logged; they never throw to the caller.
  - Payload fields (`strategy`, `notional`, …) are **untrusted chain-derived data** (an attacker
    can mint a note with adversarial `strategy` bytes); downstream webhook consumers must treat
    them as such. We do not reflect them into the URL — no SSRF surface here.
- Dependencies `fetch` and `log` are injected for testability.

**`scripts/indexer/watcher.js`** — detection loop.
- `runWatcher({ db, nowFn = Date.now, pollMs = 3000, webhookUrl, fireBacklog = false, signal, log, fetch })`
  - **Cold-start boundary (once, before the loop):** establish a persistent `seed_cutoff_ts`.
    On the first-ever run, write `seed_cutoff_ts = nowFn()` into the `meta` table; on restart,
    read the existing value (do **not** reset it). This replaces snapshot-seeding — it is
    order-independent and immune to the poller race (a note the poller ingests microseconds
    after start is judged by its own `expiry_ts_ms`, not by whether it happened to be in a
    start-time snapshot). `--fire-backlog` ignores the cutoff entirely.
  - Loop until `signal.aborted`:
    1. `rows = pendingUnnotified(db, nowFn())` — matured, unsettled, not-yet-notified, in one SQL JOIN.
    2. `fresh = fireBacklog ? rows : rows.filter(r => Number(r.expiry_ts_ms) >= seedCutoff)`
       — notes matured **before** the cutoff are backlog: silently skip (never marked, but the
       cutoff predicate keeps them out of `fresh` every poll, so no per-row state needed).
    3. For each `fresh` note: `notifyMatured(...)` (emits the durable log) **then**
       `markNotified(db, note_id, nowFn())`. Log-before-mark: a crash between the two re-fires
       the log on restart (at-least-once log) rather than permanently suppressing a never-logged note.
    4. `sleep(pollMs, signal)`.
  - The cutoff logic lives in `runWatcher` (not the CLI) so both `watcher.js` and `keeper.js`
    get identical behavior; the `--fire-backlog` flag maps to `fireBacklog`.
  - Same fail-counter / backoff discipline as `runPoller` (`maxFails`, exponential backoff,
    abort-aware sleep) so a transient error doesn't kill the daemon and a persistent one
    fails loud.
  - **Effective poll interval** is `pollMs` + worst-case poller `drainOnce` time: better-sqlite3
    is synchronous and shares the event-loop thread with the poller, so a long multi-page drain
    delays the next watcher tick. Acceptable; documented so no one adds spurious `async` db wrappers.
- CLI entry: `node watcher.js <dbPath>` (watcher-only, assumes ingest runs elsewhere).

**`scripts/indexer/keeper.js`** — combined CLI.
- Opens one db, builds one `AbortController`, starts `runPoller` and `runWatcher`
  concurrently, wires `SIGINT`/`SIGTERM` → `abort()`.
- **Supervision contract (fail-loud, Rule 12):** `Promise.race([poller, watcher])` — if **either**
  loop throws (e.g. poller hits `maxFails`), keeper calls `abort()` on both and exits non-zero.
  A dead poller must not leave the watcher silently polling a stale db.
- `node keeper.js <dbPath> [--fire-backlog]` — maps `--fire-backlog` to `runWatcher`'s
  `fireBacklog`. Cutoff/dedup logic itself is owned by `runWatcher`, not the CLI.

### DB changes (`db.js`)

- New tables:
  ```sql
  CREATE TABLE IF NOT EXISTS notified (
    note_id     TEXT PRIMARY KEY,
    notified_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (        -- generic kv; first use: seed_cutoff_ts
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  ```
- Helpers:
  - `isNotified(db, noteId) -> boolean`
  - `markNotified(db, noteId, ts)`
  - `getOrInitMeta(db, key, initFn) -> string` — read `key`, or insert `initFn()` once and return it
    (used for the persistent `seed_cutoff_ts`; insert-or-ignore keeps it stable across restarts).
- New query in `queries.js`:
  - `pendingUnnotified(db, nowMs)` — `pendingSettle`'s body plus `LEFT JOIN notified x USING(note_id)
    WHERE x.note_id IS NULL`. Existing `pendingSettle` (and the `/pending-settle` route) is left
    unchanged. Replaces the N+1 `isNotified` JS loop with one JOIN.

## Key Decisions

1. **Log is source of truth; webhook is best-effort — log emitted BEFORE mark.** The structured
   log line is emitted synchronously *first*, then the note is marked notified, then the webhook
   POST is attempted best-effort. Ordering matters: marking before logging would let a crash
   between the two permanently suppress a note whose log never emitted. Log-before-mark makes the
   durable record actually durable (a crash re-fires the log on restart — at-least-once log,
   cheap to dedup downstream — rather than at-most-once-then-dropped). Webhook failures are logged
   but never retried and never block ingest: a down/slow endpoint must not (a) wedge settlement
   detection, nor (b) re-fire every poll forever (spam).

2. **Persistent dedup table.** Notified state lives in sqlite (`notified`), not memory, so a
   restart does not re-notify already-handled notes and the webhook stays idempotent.

3. **Cold-start timestamp boundary (not snapshot-seed).** A persistent `seed_cutoff_ts` (written
   once on first-ever run, reused across restarts) defines "backlog": any pending note whose
   `expiry_ts_ms < seed_cutoff_ts` is silently skipped, everything maturing at/after the cutoff
   fires. This replaces an earlier snapshot-seed design that **raced `runPoller`** — a note the
   poller ingested microseconds after process start could land in the start-time snapshot and be
   suppressed forever. The cutoff is a pure predicate on each note's own `expiry_ts_ms`, so it is
   order-independent and immune to ingest timing. `--fire-backlog` ignores the cutoff (fire history).

4. **Local-clock maturity, trailing finality.** Maturity compares `nowFn()` to `expiry_ts_ms`;
   approximate to the daemon's clock — acceptable for a notification trigger, not a money/auth
   decision. `nowFn` is injectable for deterministic tests. Note the watcher's view is read from
   indexed events, so "matured" means "matured per the last successful ingest" and trails chain
   head by up to `pollMs` + RPC lag. A testnet reorg could roll back a settlement/mint already
   ingested; blast radius is at most a spurious/premature *notification* (no funds), so this is
   tolerated and documented rather than defended.

## Red Team (data-processing + outbound webhook; no signing / no funds)

| # | Vector | Defense |
|---|--------|---------|
| 1 | Restart re-spams every prior note | Persistent `notified` table |
| 2 | Webhook endpoint down/slow | Best-effort POST with timeout; catch + log; no retry-storm; never blocks loop |
| 3 | Cold-start backlog floods webhook | Persistent `seed_cutoff_ts` boundary (order-independent, no poller race); `--fire-backlog` to opt in |
| 4 | Webhook URL SSRF / abuse | URL is operator env (`WATCHER_WEBHOOK_URL`), not user-controllable; chain-derived payload fields go in body only, never the URL |
| 5 | Local clock skew vs on-chain expiry | Approximate maturity is acceptable for a notification trigger; `nowFn` injectable for tests |
| 6 | Crash between log and mark drops a holder | Log emitted **before** mark → restart re-fires the log (at-least-once), never at-most-once-then-dropped |
| 7 | Dead poller leaves watcher polling stale db | keeper `Promise.race` aborts both loops + exits non-zero on either throw |

## Non-goals (roadmap)

- **Re-notify / escalation on an interval.** Each note fires exactly once. Holders are not
  silently dropped: the durable log persists the record, and `/pending-settle` + the frontend
  Claim button already surface un-settled notes persistently — the watcher is only the proactive
  ping on top. `notified.notified_at` is retained so a future `REMIND_MS` backoff re-notify can
  be added without schema change.
- **Pruning `notified` against `settlements`.** The JOIN-dedup means a notified note never
  re-fires regardless, so the table is append-only housekeeping; growth is negligible at
  hackathon scale. A periodic `DELETE FROM notified WHERE note_id IN (SELECT note_id FROM
  settlements)` can be added later.
- **Sponsored-tx gas station** (holder-signs claim, project pays gas) — next round.

## Testing

- **`notify.test.js`** — injected fake `fetch`:
  - payload shape `{noteId, owner, expiry_ts_ms, strategy, notional}` with `owner === note.issuer`;
  - no `webhookUrl` → `fetch` never called, log still emitted;
  - `fetch` rejects / times out → `notifyMatured` does not throw, failure logged;
  - log is emitted before the webhook POST is attempted.
- **`watcher.test.js`** — in-memory db + fake `nowFn` + `AbortController`:
  - dedup: same note across two polls fires exactly once;
  - cutoff backlog: a note with `expiry_ts_ms < seed_cutoff_ts` never fires (no race on poller);
  - new maturity: a note maturing at/after the cutoff fires exactly once;
  - cutoff persists across a simulated restart (same db) — backlog stays suppressed, no re-fire;
  - `--fire-backlog` / `fireBacklog: true` fires the pre-cutoff backlog;
  - log-before-mark: a note left un-marked (simulated crash after log) re-fires its log next run;
  - abort: `signal.abort()` exits the loop promptly.
- **Monkey:** webhook rejecting on every call does not kill the loop; many notes maturing in
  the same millisecond each fire once; abort mid-sleep returns immediately; poller throw aborts
  the keeper non-zero (supervision).

Tests encode WHY: dedup protects holders from spam; the cutoff boundary protects the webhook from
cold-start floods *without* racing ingest; log-before-mark protects a holder from being silently
dropped on crash; webhook-isolation protects settlement detection from external outages.

## Config

- `WATCHER_WEBHOOK_URL` (optional) — env, operator-set. Absent → log-only.
- Reuses `PKG`, `RPC` from `scripts/integration/config.js` for the poller.

## Files

- New: `scripts/indexer/notify.js`, `watcher.js`, `keeper.js`, `notify.test.js`, `watcher.test.js`
- Modified: `scripts/indexer/db.js` (`notified` + `meta` tables, `isNotified`/`markNotified`/`getOrInitMeta`)
- Modified: `scripts/indexer/queries.js` (new `pendingUnnotified`; existing `pendingSettle` untouched)
