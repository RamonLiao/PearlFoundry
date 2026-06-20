// Build the mint PTB (mint_begin -> mint_add_expiry x1 -> mint_finalize).
// Usage: node mint.js <dryrun|bytes>
//   env: MGR, ORACLE, DUSDC_COIN, NOTIONAL(optional), LOWER, UPPER, STEP, EXPIRY_TOTAL
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { RPC, ADDR, PKG, CFG, VAULT, PREDICT, DUSDC, CLOCK } from './config.js';

const mode = process.argv[2] || 'dryrun';
const E = process.env;
const MGR = E.MGR, ORACLE = E.ORACLE, DUSDC_COIN = E.DUSDC_COIN;
const NOTIONAL = BigInt(E.NOTIONAL || '10000000');     // 10 dUSDC
const LOWER = BigInt(E.LOWER), UPPER = BigInt(E.UPPER), STEP = BigInt(E.STEP);
const EXPIRY_TOTAL = Number(E.EXPIRY_TOTAL || '1');
if (!MGR || !ORACLE || !DUSDC_COIN || !E.LOWER) { console.error('missing env'); process.exit(1); }

const client = new SuiClient({ url: RPC });

const tx = new Transaction();
tx.setSender(ADDR);
tx.setGasBudget(2_000_000_000); // 2 SUI: 16-leg ladder ≈0.55 SUI; gas scales steeply per leg
const bytes = s => [...new TextEncoder().encode(s)];

const [pay] = tx.splitCoins(tx.object(DUSDC_COIN), [NOTIONAL]);
const ticket = tx.moveCall({
  target: `${PKG}::note_factory::mint_begin`,
  typeArguments: [DUSDC],
  arguments: [
    tx.object(CFG), tx.object(VAULT), tx.object(MGR), pay,
    tx.pure.vector('u8', bytes('BTC')),
    tx.pure.u64(LOWER), tx.pure.u64(UPPER), tx.pure.u64(STEP),
    tx.pure.u8(EXPIRY_TOTAL),
    tx.pure.vector('u8', bytes('walrus-blob-test')),
    tx.pure.bool(true),
  ],
});
tx.moveCall({
  target: `${PKG}::note_factory::mint_add_expiry`,
  typeArguments: [DUSDC],
  arguments: [ticket, tx.object(PREDICT), tx.object(MGR), tx.object(ORACLE), tx.object(CLOCK)],
});
tx.moveCall({
  target: `${PKG}::note_factory::mint_finalize`,
  arguments: [ticket, tx.object(CLOCK)],
});

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
