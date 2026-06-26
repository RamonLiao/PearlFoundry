import './theme.css';
import './App.css'; // global so the Landing route ('/') gets .nl-section, nl-reveal, .sr-only
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import { dAppKit } from './dapp-kit.js';
import App from './App.jsx';
import Landing from './Landing.jsx';

// Provider order: DAppKitProvider is OUTERMOST so every route shares one wallet
// context (App.jsx's useCurrentAccount etc. must run inside DAppKitProvider).
const root = createRoot(document.getElementById('root'));
flushSync(() => {
  root.render(
    <DAppKitProvider dAppKit={dAppKit}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/app" element={<App />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </DAppKitProvider>,
  );
});
document.getElementById('nl-boot')?.remove();
