# Settlement Watcher — Design

Date: 2026-06-22
Status: APPROVED (brainstorming)

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
  - Always emits a structured log line.
  - If `webhookUrl` set: best-effort `POST` JSON `{ noteId, owner, expiry_ts_ms, strategy, notional }`
    with a timeout. Failures are caught and logged; they never throw to the caller.
- Dependencies `fetch` and `log` are injected for testability.

**`scripts/indexer/watcher.js`** — detection loop.
- `runWatcher({ db, nowFn = Date.now, pollMs = 3000, webhookUrl, fireBacklog = false, signal, log, fetch })`
  - **Cold-start seed (once, before the loop):** if `!fireBacklog`, `seedNotified(db,
    pendingSettle(db, nowFn()).map(r => r.note_id), nowFn())` — silently mark the current
    backlog as handled so it never fires. If `fireBacklog`, skip seeding.
  - Loop until `signal.aborted`:
    1. `rows = pendingSettle(db, nowFn())`
    2. `fresh = rows.filter(r => !isNotified(db, r.note_id))`
    3. For each `fresh` note: `markNotified(db, note_id, nowFn())` **then** `notifyMatured(...)`.
    4. `sleep(pollMs, signal)`.
  - Seeding lives in `runWatcher` (not the CLI) so both `watcher.js` and `keeper.js` get
    identical cold-start behavior; the `--fire-backlog` flag maps to `fireBacklog`.
  - Same fail-counter / backoff discipline as `runPoller` (`maxFails`, exponential backoff,
    abort-aware sleep) so a transient error doesn't kill the daemon and a persistent one
    fails loud.
- CLI entry: `node watcher.js <dbPath>` (watcher-only, assumes ingest runs elsewhere).

**`scripts/indexer/keeper.js`** — combined CLI.
- Opens one db, builds one `AbortController`, starts `runPoller` and `runWatcher`
  concurrently, wires `SIGINT`/`SIGTERM` → `abort()`.
- `node keeper.js <dbPath> [--fire-backlog]` — maps `--fire-backlog` to `runWatcher`'s
  `fireBacklog`. Cold-start seeding itself is owned by `runWatcher`, not the CLI.

### DB changes (`db.js`)

- New table:
  ```sql
  CREATE TABLE IF NOT EXISTS notified (
    note_id     TEXT PRIMARY KEY,
    notified_at INTEGER NOT NULL
  );
  ```
- Helpers:
  - `isNotified(db, noteId) -> boolean`
  - `markNotified(db, noteId, ts)`
  - `seedNotified(db, noteIds, ts)` — bulk insert-or-ignore, used by cold-start seeding.

## Key Decisions

1. **Log is source of truth; webhook is best-effort.** The log line is emitted and the note
   is marked notified regardless of webhook outcome. Webhook failures are logged but never
   retried and never block ingest. Rationale: a down/slow webhook endpoint must not (a) wedge
   settlement detection, nor (b) re-fire every poll forever (spam). The operator-visible log
   is the durable record; the webhook is a convenience.

2. **Persistent dedup table.** Notified state lives in sqlite (`notified`), not memory, so a
   restart does not re-notify already-handled notes and the webhook stays idempotent.

3. **Cold-start silent seed.** On first run (or whenever a pending note has no `notified` row),
   default behavior treats the **current** backlog of already-matured notes as already handled:
   `runWatcher` seeds all current `pendingSettle` ids into `notified` **without firing**, then
   only fires on genuinely new maturities. `--fire-backlog` disables seeding (fire the
   historical backlog) when an operator explicitly wants catch-up notifications.

4. **Local-clock maturity.** `pendingSettle` compares `Date.now()` to `expiry_ts_ms`. Maturity
   detection is approximate to the daemon's clock; acceptable because this is a notification
   trigger, not a money/authorization decision. `nowFn` is injectable for deterministic tests.

## Red Team (data-processing + outbound webhook; no signing / no funds)

| # | Vector | Defense |
|---|--------|---------|
| 1 | Restart re-spams every prior note | Persistent `notified` table |
| 2 | Webhook endpoint down/slow | Best-effort POST with timeout; catch + log; no retry-storm; never blocks loop |
| 3 | Cold-start backlog floods webhook | First-run silent seed of current pending set; `--fire-backlog` to opt in |
| 4 | Webhook URL SSRF / abuse | URL is operator env (`WATCHER_WEBHOOK_URL`), not user-controllable; documented trust boundary |
| 5 | Local clock skew vs on-chain expiry | Approximate maturity is acceptable for a notification trigger; `nowFn` injectable for tests |

## Testing

- **`notify.test.js`** — injected fake `fetch`:
  - payload shape `{noteId, owner, expiry_ts_ms, strategy, notional}`;
  - no `webhookUrl` → `fetch` never called, log still emitted;
  - `fetch` rejects → `notifyMatured` does not throw, failure logged.
- **`watcher.test.js`** — in-memory db + fake `nowFn` + `AbortController`:
  - dedup: same note across two polls fires exactly once;
  - cold-start seed: pre-existing pending notes are seeded silently, never fired;
  - new maturity: a note crossing `nowFn()` after seed fires exactly once;
  - abort: `signal.abort()` exits the loop promptly.
- **Monkey:** webhook rejecting on every call does not kill the loop; many notes maturing in
  the same millisecond each fire once; abort mid-sleep returns immediately.

Tests encode WHY: dedup protects holders from spam; silent seed protects the webhook from
cold-start floods; webhook-isolation protects settlement detection from external outages.

## Config

- `WATCHER_WEBHOOK_URL` (optional) — env, operator-set. Absent → log-only.
- Reuses `PKG`, `RPC` from `scripts/integration/config.js` for the poller.

## Files

- New: `scripts/indexer/notify.js`, `watcher.js`, `keeper.js`, `notify.test.js`, `watcher.test.js`
- Modified: `scripts/indexer/db.js` (notified table + helpers)
