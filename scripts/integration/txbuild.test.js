import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCreateManagerTx, buildMintTx, buildClaimTx } from './txbuild.js';

const SENDER = '0x1509b5fdf09296b2cf749a710e36da06f5693ccd5b2144ad643b3a895abcbc4c';
const ID = '0x' + '1'.repeat(64);

test('buildCreateManagerTx: one moveCall, sender set, gas not pinned', () => {
  const tx = buildCreateManagerTx({ sender: SENDER });
  const d = tx.getData();
  assert.equal(d.sender, SENDER);
  assert.ok(!d.gasData.budget);            // wallet fills gas
  const calls = d.commands.filter(c => c.MoveCall);
  assert.equal(calls.length, 1);
  assert.match(calls[0].MoveCall.function, /create_manager/);
});

test('buildMintTx: 3 moveCalls (begin/add/finalize) + a splitCoins', () => {
  const tx = buildMintTx({ sender: SENDER, mgr: ID, oracle: ID, dusdcCoin: ID,
    notional: 10000000n, lower: 62600000000000n, upper: 62800000000000n,
    step: 100000000000n, expiryTotal: 1 });
  const d = tx.getData();
  assert.equal(d.sender, SENDER);
  assert.ok(d.gasData.budget);
  const fns = d.commands.filter(c => c.MoveCall).map(c => c.MoveCall.function);
  assert.deepEqual(fns, ['mint_begin', 'mint_add_expiry', 'mint_finalize']);
  assert.ok(d.commands.some(c => c.SplitCoins));
});

test('buildClaimTx: 3 moveCalls (begin/settle/finalize)', () => {
  const tx = buildClaimTx({ sender: SENDER, note: ID, mgr: ID, oracle: ID });
  const fns = tx.getData().commands.filter(c => c.MoveCall).map(c => c.MoveCall.function);
  assert.deepEqual(fns, ['claim_begin', 'claim_settle_expiry', 'claim_finalize']);
});

test('buildMintTx: serialize round-trips to a Transaction', async () => {
  const { Transaction } = await import('@mysten/sui/transactions');
  const tx = buildMintTx({ sender: SENDER, mgr: ID, oracle: ID, dusdcCoin: ID,
    notional: 10000000n, lower: 1n, upper: 2n, step: 1n, expiryTotal: 1 });
  const json = tx.serialize();
  const back = Transaction.from(json);
  assert.equal(back.getData().sender, SENDER);
});
