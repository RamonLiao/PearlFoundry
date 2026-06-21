import { Transaction } from '@mysten/sui/transactions';
import { postTx } from './api.js';

/**
 * Run the 2-PTB mint flow.
 *
 * @param {object} params
 * @param {(tx: Transaction) => Promise<import('@mysten/dapp-kit-core').TransactionResultWithEffects>} params.signExec
 *   Injected signer — wraps dAppKit.signAndExecuteTransaction; accepts a Transaction object.
 * @param {string} params.sender  Connected wallet address (sender-assert: must match tx sender).
 * @returns {Promise<{mgr: string, mintDigest: string, expiry: string}>}
 *   Resolves only on full success; throws verbatim on any failure, never fakes success.
 */
export async function runMint({ signExec, sender }) {
  // ── PTB1: create PredictManager ──────────────────────────────────────────
  const { tx: cmTxJson } = await postTx('/create-manager-tx', { sender });

  const r1 = await signExec(Transaction.from(cmTxJson));
  // The await above resolves only after on-chain execution (dapp-kit-react 2.x behaviour).
  // No separate waitForTransaction is needed for PTB1 finality (spec A3).

  if (r1.$kind === 'FailedTransaction') {
    const err = r1.FailedTransaction?.effects?.status?.error;
    throw new Error(`PTB1 failed on-chain: ${err?.message ?? JSON.stringify(err)} — mint NOT completed`);
  }

  // Extract PredictManager object id from gRPC effects.
  // ChangedObject has: objectId, idOperation ('Created'|...), outputState ('ObjectWrite'|'PackageWrite'|...).
  // PTB1 creates exactly one non-package object: the PredictManager.
  const changed = r1.Transaction?.effects?.changedObjects ?? [];
  const mgrObj = changed.find(
    (c) => c.idOperation === 'Created' && c.outputState === 'ObjectWrite',
  );
  if (!mgrObj) {
    throw new Error(
      'PTB1 landed but no Created ObjectWrite found in effects.changedObjects — mint NOT completed. ' +
      `changedObjects=${JSON.stringify(changed)}`,
    );
  }
  const mgr = mgrObj.objectId;

  // ── PTB2: quote + mint ────────────────────────────────────────────────────
  const quoteRes = await postTx('/quote', { sender, mgr });
  const { tx: quoteTxJson, expiry } = quoteRes;

  const r2 = await signExec(Transaction.from(quoteTxJson));

  if (r2.$kind === 'FailedTransaction') {
    const err = r2.FailedTransaction?.effects?.status?.error;
    throw new Error(
      `PTB2 (mint) failed — manager was created (${mgr}) but note was NOT minted. ` +
      `Error: ${err?.message ?? JSON.stringify(err)}`,
    );
  }

  const mintDigest = r2.Transaction?.digest;
  if (!mintDigest) {
    throw new Error('PTB2 returned no digest — mint status unknown, treat as NOT completed');
  }

  return { mgr, mintDigest, expiry };
}
