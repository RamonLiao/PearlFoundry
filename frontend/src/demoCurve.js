import { computePayoffCurve } from './payoff.js';

// Illustrative Range Accrual for the idle hero — generic BTC-ish band, 6 legs so the staircase
// reads clearly, non-zero leftover so the floor tick shows. Built from the real math (never
// hand-authored points) so the explainer shape always matches an actual payoff. Frozen so it can
// be referenced as a stable module const (no per-render recompute → stable animation key).
export const DEMO_CURVE = Object.freeze(computePayoffCurve({
  lower: 62000_000000000,   // 62.0k  (oracle tick, /1e12 = price)
  upper: 65000_000000000,   // 65.0k
  step:   500_000000000,    // 0.5k  → 7 strikes / 6 steps
  qtyPerLeg: 1_200000,      // 1.20 dUSDC per step (base units)
  leftover:  3_000000,      // 3.00 dUSDC floor
}));

export const DEMO_FORWARD = 63500_000000000; // 63.5k — inside the band, lands mid-staircase
