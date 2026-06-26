// Single source of landing copy. Pure data — no logic. Text condensed from
// docs/demo-script.md (Problem / Solution / Roadmap) and docs/product-economics.md
// (hero sub). No new claims; roadmap items are roadmap, never "live".

export const HERO = {
  eyebrow: 'Testnet · DeepBook Predict',
  headline: 'One-click structured notes, native to DeepBook.',
  sub: 'Deposit dUSDC and take a defined bullish bet that BTC climbs into a strike band by expiry. The higher it settles, the more you get back — payout can exceed your deposit. Stay below the band and you keep the unspent premium instead of going to zero.',
};

export const PROBLEMS = [
  { num: '01', title: 'Retail is priced out', body: 'Bank structured notes demand $50–200k minimums, lock-ups and heavy KYC.' },
  { num: '02', title: 'DeFi v1 collapsed', body: 'Ribbon and Cega broke on oracle manipulation and the absence of a real volatility surface.' },
  { num: '03', title: 'No audit trail', body: 'Neither side gives you an immutable record of the terms you actually bought.' },
];

export const STEPS = [
  { key: 'mint', title: 'Mint', body: 'One atomic PTB bundles a multi-leg DeepBook Predict ladder, sized to your notional — no leg-risk, no slippage. Every leg is priced against DeepBook\'s on-chain SVI vol surface.' },
  { key: 'settle', title: 'Settle', body: 'The note settles itself on-chain. A notify-only watcher flags maturity — a keeper structurally cannot claim for you, because the note is an owned soulbound object.' },
  { key: 'claim', title: 'Claim', body: 'You sign once: settle each leg, withdraw the payout, take the performance fee, and burn the note — atomically. A tamper-proof Move-object prospectus, closed in one transaction.' },
];

// Static, illustrative — NOT a live leaderboard fetch (D1). Marked illustrative in the UI.
export const LEDGER_ROWS = [
  { rank: 1, issuer: '0x9d56…fda4', pnl: '+1.03', win: '100%' },
  { rank: 2, issuer: '0xbdec…1f', pnl: '+0.42', win: '67%', you: true },
  { rank: 3, issuer: '0x1509…bc4c', pnl: '+0.18', win: '50%' },
];

export const ROADMAP = [
  { title: 'More templates', body: 'Capped-Upside and Principal-Protected notes, reusing the same atomic-PTB factory.' },
  { title: 'Walrus term attestation', body: 'An immutable PDF term sheet + backtest CSV pinned to Walrus, Blob ID embedded in the note.' },
  { title: 'Gasless claims', body: 'A sponsored-transaction gas station so holders can claim without ever holding SUI.' },
];

export const FOOTER = { brand: 'PearlFoundry · Sui Overflow 2026 · Track 2', tag: 'Testnet' };
