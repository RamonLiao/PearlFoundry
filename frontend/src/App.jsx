import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { useCurrentAccount } from '@mysten/dapp-kit-react';

export default function App() {
  const account = useCurrentAccount();
  return (
    <div style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'system-ui' }}>
      <h1>Structured Note Factory</h1>
      <ConnectButton />
      {account && <p>Connected: {account.address}</p>}
    </div>
  );
}
