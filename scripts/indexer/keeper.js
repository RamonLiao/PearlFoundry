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
