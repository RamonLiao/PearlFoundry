import React from 'react';
import { createRoot } from 'react-dom/client';
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import { dAppKit } from './dapp-kit.js';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <DAppKitProvider dAppKit={dAppKit}>
    <App />
  </DAppKitProvider>,
);
