import { useState } from 'react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { runMint } from './mint.js';
import { EXPLORER } from './config.js';
import MyNotes from './MyNotes.jsx';
import Leaderboard from './Leaderboard.jsx';
import Sea from './Sea.jsx';
import './App.css';

export default function App() {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState(/** @type {''|'ok'|'err'} */ (''));
  const [busy, setBusy] = useState(false);

  // Shared signExec: wraps dAppKit.signAndExecuteTransaction; accepts a Transaction object.
  const signExec = (tx) => dAppKit.signAndExecuteTransaction({ transaction: tx });

  async function onMint() {
    if (!account) return;
    setBusy(true);
    setStatus('');
    setStatusKind('');
    try {
      // Sender-assert: never sign a tx built for a different address (spec §5).
      const sender = account.address;

      const out = await runMint({ signExec, sender });
      setStatus(`Minted OK — ${EXPLORER}${out.mintDigest}`);
      setStatusKind('ok');
    } catch (e) {
      // Fail loud: surface backend {error, code} verbatim; never hide PTB1-landed-but-PTB2-failed.
      setStatus(`FAILED: ${e.message}${e.code ? ` [${e.code}]` : ''}`);
      setStatusKind('err');
    } finally {
      setBusy(false);
    }
  }

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

      {account && (
        <>
          <section className="nl-card nl-section" style={{ '--i': 2 }}>
            <div className="nl-card__head">
              <h2 className="nl-card__title">
                <span className="nl-ico">
                  <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 9c2-2.6 4-2.6 6 0s4 2.6 6 0 4-2.6 6 0" />
                    <path d="M2 15c2-2.6 4-2.6 6 0s4 2.6 6 0 4-2.6 6 0" />
                  </svg>
                </span>
                Issue a Note
              </h2>
            </div>
            <div className="nl-pill">
              <span className="nl-pill__dot" />
              {account.address.slice(0, 10)}…{account.address.slice(-6)}
            </div>
            <div>
              <button
                className="nl-btn nl-btn--primary"
                disabled={busy}
                onClick={onMint}
                aria-busy={busy}
              >
                <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3.5c.4 3.8 1.7 5.1 5.5 5.5-3.8.4-5.1 1.7-5.5 5.5-.4-3.8-1.7-5.1-5.5-5.5 3.8-.4 5.1-1.7 5.5-5.5Z" />
                  <path d="M18.5 14.5c.2 1.6.7 2.1 2.3 2.3-1.6.2-2.1.7-2.3 2.3-.2-1.6-.7-2.1-2.3-2.3 1.6-.2 2.1-.7 2.3-2.3Z" />
                </svg>
                {busy ? 'Minting…' : 'Mint Range Note'}
              </button>
            </div>
            {status && (
              <pre className={`nl-status ${statusKind === 'ok' ? 'nl-status--ok' : 'nl-status--err'}`}>
                {statusKind === 'ok' ? '✓ ' : ''}{status}
              </pre>
            )}
          </section>

          <div className="nl-section" style={{ '--i': 3 }}>
            <MyNotes account={account} signExec={signExec} />
          </div>
        </>
      )}
    </div>
  );
}
