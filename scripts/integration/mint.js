// Build the mint PTB (mint_begin -> mint_add_expiry x1 -> mint_finalize).
// Usage: node mint.js <dryrun|bytes>
//   env: MGR, ORACLE, DUSDC_COIN, NOTIONAL(optional), LOWER, UPPER, STEP, EXPIRY_TOTAL
import { SuiClient } from '@mysten/sui/client';
import { RPC, ADDR } from './config.js';
import { buildMintTx } from './txbuild.js';

const mode = process.argv[2] || 'dryrun';
const E = process.env;
const MGR = E.MGR, ORACLE = E.ORACLE, DUSDC_COIN = E.DUSDC_COIN;
const NOTIONAL = BigInt(E.NOTIONAL || '10000000');     // 10 dUSDC
const LOWER = BigInt(E.LOWER), UPPER = BigInt(E.UPPER), STEP = BigInt(E.STEP);
const EXPIRY_TOTAL = Number(E.EXPIRY_TOTAL || '1');
if (!MGR || !ORACLE || !DUSDC_COIN || !E.LOWER) { console.error('missing env'); process.exit(1); }

const client = new SuiClient({ url: RPC });

const tx = buildMintTx({ sender: ADDR, mgr: MGR, oracle: ORACLE, dusdcCoin: DUSDC_COIN,
  notional: NOTIONAL, lower: LOWER, upper: UPPER, step: STEP, expiryTotal: EXPIRY_TOTAL });
tx.setGasBudget(2_000_000_000); // 2 SUI: 16-leg ladder ≈0.55 SUI; gas scales steeply per leg

const txBytes = await tx.build({ client });
const b64 = Buffer.from(txBytes).toString('base64');

// Staleness guard (A2): the ladder is compute-then-mint-immediately. The oracle reprices
// continuously and the forward jitters tens of ticks during compute, but the Predict band is
// ~6000 ticks wide — so a magic drift threshold mis-fires. The authoritative, threshold-free
// check is to dry-run the EXACT tx we're about to sign and refuse to emit bytes unless it's
// `success`. Set GUARD=1 (or it auto-runs in dryrun mode) before signing a real submission.
if (mode === 'bytes' && E.GUARD) {
  const g = await client.dryRunTransactionBlock({ transactionBlock: b64 });
  if (g.effects.status.status !== 'success') {
    console.error(`stale/invalid: pre-submit dry-run failed: ${g.effects.status.error}`);
    process.exit(1);
  }
  console.error('[ok] pre-submit dry-run success — ladder still band-valid');
}

if (mode === 'bytes') {
  console.log(b64);
} else {
  const r = await client.dryRunTransactionBlock({ transactionBlock: b64 });
  console.log('status:', JSON.stringify(r.effects.status));
  if (r.effects.status.status !== 'success') { console.log('ERR effects:', JSON.stringify(r.effects, null, 1)); }
  console.log('events:', r.events.map(e => e.type.split('::').slice(-1)[0]));
  console.log('gasUsed:', JSON.stringify(r.effects.gasUsed));
  console.log('created:', r.objectChanges.filter(c => c.type === 'created').map(c => c.objectType.split('::').slice(-2).join('::')));
}
