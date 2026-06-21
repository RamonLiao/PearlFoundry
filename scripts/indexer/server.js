import http from 'node:http';
import { leaderboard, listNotes, pendingSettle, feeStats } from './queries.js';
import { hexToUtf8, hexToBase64 } from './decode.js';

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const decodeNote = (r) => ({ ...r,
  strategy: hexToUtf8(r.strategy ?? ''), walrus_blob_id: hexToBase64(r.walrus_blob_id ?? '') });

export function createServer(db) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      if (p === '/leaderboard') return json(res, 200, leaderboard(db));
      if (p === '/notes') return json(res, 200, listNotes(db, {
        issuer: url.searchParams.get('issuer') ?? undefined,
        isPublic: url.searchParams.has('public') ? url.searchParams.get('public') === '1' : undefined,
      }).map(decodeNote));
      if (p === '/pending-settle') return json(res, 200, pendingSettle(db, Date.now()).map(decodeNote));
      if (p === '/fees') return json(res, 200, feeStats(db));
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  });
}

// CLI: node server.js <dbPath> <port>
if (import.meta.url === `file://${process.argv[1]}`) {
  const { openDb } = await import('./db.js');
  const db = openDb(process.argv[2] ?? 'indexer.db');
  const port = Number(process.argv[3] ?? 8787);
  createServer(db).listen(port, () => console.log(`[indexer] serving on :${port}`));
}
