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
