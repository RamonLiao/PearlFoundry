import { useEffect, useState } from 'react';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { getLeaderboard } from './api.js';
import { shortId } from './format.js';
import Mascot from './Mascot.jsx';
import './Leaderboard.css';

const DUSDC = 1_000_000; // 6 decimals

/**
 * Leaderboard — public issuer ranking by realized PnL.
 * Backend (`GET /leaderboard`) already sorts realized_pnl DESC, so the array
 * index IS the rank; no client-side re-sort.
 *
 * @param {{ account: { address: string } | null }} props
 */
export default function Leaderboard({ account }) {
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setMsg('');
    try {
      setRows(await getLeaderboard());
    } catch (e) {
      // Fail loud: surface backend {error, code} verbatim.
      setMsg(`Failed to load leaderboard: ${e.message}${e.code ? ` [${e.code}]` : ''}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Normalize BOTH sides: indexer stores full padded on-chain form; wallet form varies.
  const me = account ? normalizeSuiAddress(account.address) : null;

  return (
    <section className="nl-board">
      <header className="nl-board__head">
        <h2 className="nl-board__title">
          <span className="nl-ico">
            <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 4h10v3.5a5 5 0 0 1-10 0Z" />
              <path d="M7 5H4.2v1.8a3 3 0 0 0 3 3" />
              <path d="M17 5h2.8v1.8a3 3 0 0 1-3 3" />
              <path d="M12 12.5v3" /><path d="M8.5 20h7" /><path d="M10 20l.6-4.5M14 20l-.6-4.5" />
            </svg>
          </span>
          Nacre Ledger
        </h2>
        <button className="nl-refresh" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      {msg && <pre className="nl-error">{msg}</pre>}
      {rows.length === 0 && !msg && !loading && (
        <figure className="nl-empty nl-empty--illustrated">
          <Mascot variant={3} treatment="duotone" size={72} />
          <figcaption>
            <p className="nl-empty-h">Be the first on the Ledger</p>
            <p className="nl-empty-p">No settled notes yet — issuers appear here once their notes settle.</p>
          </figcaption>
        </figure>
      )}

      {loading && rows.length === 0 && (
        <table className="nl-table" aria-hidden="true">
          <thead>
            <tr>
              <th className="nl-th nl-th--rank">Rank</th>
              <th className="nl-th">Issuer</th>
              <th className="nl-th nl-th--num">Realized PnL</th>
              <th className="nl-th nl-th--num">Win Rate</th>
              <th className="nl-th nl-th--num">Notes</th>
              <th className="nl-th nl-th--num">Perf Fee</th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3].map((i) => (
              <tr className="nl-row" key={i} style={{ animation: 'none', opacity: 1 }}>
                <td className="nl-td nl-td--rank"><span className="nl-skel" style={{ width: 24 }} /></td>
                <td className="nl-td"><span className="nl-skel" style={{ width: '60%' }} /></td>
                <td className="nl-td nl-td--num"><span className="nl-skel" style={{ width: '50%', marginLeft: 'auto' }} /></td>
                <td className="nl-td nl-td--num"><span className="nl-skel" style={{ width: '45%', marginLeft: 'auto' }} /></td>
                <td className="nl-td nl-td--num"><span className="nl-skel" style={{ width: '30%', marginLeft: 'auto' }} /></td>
                <td className="nl-td nl-td--num"><span className="nl-skel" style={{ width: '50%', marginLeft: 'auto' }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rows.length > 0 && (
        <table className="nl-table">
          <thead>
            <tr>
              <th className="nl-th nl-th--rank">Rank</th>
              <th className="nl-th">Issuer</th>
              <th className="nl-th nl-th--num">Realized PnL</th>
              <th className="nl-th nl-th--num">Win Rate</th>
              <th className="nl-th nl-th--num">Notes</th>
              <th className="nl-th nl-th--num">Perf Fee</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isYou = me != null && r.issuer != null && normalizeSuiAddress(r.issuer) === me;
              const pnl = Number(r.realized_pnl) / DUSDC;
              const winPct = Number(r.win_rate) * 100;
              const perf = Number(r.total_perf_fee) / DUSDC;
              return (
                <tr key={r.issuer} className={`nl-row${isYou ? ' nl-row--you' : ''}`} style={{ '--i': i }}>
                  <td className="nl-td nl-td--rank">
                    {i === 0 && <span className="nl-pip nl-pip--gold" />}
                    {i > 0 && i < 3 && <span className="nl-pip nl-pip--brass" />}
                    <span className="nl-rank-n">{i + 1}</span>
                  </td>
                  <td className="nl-td nl-issuer" title={r.issuer}>
                    {shortId(r.issuer, 8, 4)}
                    {isYou && <span className="nl-you">YOU</span>}
                  </td>
                  <td className={`nl-td nl-td--num nl-pnl ${pnl >= 0 ? 'is-pos' : 'is-neg'}`}>
                    {pnl > 0 ? '+' : ''}{pnl.toFixed(2)} dUSDC
                  </td>
                  <td className="nl-td nl-td--num">
                    <span className="nl-win">
                      {winPct.toFixed(1)}%
                      <span className="nl-meter">
                        <span className="nl-meter__fill" style={{ width: `${Math.max(0, Math.min(100, winPct))}%` }} />
                      </span>
                    </span>
                  </td>
                  <td className="nl-td nl-td--num">{r.note_count}</td>
                  <td className="nl-td nl-td--num">{perf.toFixed(2)} dUSDC</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
