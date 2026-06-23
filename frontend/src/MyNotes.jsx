import { useEffect, useState } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { getNotes, getOracle, postTx } from './api.js';
import { EXPLORER } from './config.js';
import './Leaderboard.css';
import './App.css'; // nl-status*/nl-statuspip* are defined here; import so MyNotes styling resolves even if rendered standalone

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
  const [msgKind, setMsgKind] = useState(/** @type {''|'ok'|'err'} */ (''));
  const [claiming, setClaiming] = useState(/** @type {string|null} */ (null));

  async function load() {
    setMsg('');
    setMsgKind('');
    try {
      // Normalize: indexer stores the full padded on-chain address; wallet form may be unpadded.
      setNotes(await getNotes(normalizeSuiAddress(account.address)));
    } catch (e) {
      setMsg(`Failed to load notes: ${e.message}`);
      setMsgKind('err');
    }
  }

  useEffect(() => { load(); }, [account.address]);

  async function claim(n) {
    if (claiming) return;
    setClaiming(n.note_id);
    setMsg('');
    setMsgKind('');
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

      setMsg(`Claimed ${EXPLORER}${digest}`);
      setMsgKind('ok');
      await load();
    } catch (e) {
      setMsg(`CLAIM FAILED: ${e.message}${e.code ? ` [${e.code}]` : ''}`);
      setMsgKind('err');
    } finally {
      setClaiming(null);
    }
  }

  const now = Date.now();
  return (
    <section className="nl-board" style={{ marginTop: 22 }}>
      <header className="nl-board__head">
        <h2 className="nl-board__title">
          <span className="nl-ico">
            <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11a9 4.2 0 0 1 18 0" />
              <path d="M3 12.4a9 4.6 0 0 0 18 0" />
              <circle cx="12" cy="12" r="2.4" />
            </svg>
          </span>
          My Notes
        </h2>
        <button className="nl-refresh" onClick={load} disabled={!!claiming}>Refresh</button>
      </header>

      {notes.length === 0 && <p className="nl-empty">No notes found.</p>}

      {notes.length > 0 && (
        <table className="nl-table">
          <thead>
            <tr>
              <th className="nl-th">Note</th>
              <th className="nl-th">Expiry</th>
              <th className="nl-th">Status</th>
              <th className="nl-th nl-th--num">Action</th>
            </tr>
          </thead>
          <tbody>
            {notes.map((n, i) => {
              const expired = Number(n.expiry_ts_ms) < now;
              const isClaiming = claiming === n.note_id;
              const state = n.settled ? 'settled' : expired ? 'claimable' : 'pending';
              return (
                <tr key={n.note_id} className="nl-row" style={{ '--i': i }}>
                  <td className="nl-td" title={n.note_id}>{n.note_id.slice(0, 12)}…</td>
                  <td className="nl-td">{new Date(Number(n.expiry_ts_ms)).toISOString().slice(0, 16).replace('T', ' ')}</td>
                  <td className="nl-td">
                    <span className={`nl-statuspip nl-statuspip--${state}`} />
                    {state === 'settled' ? 'Settled' : state === 'claimable' ? 'Claimable' : 'Pending'}
                  </td>
                  <td className="nl-td nl-td--num">
                    {state === 'claimable'
                      ? (
                        <button
                          className="nl-btn"
                          disabled={isClaiming || !!claiming}
                          onClick={() => claim(n)}
                          aria-busy={isClaiming}
                        >
                          {isClaiming ? 'Claiming…' : 'Claim'}
                        </button>
                      )
                      : <span style={{ color: 'var(--pearl-dim)' }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {msg && <pre className={`nl-status ${msgKind === 'ok' ? 'nl-status--ok' : 'nl-status--err'}`}>{msgKind === 'ok' ? '✓ ' : ''}{msg}</pre>}
    </section>
  );
}
