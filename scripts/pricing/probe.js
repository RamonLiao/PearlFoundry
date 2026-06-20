// Dry-run band probing: the authoritative way to learn which strikes pass predict::mint's
// per-leg ask-price band. Builds a minimal 1-leg mint PTB and classifies the dry-run result.
import { Transaction } from '@mysten/sui/transactions';
import { PKG } from '../integration/config.js';

const bytes = s => [...new TextEncoder().encode(s)];
const BAND_CODES = new Set([1n, 7n]); // pricing_config crash / assert_mintable_ask

// strategy_range_accrual::legs_per_expiry asserts lower < upper (a 1-strike ladder is
// illegal), so we can't probe a single strike. Instead build a minimal 2-leg ladder where
// the probed strike is the OUTER leg and the partner is one tick TOWARD the forward. The
// band is per-leg and monotone in distance-from-forward, so the partner (always closer)
// passes whenever the outer one does → the tx's success is exactly the probed strike's verdict.
//   dir +1 (probing upward):   ladder = [strike-tick, strike]
//   dir -1 (probing downward): ladder = [strike, strike+tick]
function buildProbe(ctx, strike, dir) {
  const lower = dir >= 0 ? strike - ctx.tickSize : strike;
  const upper = dir >= 0 ? strike : strike + ctx.tickSize;
  const tx = new Transaction();
  tx.setSender(ctx.sender);
  tx.setGasBudget(600_000_000);
  const [pay] = tx.splitCoins(tx.object(ctx.dusdcCoin), [ctx.notional]);
  const ticket = tx.moveCall({
    target: `${PKG}::note_factory::mint_begin`,
    typeArguments: [ctx.dusdc],
    arguments: [
      tx.object(ctx.cfg), tx.object(ctx.vault), tx.object(ctx.mgr), pay,
      tx.pure.vector('u8', bytes(ctx.asset)),
      tx.pure.u64(lower), tx.pure.u64(upper), tx.pure.u64(ctx.tickSize),
      tx.pure.u8(1),
      tx.pure.vector('u8', bytes('probe')), tx.pure.bool(true),
    ],
  });
  tx.moveCall({
    target: `${PKG}::note_factory::mint_add_expiry`,
    typeArguments: [ctx.dusdc],
    arguments: [ticket, tx.object(ctx.predict), tx.object(ctx.mgr), tx.object(ctx.oracleId), tx.object(ctx.clock)],
  });
  tx.moveCall({ target: `${PKG}::note_factory::mint_finalize`, arguments: [ticket, tx.object(ctx.clock)] });
  return tx;
}

// Boundary direction for a probe at `strike` relative to the forward: +1 upper side, -1 lower.
function dirOf(strike, forward) { return strike >= forward ? 1 : -1; }

// MoveAbort errors look like: "MoveAbort(MoveLocation { ... }, 7) in command 1".
export function parseAbortCode(err) {
  if (!err) return null;
  const m = err.match(/MoveAbort\(.*?,\s*(\d+)\)/) || err.match(/,\s*(\d+)\)\s*in command/);
  return m ? BigInt(m[1]) : null;
}

// Memoized (strike,dir) → 'ok' | 'band'. `forward` selects which side's partner leg to use
// (probe toward the forward). Throws (loud) on any abort outside the band whitelist, so an
// underfunded coin / wrong context surfaces instead of masquerading as a band reject.
export function makeIsMintable(ctx, forward) {
  const cache = new Map();
  return async function isMintable(strike) {
    const dir = dirOf(strike, forward);
    const key = `${strike}:${dir}`;
    if (cache.has(key)) return cache.get(key);
    const tx = buildProbe(ctx, strike, dir);
    const txBytes = await tx.build({ client: ctx.client });
    const r = await ctx.client.dryRunTransactionBlock({ transactionBlock: Buffer.from(txBytes).toString('base64') });
    const st = r.effects.status;
    let verdict;
    if (st.status === 'success') verdict = 'ok';
    else {
      const code = parseAbortCode(st.error);
      if (code != null && BAND_CODES.has(code)) verdict = 'band';
      else throw new Error(`unexpected abort at strike=${strike}: ${st.error}\n${JSON.stringify(st)}`);
    }
    cache.set(key, verdict);
    return verdict;
  };
}

// Walk outward from forward in `step` increments, bounded by `kmax` steps (the most the ladder
// can use). Two outcomes, both correct for ladder building:
//  - a failure is found within kmax → binary-search the exact edge, return last-good strike.
//  - still mintable at kmax → the band is wider than the ladder needs; return the cap
//    (forward + kmax*step). MAX_LEGS will bind in buildLadder and every leg stays in-band.
// Returns { strike, capped }. The Predict band (≫128 ticks on testnet) usually caps.
export async function findBoundary(isMintable, forward, dir, step, { kmax = 128n, floor = 0n } = {}) {
  const at = k => forward + BigInt(dir) * k * step;
  if (await isMintable(forward) !== 'ok') throw new Error(`forward ${forward} itself not mintable — band/oracle anomaly`);
  let lastOk = 0n, k = 1n, firstFail = 0n;
  while (k <= kmax) {
    const s = at(k);
    if (s < floor) { firstFail = k; break; }
    if (await isMintable(s) === 'ok') { lastOk = k; k *= 2n; } else { firstFail = k; break; }
  }
  if (firstFail === 0n) return { strike: at(lastOk), capped: true }; // never failed up to kmax
  if (lastOk === 0n) return { strike: forward, capped: false };      // 1 step out already fails
  let lo = lastOk, hi = firstFail;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (await isMintable(at(mid)) === 'ok') lo = mid; else hi = mid;
  }
  return { strike: at(lo), capped: false };
}

export async function probeBounds(ctx, forward, step, { maxLegs = 128 } = {}) {
  // Predict's oracle_config::assert_valid_strike rejects off-grid strikes (code 2, NOT a band
  // signal), so every probed strike must sit on the tick grid. Snap the forward to ticks first;
  // step is a tick multiple, so all walked strikes stay aligned.
  const fwd = (forward / ctx.tickSize) * ctx.tickSize;
  const isMintable = makeIsMintable(ctx, fwd);
  const kmax = BigInt(maxLegs);
  const hi = await findBoundary(isMintable, fwd, +1, step, { kmax });
  const lo = await findBoundary(isMintable, fwd, -1, step, { kmax, floor: 0n });
  return { loBound: lo.strike, hiBound: hi.strike, loCapped: lo.capped, hiCapped: hi.capped };
}
