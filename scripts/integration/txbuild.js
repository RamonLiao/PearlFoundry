// Importable, un-built PTB builders extracted from mint.js / claim.js.
// Every tx leaves object versions UNRESOLVED and gas UNSET — dapp-kit fills both at sign time.
import { Transaction } from '@mysten/sui/transactions';
import { PKG, CFG, VAULT, PREDICT, DUSDC, CLOCK } from './config.js';
import { PREDICT_PKG } from '../pricing/oracle.js';

export { PREDICT_PKG };
const bytes = s => [...new TextEncoder().encode(s)];

export function buildCreateManagerTx({ sender }) {
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({ target: `${PREDICT_PKG}::predict::create_manager`, arguments: [] });
  return tx;
}

export function buildMintTx({ sender, mgr, oracle, dusdcCoin, notional, lower, upper, step,
                             expiryTotal, asset = 'BTC', walrusBlob = 'walrus-blob-test', isPublic = true }) {
  const tx = new Transaction();
  tx.setSender(sender);
  const [pay] = tx.splitCoins(tx.object(dusdcCoin), [BigInt(notional)]);
  const ticket = tx.moveCall({
    target: `${PKG}::note_factory::mint_begin`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(CFG), tx.object(VAULT), tx.object(mgr), pay,
      tx.pure.vector('u8', bytes(asset)),
      tx.pure.u64(BigInt(lower)), tx.pure.u64(BigInt(upper)), tx.pure.u64(BigInt(step)),
      tx.pure.u8(expiryTotal),
      tx.pure.vector('u8', bytes(walrusBlob)),
      tx.pure.bool(isPublic),
    ],
  });
  tx.moveCall({
    target: `${PKG}::note_factory::mint_add_expiry`,
    typeArguments: [DUSDC],
    arguments: [ticket, tx.object(PREDICT), tx.object(mgr), tx.object(oracle), tx.object(CLOCK)],
  });
  tx.moveCall({ target: `${PKG}::note_factory::mint_finalize`, arguments: [ticket, tx.object(CLOCK)] });
  return tx;
}

export function buildClaimTx({ sender, note, mgr, oracle }) {
  const tx = new Transaction();
  tx.setSender(sender);
  const ct = tx.moveCall({
    target: `${PKG}::note_factory::claim_begin`,
    arguments: [tx.object(note), tx.object(mgr), tx.object(CLOCK)],
  });
  tx.moveCall({
    target: `${PKG}::note_factory::claim_settle_expiry`,
    typeArguments: [DUSDC],
    arguments: [ct, tx.object(PREDICT), tx.object(mgr), tx.object(oracle), tx.object(CLOCK)],
  });
  tx.moveCall({
    target: `${PKG}::note_factory::claim_finalize`,
    typeArguments: [DUSDC],
    arguments: [ct, tx.object(mgr), tx.object(VAULT)],
  });
  return tx;
}
