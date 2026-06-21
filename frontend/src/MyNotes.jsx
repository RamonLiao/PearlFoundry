import { useEffect, useState } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import { getNotes, getOracle, postTx } from './api.js';
import { EXPLORER } from './config.js';

/**
 * MyNotes — lists the connected address's notes and allows claiming expired ones.
 *
 * Real column names from scripts/indexer/db.js + queries.js listNotes:
 *   note_id, manager_id, expiry_ts_ms, settled (LEFT JOIN settlements), strategy (hex→utf8)
 *
 * oracle_id is NOT stored in the notes table. It is resolved at claim time via
 * GET /oracle?asset=<strategy>&expiry=<expiry_ts_ms> (added to server.js).
 *
 * @param {{ account: { address: string }, signExec: (tx: Transaction) => Promise<any> }} props
 */
export default function MyNotes({ account, signExec }) {
  const [notes, setNotes] = useState([]);
  const [msg, setMsg] = useState('');
  const [claiming, setClaiming] = useState(/** @type {string|null} */ (null));

  async function load() {
    setMsg('');
    try {
      setNotes(await getNotes(account.address));
    } catch (e) {
      setMsg(`Failed to load notes: ${e.message}`);
    }
  }

  useEffect(() => { load(); }, [account.address]);

  async function claim(n) {
    if (claiming) return;
    setClaiming(n.note_id);
    setMsg('');
    try {
      // oracle_id not stored in indexer; resolve from (asset, expiry) at claim time.
      const asset = n.strategy || 'BTC';
      const oracle = await getOracle(asset, n.expiry_ts_ms);

      const { tx: txJson } = await postTx('/claim-tx', {
        sender: account.address,
        note: n.note_id,
        mgr: n.manager_id,
        oracle,
      });

      const r = await signExec(Transaction.from(txJson));

      if (r.$kind === 'FailedTransaction') {
        const err = r.FailedTransaction?.effects?.status?.error;
        throw new Error(`Claim failed on-chain: ${err?.message ?? JSON.stringify(err)}`);
      }

      const digest = r.Transaction?.digest;
      if (!digest) throw new Error('Claim returned no digest — status unknown, treat as NOT completed');

      setMsg(`Claimed ✓ ${EXPLORER}${digest}`);
      await load();
    } catch (e) {
      setMsg(`CLAIM FAILED: ${e.message}${e.code ? ` [${e.code}]` : ''}`);
    } finally {
      setClaiming(null);
    }
  }

  const now = Date.now();
  return (
    <div style={{ marginTop: 24 }}>
      <h2>My Notes</h2>
      <button onClick={load} disabled={!!claiming}>Refresh</button>
      {notes.length === 0 && <p>No notes found.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {notes.map((n) => {
          const expired = Number(n.expiry_ts_ms) < now;
          const isClaiming = claiming === n.note_id;
          return (
            <li key={n.note_id} style={{ margin: '8px 0', fontFamily: 'monospace' }}>
              <span title={n.note_id}>{n.note_id.slice(0, 12)}…</span>
              {' · expiry '}
              {new Date(Number(n.expiry_ts_ms)).toISOString()}
              {n.settled
                ? <span> · settled</span>
                : expired
                  ? (
                    <button
                      style={{ marginLeft: 8 }}
                      disabled={isClaiming || !!claiming}
                      onClick={() => claim(n)}
                      aria-busy={isClaiming}
                    >
                      {isClaiming ? 'Claiming…' : 'Claim'}
                    </button>
                  )
                  : <span> · not yet expired</span>}
            </li>
          );
        })}
      </ul>
      {msg && <pre style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{msg}</pre>}
    </div>
  );
}
