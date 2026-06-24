// scripts/indexer/leftover.js
// Derive a Range-Accrual note's immutable `leftover` from its mint transaction events.
// leftover = net_principal − Σ premium, where net = the deposited dUSDC (BalanceEvent deposit)
// and Σ premium = Σ PositionMinted.cost. This is fixed at mint and lifecycle-independent — unlike
// the live manager balance, which inflates to the cap once ITM legs redeem at settlement.

const isPositionMinted = (e) => e.type.endsWith('::PositionMinted');
const isDeposit = (e) => e.type.endsWith('::BalanceEvent') && e.parsedJson?.deposit === true;

export function deriveLeftover(events) {
  const legs = events.filter(isPositionMinted);
  if (legs.length === 0) throw new Error('deriveLeftover: no PositionMinted events (legs === 0)');
  const dep = events.find(isDeposit);
  if (!dep) throw new Error('deriveLeftover: no deposit BalanceEvent — cannot read net principal');
  const net = BigInt(dep.parsedJson.amount);
  const sumCost = legs.reduce((a, e) => a + BigInt(e.parsedJson.cost), 0n);
  const leftover = net - sumCost;
  if (leftover < 0n) throw new Error(`deriveLeftover: negative leftover (${leftover}) — Σcost exceeds net`);
  return { leftover, net, sumCost, legs: legs.length };
}

export function deriveParamsFromEvents(events) {
  const legs = events.filter(isPositionMinted);
  if (legs.length === 0) return null;
  const strikes = legs.map((e) => BigInt(e.parsedJson.strike)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const lower = strikes[0], upper = strikes[strikes.length - 1];
  const strike_step = strikes.length > 1 ? strikes[1] - strikes[0] : upper; // single-leg degenerate
  return {
    lower, upper, strike_step,
    qty_per_leg: BigInt(legs[0].parsedJson.quantity),
    legs_per_expiry: legs.length,
    expiry_count: 1, // product is single-expiry; multi-expiry reconstruction is out of scope
  };
}
