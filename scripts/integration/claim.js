// Build the claim PTB (claim_begin -> claim_settle_expiry x1 -> claim_finalize).
// Usage: node claim.js <dryrun|bytes>
//   env: MGR, ORACLE, NOTE
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { RPC, ADDR, PKG, VAULT, PREDICT, DUSDC, CLOCK } from './config.js';

const mode = process.argv[2] || 'dryrun';
const E = process.env;
const MGR = E.MGR, ORACLE = E.ORACLE, NOTE = E.NOTE;
if (!MGR || !ORACLE || !NOTE) { console.error('missing env MGR/ORACLE/NOTE'); process.exit(1); }

const client = new SuiClient({ url: RPC });
const tx = new Transaction();
tx.setSender(ADDR);
tx.setGasBudget(600_000_000);

const ct = tx.moveCall({
  target: `${PKG}::note_factory::claim_begin`,
  arguments: [tx.object(NOTE), tx.object(MGR), tx.object(CLOCK)],
});
tx.moveCall({
  target: `${PKG}::note_factory::claim_settle_expiry`,
  typeArguments: [DUSDC],
  arguments: [ct, tx.object(PREDICT), tx.object(MGR), tx.object(ORACLE), tx.object(CLOCK)],
});
tx.moveCall({
  target: `${PKG}::note_factory::claim_finalize`,
  typeArguments: [DUSDC],
  arguments: [ct, tx.object(MGR), tx.object(VAULT)],
});

const txBytes = await tx.build({ client });
const b64 = Buffer.from(txBytes).toString('base64');

if (mode === 'bytes') {
  console.log(b64);
} else {
  const r = await client.dryRunTransactionBlock({ transactionBlock: b64 });
  console.log('status:', JSON.stringify(r.effects.status));
  console.log('events:', r.events.map(e => e.type.split('::').slice(1).join('::') + ' ' + JSON.stringify(e.parsedJson).slice(0, 80)));
  console.log('balanceChanges:', r.balanceChanges.map(x => x.coinType.split('::').slice(-1)[0] + ' ' + x.amount));
}
