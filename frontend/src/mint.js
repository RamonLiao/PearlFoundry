import { Transaction } from '@mysten/sui/transactions';
import { postTx } from './api.js';

/** Phase 1: create the PredictManager (PTB1) and fetch the mint quote (unsigned PTB2). */
export async function prepareMint({ signExec, sender }) {
  const { tx: cmTxJson } = await postTx('/create-manager-tx', { sender });
  const r1 = await signExec(Transaction.from(cmTxJson));
  if (r1.$kind === 'FailedTransaction') {
    const err = r1.FailedTransaction?.effects?.status?.error;
    throw new Error(`PTB1 failed on-chain: ${err?.message ?? JSON.stringify(err)} — mint NOT completed`);
  }
  const changed = r1.Transaction?.effects?.changedObjects ?? [];
  const mgrObj = changed.find((c) => c.idOperation === 'Created' && c.outputState === 'ObjectWrite');
  if (!mgrObj) {
    throw new Error('PTB1 landed but no Created ObjectWrite found in effects.changedObjects — mint NOT completed. ' +
      `changedObjects=${JSON.stringify(changed)}`);
  }
  const mgr = mgrObj.objectId;
  const { tx, ladder, forward, qtyPerLeg, expiry } = await postTx('/quote', { sender, mgr });
  return { mgr, tx, ladder, forward, qtyPerLeg, expiry };
}

/** Phase 2: sign the mint (PTB2) after the user confirms the payoff preview. */
export async function finalizeMint({ signExec, tx, mgr }) {
  const r2 = await signExec(Transaction.from(tx));
  if (r2.$kind === 'FailedTransaction') {
    const err = r2.FailedTransaction?.effects?.status?.error;
    throw new Error(`PTB2 (mint) failed — manager was created (${mgr}) but note was NOT minted. ` +
      `Error: ${err?.message ?? JSON.stringify(err)}`);
  }
  const mintDigest = r2.Transaction?.digest;
  if (!mintDigest) throw new Error('PTB2 returned no digest — mint status unknown, treat as NOT completed');
  return { mgr, mintDigest };
}
