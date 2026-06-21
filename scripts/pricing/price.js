// CLI + importable: derive a band-valid range-accrual strike ladder from the live oracle,
// replacing the manual LOWER/UPPER/STEP env in mint.js.
// Usage: MGR=.. DUSDC_COIN=.. ASSET=BTC EXPIRY=.. NOTIONAL=10000000 node price.js
import { SuiClient } from '@mysten/sui/client';
import { ADDR, RPC, CFG, VAULT, PREDICT, DUSDC, CLOCK } from '../integration/config.js';
import { resolveOracle, fetchOracle, sanityBand } from './oracle.js';
import { probeBounds } from './probe.js';
import { buildLadder } from './ladder.js';

// maxLegs default 16 (~0.55 SUI mint gas): gas scales steeply per leg (storage-dominated;
// 32 legs ≈1.6 SUI, 128 >10 SUI). Move MAX_LEGS=128 is the DoS hard cap; the single-PTB mint's
// real binding constraint is gas, not the band (which is ~6000+ ticks wide on testnet).
export async function computeLadder({ client, asset, expiry, notional, mgr, dusdcCoin,
                                      sender = ADDR, stepMult = 1, maxLegs = 16 }) {
  const { oracleId, tickSize, minStrike } = await resolveOracle(client, asset, BigInt(expiry));
  const o = await fetchOracle(client, oracleId, { tickSize, minStrike });
  const step = o.tickSize * BigInt(stepMult);
  const ctx = { client, sender, mgr, cfg: CFG, vault: VAULT, predict: PREDICT,
    dusdc: DUSDC, dusdcCoin, clock: CLOCK, oracleId, notional: BigInt(notional), asset, tickSize: o.tickSize };

  const { loBound, hiBound, loCapped, hiCapped } = await probeBounds(ctx, o.forward, step, { maxLegs });
  if (loCapped || hiCapped) {
    console.warn(`[info] band wider than ${maxLegs} legs each side (loCapped=${loCapped} hiCapped=${hiCapped}); MAX_LEGS binds, not the band.`);
  }
  const ladder = buildLadder({ forward: o.forward, tickSize: o.tickSize, minStrike: o.minStrike,
    loBound, hiBound, stepMult, maxLegs });

  const sb = await sanityBand(client, asset);
  if (sb && (ladder.lower < sb.minSeen / 2n || ladder.upper > sb.maxSeen * 2n)) {
    console.warn(`[warn] ladder [${ladder.lower},${ladder.upper}] outside order-of-magnitude sanity [${sb.minSeen},${sb.maxSeen}]`);
  }
  return { oracleId, ...ladder, forward: o.forward, timestamp: o.timestamp };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const E = process.env;
  if (!E.MGR || !E.DUSDC_COIN || !E.EXPIRY) { console.error('missing env: MGR, DUSDC_COIN, EXPIRY required'); process.exit(1); }
  const client = new SuiClient({ url: RPC });
  const out = await computeLadder({ client, asset: E.ASSET || 'BTC', expiry: E.EXPIRY,
    notional: E.NOTIONAL || '10000000', mgr: E.MGR, dusdcCoin: E.DUSDC_COIN,
    stepMult: Number(E.STEP_MULT || '1'), maxLegs: Number(E.MAX_LEGS || '16') });
  console.log(JSON.stringify({ ...out, lower: out.lower.toString(), upper: out.upper.toString(),
    step: out.step.toString(), center: out.center.toString(), forward: out.forward.toString(),
    timestamp: out.timestamp.toString() }, null, 2));
}
