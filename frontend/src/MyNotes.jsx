import { useEffect, useState, Fragment } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { getNotes, getOracle, getNoteParams, postTx } from './api.js';
import { computePayoffCurve } from './payoff.js';
import PayoffChart from './PayoffChart.jsx';
import { EXPLORER, EXPLORER_OBJ } from './config.js';

const DUSDC = 1_000_000; // 6 decimals
// Oracle is keyed by the UNDERLYING price asset (registry::OracleCreated.underlying_asset),
// NOT the product type. n.strategy decodes to "range_accrual" (the product), so passing it as
// the oracle asset fails resolveOracle ("no oracle for asset=range_accrual"). Underlying is BTC
// for every note in this hackathon build.
const UNDERLYING = 'BTC';
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
  const [claimUrl, setClaimUrl] = useState('');
  const [claiming, setClaiming] = useState(/** @type {string|null} */ (null));
  const [expanded, setExpanded] = useState(null);     // note_id currently open
  const [paramsCache, setParamsCache] = useState({}); // note_id -> { curve, forward, settlementPrice } | { error }

  async function toggleExpand(n) {
    if (expanded === n.note_id) { setExpanded(null); return; }
    setExpanded(n.note_id);
    if (paramsCache[n.note_id]) return;
    try {
      const { params, forward, settlementPrice, leftover } = await getNoteParams(n.note_id, UNDERLYING, n.expiry_ts_ms);
      const curve = computePayoffCurve({
        lower: params.lower, upper: params.upper, step: params.strike_step, qtyPerLeg: params.qty_per_leg,
        leftover: leftover ?? 0,
      });
      setParamsCache((c) => ({ ...c, [n.note_id]: {
        curve, forward: forward != null ? Number(forward) : undefined,
        settlementPrice: settlementPrice != null ? Number(settlementPrice) : null } }));
    } catch (e) {
      setParamsCache((c) => ({ ...c, [n.note_id]: { error: e.message } }));
    }
  }

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
    setClaimUrl('');
    try {
      // oracle_id not stored in indexer; resolve from (underlying asset, expiry) at claim time.
      const oracle = await getOracle(UNDERLYING, n.expiry_ts_ms);

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

      setMsg('Claimed');
      setClaimUrl(`${EXPLORER}${digest}`);
      setMsgKind('ok');
      // Claim deletes the soulbound note on-chain (tx already final — signExec resolves
      // post-execution). Optimistically drop it locally instead of re-querying: the off-chain
      // indexer lags the chain, so an immediate load() reads stale /notes and resurrects the
      // just-claimed row as claimable. Refresh / useEffect reconciles once the indexer catches up.
      setNotes((prev) => prev.filter((x) => x.note_id !== n.note_id));
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
                <Fragment key={n.note_id}>
                  <tr className={`nl-row nl-row--expandable`} style={{ '--i': i }} onClick={() => toggleExpand(n)}>
                    <td className="nl-td" title={n.note_id}>
                      <a className="nl-hashlink" href={`${EXPLORER_OBJ}${n.note_id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{n.note_id.slice(0, 12)}…</a>
                    </td>
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
                            onClick={(e) => { e.stopPropagation(); claim(n); }}
                            aria-busy={isClaiming}
                          >
                            {isClaiming ? 'Claiming…' : 'Claim'}
                          </button>
                        )
                        : state === 'settled' && n.payout != null
                          ? (() => {
                              const pnl = (Number(n.payout) - Number(n.notional)) / DUSDC;
                              return <span className={`nl-pnl ${pnl >= 0 ? 'is-pos' : 'is-neg'}`} title="Realized PnL (payout − notional)">{pnl > 0 ? '+' : ''}{pnl.toFixed(2)} dUSDC</span>;
                            })()
                          : <span style={{ color: 'var(--pearl-dim)' }}>—</span>}
                    </td>
                  </tr>
                  {expanded === n.note_id && (
                    <tr className="nl-detailrow">
                      <td colSpan={4} className="nl-detail">
                        {paramsCache[n.note_id]?.error
                          ? <p className="nl-error">{paramsCache[n.note_id].error}</p>
                          : paramsCache[n.note_id]?.curve
                            ? <PayoffChart curve={paramsCache[n.note_id].curve}
                                forward={paramsCache[n.note_id].forward}
                                settlementPrice={paramsCache[n.note_id].settlementPrice} size="full" />
                            : <p className="nl-note">Loading payoff…</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {msg && (
        <pre className={`nl-status ${msgKind === 'ok' ? 'nl-status--ok' : 'nl-status--err'}`}>
          {msgKind === 'ok' ? '✓ ' : ''}{msg}
          {claimUrl && <>{'\n'}<a className="nl-txlink" href={claimUrl} target="_blank" rel="noreferrer">{claimUrl} ↗</a></>}
        </pre>
      )}
    </section>
  );
}
