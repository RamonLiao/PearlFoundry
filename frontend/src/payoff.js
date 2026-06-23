const MAX_LEGS = 128n;

/**
 * Range Accrual payoff = a ladder of long up(strike) binaries: each leg pays
 * qtyPerLeg once settlement > its strike. Payout is a monotonic staircase in
 * settlement price. Mirrors on-chain invariants in strategy_range_accrual.move.
 *
 * @param {{lower: bigint|string|number, upper: bigint|string|number,
 *          step: bigint|string|number, qtyPerLeg: bigint|string|number}} p
 */
export function computePayoffCurve(p) {
  const lower = BigInt(p.lower);
  const upper = BigInt(p.upper);
  const step = BigInt(p.step);
  const qty = BigInt(p.qtyPerLeg);

  if (step <= 0n) throw new Error('payoff: step must be > 0');
  if (upper <= lower) throw new Error('payoff: invalid range (upper <= lower)');
  if ((upper - lower) % step !== 0n) throw new Error('payoff: grid misaligned ((upper-lower) % step != 0)');

  const legsBig = (upper - lower) / step + 1n;
  if (legsBig < 1n) throw new Error('payoff: legs < 1');
  if (legsBig > MAX_LEGS) throw new Error(`payoff: too many legs (${legsBig} > 128)`);

  const legs = Number(legsBig);
  const strikes = [];
  const points = [];
  for (let k = 0n; k < legsBig; k++) {
    const strike = lower + k * step;
    strikes.push(Number(strike));
    const before = qty * k;            // payout just below this strike
    const after = qty * (k + 1n);      // payout once this leg pays
    points.push({ price: Number(strike), payout: Number(before) });
    points.push({ price: Number(strike), payout: Number(after) });
  }
  return {
    legs,
    qtyPerLeg: Number(qty),
    maxPayout: Number(qty * legsBig),
    strikes,
    points,
  };
}
