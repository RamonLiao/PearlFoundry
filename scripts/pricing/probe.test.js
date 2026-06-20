import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SuiClient } from '@mysten/sui/client';
import { resolveOracle, fetchOracle, PREDICT_PKG } from './oracle.js';
import { makeIsMintable, probeBounds, parseAbortCode } from './probe.js';
import { ADDR, CFG, VAULT, PREDICT, DUSDC, CLOCK } from '../integration/config.js';

const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
// Requires env: MGR (shared PredictManager owned by ADDR) + DUSDC_COIN (balance ≥ NOTIONAL).
const E = process.env;
const run = E.MGR && E.DUSDC_COIN ? test : test.skip;

// parseAbortCode is the one calibration risk (regex vs live SDK error string) — pin it on
// the real format observed on testnet so a future SDK change fails this, not silently misreads.
test('parseAbortCode extracts the trailing Move abort code', () => {
  const s = 'MoveAbort(MoveLocation { module: ModuleId { address: a6.., name: Identifier("predict") }, function: 2, instruction: 6, function_name: Some("mint") }, 7) in command 1';
  assert.equal(parseAbortCode(s), 7n);
  assert.equal(parseAbortCode('MoveAbort(MoveLocation { .. }, 13906834414861680643) in command 1'), 13906834414861680643n);
  assert.equal(parseAbortCode(null), null);
});

// Find the most recent priced (forward>0, unsettled) BTC oracle; skip if none.
async function pickOracle() {
  const ev = await client.queryEvents({
    query: { MoveEventModule: { package: PREDICT_PKG, module: 'registry' } },
    limit: 20, order: 'descending',
  });
  for (const e of ev.data) {
    if (e.parsedJson.underlying_asset !== 'BTC') continue;
    try {
      const r = await resolveOracle(client, 'BTC', BigInt(e.parsedJson.expiry));
      const o = await fetchOracle(client, r.oracleId, r);
      return { ...r, o };
    } catch { /* unpriced/settled → try older */ }
  }
  return null;
}

// The boundary is either exact (band narrower than the ladder needs → one tick past fails) or
// capped at maxLegs steps (band wider → MAX_LEGS binds). Both are correct; assert the right one.
run('probed bound is mintable; exact edge when narrow, capped when band is wide', async () => {
  const picked = await pickOracle();
  assert.ok(picked, 'no priced BTC oracle live');
  const { oracleId, tickSize, o } = picked;
  const fwd = (o.forward / tickSize) * tickSize;
  const ctx = { client, sender: ADDR, mgr: E.MGR, cfg: CFG, vault: VAULT, predict: PREDICT,
    dusdc: DUSDC, dusdcCoin: E.DUSDC_COIN, clock: CLOCK, oracleId, notional: 10_000_000n,
    asset: 'BTC', tickSize };
  const isMintable = makeIsMintable(ctx, fwd);
  const maxLegs = 128;
  const { loBound, hiBound, loCapped, hiCapped } = await probeBounds(ctx, fwd, tickSize, { maxLegs });

  assert.ok(loBound <= fwd && hiBound >= fwd, 'bounds bracket forward');
  assert.equal(await isMintable(hiBound), 'ok', 'hiBound itself mintable');
  assert.equal(await isMintable(loBound), 'ok', 'loBound itself mintable');
  if (hiCapped) assert.equal(hiBound, fwd + BigInt(maxLegs) * tickSize, 'capped at maxLegs');
  else assert.equal(await isMintable(hiBound + tickSize), 'band', 'one tick past exact hiBound rejects');
  if (loCapped) assert.equal(loBound, fwd - BigInt(maxLegs) * tickSize, 'capped at maxLegs');
  else assert.equal(await isMintable(loBound - tickSize), 'band', 'one tick past exact loBound rejects');
});
