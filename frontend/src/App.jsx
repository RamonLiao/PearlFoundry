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
          <span className="nl-eyebrow">Testnet · DeepBook Predict</span>
          <h1 className="nl-mast-title">Structured Note Factory</h1>
        </div>
        <div className="nl-connect"><ConnectButton /></div>
      </header>

      <div className="nl-section" style={{ '--i': 1 }}>
        <Leaderboard account={account} />
      </div>

      {account && (
        <>
          <section className="nl-card nl-section" style={{ '--i': 2 }}>
            <div className="nl-card__head">
              <h2 className="nl-card__title">Issue a Note</h2>
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
