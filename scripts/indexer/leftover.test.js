import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveLeftover, deriveParamsFromEvents } from './leftover.js';

// Real testnet mint (tx pd7Mjqm…, note 0x136990dd…): 16 legs, net 9.97 dUSDC.
const COSTS = [320100,318240,316379,314516,312653,310789,308924,307059,305193,303327,301461,299595,297731,295865,293999,292134];
const STRIKE0 = 62812000000000n, STEP = 1000000000000n, QTY = 623125n;
const mintEvents = [
  { type: 'pkg::events::BalanceEvent', parsedJson: { amount: '9970000', deposit: true, asset: { name: 'e95…::dusdc::DUSDC' } } },
  ...COSTS.map((c, k) => ({
    type: 'pkg::predict::PositionMinted',
    parsedJson: { cost: String(c), quantity: String(QTY), strike: String(STRIKE0 + BigInt(k) * STEP), is_up: true },
  })),
];

test('deriveLeftover: net − Σcost on the real mint', () => {
  const r = deriveLeftover(mintEvents);
  assert.equal(r.legs, 16);
  assert.equal(r.net, 9970000n);
  assert.equal(r.sumCost, 4897965n);
  assert.equal(r.leftover, 5072035n);          // 5.07 dUSDC — NOT 0 (old pin), NOT 15.04 (live balance)
});

test('deriveLeftover: fail-loud on missing deposit BalanceEvent', () => {
  assert.throws(() => deriveLeftover(mintEvents.filter((e) => !e.type.endsWith('::BalanceEvent'))), /net/i);
});

test('deriveLeftover: fail-loud on zero legs', () => {
  assert.throws(() => deriveLeftover([mintEvents[0]]), /legs/i);
});

test('deriveLeftover: fail-loud on negative leftover', () => {
  const bad = [{ type: 'x::events::BalanceEvent', parsedJson: { amount: '100', deposit: true } },
               { type: 'x::predict::PositionMinted', parsedJson: { cost: '999', quantity: '1', strike: '1' } }];
  assert.throws(() => deriveLeftover(bad), /leftover/i);
});

test('deriveParamsFromEvents: reconstruct ladder from PositionMinted strikes', () => {
  const p = deriveParamsFromEvents(mintEvents);
  assert.equal(p.lower, STRIKE0);
  assert.equal(p.upper, STRIKE0 + 15n * STEP);
  assert.equal(p.strike_step, STEP);
  assert.equal(p.qty_per_leg, QTY);
  assert.equal(p.legs_per_expiry, 16);
});

test('deriveParamsFromEvents: null when no mint legs', () => {
  assert.equal(deriveParamsFromEvents([mintEvents[0]]), null);
});
