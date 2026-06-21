import { useState } from 'react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { runMint } from './mint.js';
import { EXPLORER, DEMO_EXPIRY } from './config.js';
import MyNotes from './MyNotes.jsx';

export default function App() {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  // Shared signExec: wraps dAppKit.signAndExecuteTransaction; accepts a Transaction object.
  const signExec = (tx) => dAppKit.signAndExecuteTransaction({ transaction: tx });

  async function onMint() {
    if (!account) return;
    setBusy(true);
    setStatus('');
    try {
      // Sender-assert: never sign a tx built for a different address (spec §5).
      const sender = account.address;

      const out = await runMint({ signExec, sender, expiry: DEMO_EXPIRY });
      setStatus(`Minted OK — ${EXPLORER}${out.mintDigest}`);
    } catch (e) {
      // Fail loud: surface backend {error, code} verbatim; never hide PTB1-landed-but-PTB2-failed.
      setStatus(`FAILED: ${e.message}${e.code ? ` [${e.code}]` : ''}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'system-ui' }}>
      <h1>Structured Note Factory</h1>
      <ConnectButton />
      {account && (
        <>
          <p>Connected: {account.address}</p>
          <button disabled={busy} onClick={onMint} aria-busy={busy}>
            {busy ? 'Minting…' : 'Mint Range Note'}
          </button>
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>{status}</pre>
          <MyNotes account={account} signExec={signExec} />
        </>
      )}
    </div>
  );
}
