import { SuiClient } from '@mysten/sui/client';
import { getCursor, ingestPage } from './db.js';
import { normalize } from './events.js';

const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }, { once: true });
});

export async function drainOnce({ client, db, pkg }) {
  const cursorRow = getCursor(db);
  let cursor = cursorRow ? { txDigest: cursorRow.tx_digest, eventSeq: cursorRow.event_seq } : null;
  let total = 0;
  for (;;) {
    const page = await client.queryEvents({
      // MoveEventModule = filter by the event TYPE's defining module (events).
      // NOT MoveModule, which filters by the tx's entry module (note_factory) and returns 0.
      // Verified live on testnet 2026-06-21 (calibrate.js).
      query: { MoveEventModule: { package: pkg, module: 'events' } },
      cursor, order: 'ascending',
    });
    const rows = page.data.map(normalize).filter((x) => x != null);
    total += ingestPage(db, rows, page.nextCursor);
    if (page.nextCursor != null) cursor = page.nextCursor;
    if (!page.hasNextPage) break;
  }
  return total;
}

export async function runPoller({ client, db, pkg, pollMs = 3000, log = console.log, maxFails = 3, signal }) {
  let fails = 0;
  while (!signal?.aborted) {
    try {
      const n = await drainOnce({ client, db, pkg });
      if (n) log(`[indexer] ingested ${n} events`);
      fails = 0;
      await sleep(pollMs, signal);
    } catch (e) {
      if (signal?.aborted) return;
      fails += 1;
      log(`[indexer] poll failed (${fails}/${maxFails}): ${e.message}`);
      if (fails >= maxFails) throw new Error(`indexer stopped after ${maxFails} consecutive failures`);
      await sleep(pollMs * 2 ** fails, signal);
    }
  }
}

// CLI entry: node ingest.js <dbPath>
if (import.meta.url === `file://${process.argv[1]}`) {
  const { PKG, RPC } = await import('../integration/config.js');
  const { openDb } = await import('./db.js');
  const db = openDb(process.argv[2] ?? 'indexer.db');
  const client = new SuiClient({ url: RPC });
  await runPoller({ client, db, pkg: PKG });
}
