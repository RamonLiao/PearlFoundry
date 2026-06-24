import { useState, useEffect } from 'react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { useCurrentAccount, useDAppKit, useCurrentClient } from '@mysten/dapp-kit-react';
import { prepareMint, finalizeMint, quoteMint } from './mint.js';
import { isValidSuiObjectId } from '@mysten/sui/utils';
import { readPending, savePending, clearPending } from './pendingMint.js';
import { computePayoffCurve } from './payoff.js';
import PayoffChart from './PayoffChart.jsx';
import MetricRail from './MetricRail.jsx';
import { DEMO_CURVE, DEMO_FORWARD } from './demoCurve.js';
import { EXPLORER } from './config.js';
import { shortId } from './format.js';
import MyNotes from './MyNotes.jsx';
import Leaderboard from './Leaderboard.jsx';
import Sea from './Sea.jsx';
import './App.css';

export default function App() {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const client = useCurrentClient();
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState(/** @type {''|'ok'|'err'} */ (''));
  const [busy, setBusy] = useState(false);

  const [mintPhase, setMintPhase] = useState('idle'); // idle|preparing|confirm|minting|done|cancelled|error
  const [preview, setPreview] = useState(null);       // { mgr, tx, ladder, forward, qtyPerLeg, expiry, notional }
  const [mintErr, setMintErr] = useState(null);
  const [txUrl, setTxUrl] = useState('');
  const [pending, setPending] = useState(null); // orphaned-manager record from a prior refresh

  // Shared signExec: wraps dAppKit.signAndExecuteTransaction; accepts a Transaction object.
  const signExec = (tx) => dAppKit.signAndExecuteTransaction({ transaction: tx });

  // On connect / account switch, surface any manager left pending by a refresh between PTB1 and PTB2.
  useEffect(() => {
    setPending(account ? readPending(account.address) : null);
  }, [account?.address]);

  async function onIssue() {
    setMintErr(null); setMintPhase('preparing');
    setStatus(''); setStatusKind(''); setTxUrl('');
    try {
      // Persist the manager id the instant PTB1 lands so a refresh mid-quote can resume it.
      const p = await prepareMint({ signExec, sender: account.address, client,
        onManager: (mgr) => savePending(account.address, mgr) });
      savePending(account.address, p.mgr, p.expiry); // refresh ts + record expiry now that we have it
      setPending(null);
      setPreview(p); setMintPhase('confirm');
    } catch (e) { setMintErr(e.message); setMintPhase('error'); }
  }

  // Resume a pending manager after a refresh: re-/quote (the cached ladder would be stale) then
  // drop straight into the confirm preview. No new manager is created.
  async function onResume() {
    // localStorage is user-tamperable; reject a malformed id before it ever reaches /quote.
    // (Authoritative mgr→owner / mintable-state checks remain the backend's job.)
    if (!isValidSuiObjectId(pending.mgr)) {
      clearPending(account.address); setPending(null);
      setMintErr('Stored manager id is malformed — discarded. Please mint again.');
      setMintPhase('error');
      return;
    }
    setMintErr(null); setMintPhase('preparing');
    setStatus(''); setStatusKind(''); setTxUrl('');
    try {
      const p = await quoteMint({ sender: account.address, mgr: pending.mgr });
      setPending(null);
      setPreview(p); setMintPhase('confirm');
    } catch (e) { setMintErr(e.message); setMintPhase('error'); }
  }

  function onDiscardPending() {
    clearPending(account.address);
    setPending(null);
  }

  async function onConfirmMint() {
    setMintPhase('minting');
    try {
      const out = await finalizeMint({ signExec, tx: preview.tx, mgr: preview.mgr });
      clearPending(account.address); // minted — manager is consumed, no longer pending
      setStatus('Minted OK');
      setTxUrl(`${EXPLORER}${out.mintDigest}`);
      setStatusKind('ok');
      setMintPhase('done');
    } catch (e) { setMintErr(e.message); setMintPhase('error'); }
  }

  function onCancelMint() { setMintPhase('cancelled'); }

  return (
    <div className="nl-app">
      <Sea />
      <header className="nl-masthead nl-section" style={{ '--i': 0 }}>
        <img className="nl-mast-logo" src="/logo-mark.png" alt="" />
        <div className="nl-mast-titles">
          <span className="nl-eyebrow">
            <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21C5 16 3 10.5 3 8a4.2 3.4 0 0 1 18 0c0 2.5-2 8-9 13Z" />
              <path d="M12 21V8.5M12 21 7.4 10M12 21 16.6 10M12 21 4.6 12.5M12 21 19.4 12.5" />
            </svg>
            Testnet · DeepBook Predict
          </span>
          <h1 className="nl-mast-title">Pearl<em>Foundry</em></h1>
        </div>
        <div className="nl-connect"><ConnectButton /></div>
      </header>
      <div className="nl-mascot nl-section" style={{ '--i': 0 }}>
        <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="14.5" r="3.2" /><circle cx="15.5" cy="9.5" r="2.2" /><circle cx="17.5" cy="15.5" r="1.3" />
        </svg>
        pearl bobs · bubbles rise from the seabed · claimable notes glow
      </div>

      <div className="nl-section" style={{ '--i': 1 }}>
        <Leaderboard account={account} />
      </div>

      {/* HERO — chart-as-centerpiece. Renders for everyone (idle explainer); the right column
          becomes the live metric rail once a quote exists. */}
      <section className="nl-hero nl-section" style={{ '--i': 2 }}>
        {mintPhase === 'confirm' && preview ? (() => {
          const curve = computePayoffCurve({
            lower: preview.ladder.lower, upper: preview.ladder.upper,
            step: preview.ladder.step, qtyPerLeg: preview.qtyPerLeg,
            leftover: preview.leftover ?? 0,
          });
          const heroKey = `${preview.ladder.lower}-${preview.ladder.upper}-${preview.ladder.step}`;
          return (
            <>
              <p className="nl-hero-cap">Payoff preview — you&apos;re about to mint</p>
              <div className="nl-hero-grid">
                <div className="nl-hero-chart">
                  <PayoffChart key={heroKey} curve={curve} forward={Number(preview.forward)} size="hero" />
                </div>
                <div className="nl-hero-side">
                  <MetricRail curve={curve} notional={preview.notional} expiry={preview.expiry} />
                  <div className="nl-preview-actions">
                    <button className="nl-btn" onClick={onCancelMint}>Cancel</button>
                    <button className="nl-btn nl-btn--primary" disabled={mintPhase === 'minting'} onClick={onConfirmMint}>Confirm Mint</button>
                  </div>
                </div>
              </div>
            </>
          );
        })() : (
          <div className="nl-hero-grid">
            <div className="nl-hero-chart">
              <PayoffChart key="demo" curve={DEMO_CURVE} forward={DEMO_FORWARD} size="hero" illustrative />
            </div>
            <div className="nl-hero-side">
              <h2 className="nl-card__title">
                <span className="nl-ico">
                  <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 9c2-2.6 4-2.6 6 0s4 2.6 6 0 4-2.6 6 0" />
                    <path d="M2 15c2-2.6 4-2.6 6 0s4 2.6 6 0 4-2.6 6 0" />
                  </svg>
                </span>
                Issue a Range Note
              </h2>
              <p className="nl-hero-explain">
                Below the band you reclaim a <b>floor</b>. Each strike the price clears adds a
                step. Clear the whole band and you collect the <b>max payout</b>.
              </p>
              <div className="nl-concepts">
                <div className="nl-concept"><svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 14l5-5 4 4 7-7" strokeLinecap="round" strokeLinejoin="round"/></svg><span className="nl-concept-term">Direction</span><span className="nl-concept-val">Long · up-ladder</span></div>
                <div className="nl-concept"><svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 18h18M5 18V9m4 9V6m4 12v-7m4 7V8" strokeLinecap="round"/></svg><span className="nl-concept-term">Floor</span><span className="nl-concept-val">leftover premium</span></div>
                <div className="nl-concept"><svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2" strokeLinecap="round" strokeLinejoin="round"/></svg><span className="nl-concept-term">Settles</span><span className="nl-concept-val">self · soulbound</span></div>
              </div>
              {account ? (
                <div className="nl-issue-row">
                  <div className="nl-pill"><span className="nl-pill__dot" />{account.address.slice(0, 10)}…{account.address.slice(-6)}</div>
                  <button className="nl-btn nl-btn--primary"
                    disabled={busy || !!pending || mintPhase === 'preparing' || mintPhase === 'minting'}
                    onClick={onIssue} aria-busy={mintPhase === 'preparing'}
                    title={pending ? 'Resolve the pending mint below first' : undefined}>
                    <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3.5c.4 3.8 1.7 5.1 5.5 5.5-3.8.4-5.1 1.7-5.5 5.5-.4-3.8-1.7-5.1-5.5-5.5 3.8-.4 5.1-1.7 5.5-5.5Z" />
                    </svg>
                    {mintPhase === 'preparing'
                      ? (<><span className="nl-spinner" aria-hidden="true"><i /><i /><i /></span>Preparing…</>)
                      : 'Mint Range Note'}
                  </button>
                </div>
              ) : (
                <button className="nl-btn nl-btn--primary" disabled title="Connect your wallet in the header to mint">Connect to mint</button>
              )}
            </div>
          </div>
        )}

        {/* resume / status / error feedback — unchanged logic, now inside the hero section */}
        {account && pending && mintPhase !== 'confirm' && mintPhase !== 'preparing' && mintPhase !== 'minting' && (
          <div className="nl-resume">
            <p className="nl-note">A manager from an earlier session is waiting (<code>{shortId(pending.mgr)}</code>) — its mint never finished. Resume to re-quote and complete it, or discard to ignore it.</p>
            <div className="nl-preview-actions">
              <button className="nl-btn" onClick={onDiscardPending}>Discard</button>
              <button className="nl-btn nl-btn--primary" onClick={onResume}>Resume mint</button>
            </div>
          </div>
        )}
        {mintPhase === 'cancelled' && (
          <p className="nl-note">Manager kept on-chain (<code>{shortId(preview?.mgr)}</code>) — re-confirm anytime.
            <button className="nl-btn" disabled={mintPhase === 'minting'} onClick={onConfirmMint}>Confirm Mint</button></p>
        )}
        {mintPhase === 'error' && <p className="nl-error">{mintErr}</p>}
        {mintPhase === 'minting' && (
          <p className="nl-note"><span className="nl-spinner" aria-hidden="true"><i /><i /><i /></span>Minting…</p>
        )}
        {status && (
          <pre className={`nl-status ${statusKind === 'ok' ? 'nl-status--ok' : 'nl-status--err'}`}>
            {statusKind === 'ok' && (
              <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}><path d="M4 12l5 5L20 6" /></svg>
            )}{status}
            {txUrl && <>{'\n'}<a className="nl-txlink" href={txUrl} target="_blank" rel="noreferrer" aria-label="View transaction on explorer (opens in new tab)">{txUrl} <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg></a></>}
          </pre>
        )}
      </section>

      {account && (
        <div className="nl-section" style={{ '--i': 3 }}>
          <MyNotes account={account} signExec={signExec} />
        </div>
      )}
    </div>
  );
}
