import { Transaction } from '@mysten/sui/transactions';
import { postTx } from './api.js';

/**
 * Phase 1: create the PredictManager (PTB1) and fetch the mint quote (unsigned PTB2).
 * @param {{ signExec: Function, sender: string, client?: { waitForTransaction?: Function } }} args
 *   client (optional) — dapp-kit's current SuiClient, used to confirm PTB1 before quoting.
 */
export async function prepareMint({ signExec, sender, client }) {
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

  // Harden the PTB1→PTB2 gap. PTB1 just spent the wallet's (often only) SUI gas coin and shared
  // the new manager; if PTB2's gas estimation runs before the fullnode indexes PTB1, the wallet
  // sees a stale single-coin state and misreports InsufficientGas. Wait for PTB1 to confirm so
  // the gas coin's new version + the manager are visible before we build/sign PTB2.
  // BEST-EFFORT ONLY: PTB1 has already executed and the manager exists. A missing digest, a
  // timeout, or a wait error must NOT discard the manager — fall through to /quote regardless
  // (re-throwing here would orphan a real on-chain manager and force a needless re-create).
  const ptb1Digest = r1.Transaction?.digest;
  if (client?.waitForTransaction && ptb1Digest) {
    try {
      await client.waitForTransaction({ digest: ptb1Digest, timeout: 10_000 });
    } catch (e) {
      console.warn('[mint] PTB1 not confirmed within timeout; proceeding to quote anyway:', e?.message);
    }
  }

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
