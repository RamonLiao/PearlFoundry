// Off-chain mirror of note_factory::mint_begin qty allocation. Keep in lockstep with
// compute_issuance_fee (notional*fee_bps/10000) and ra::qty_per_leg (net/(legs*expiry)).
export function computeQtyPerLeg({ notional, feeBps, legs, expiryCount = 1 }) {
  const n = BigInt(notional);
  const bps = BigInt(feeBps);
  const fee = (n * bps) / 10000n;        // u128 floor, same as Move
  const net = n - fee;
  const total = BigInt(legs) * BigInt(expiryCount);
  const q = net / total;
  if (q <= 0n) throw new Error(`computeQtyPerLeg: zero qty (net=${net}, total=${total})`);
  return q;
}
