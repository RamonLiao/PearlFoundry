// Pure: turn probed band boundaries into a max-width, forward-centered, on-grid ladder.
// Strikes live on the grid { center + k*step }, so MAX_LEGS shrink stays symmetric
// around the forward — the band requires every strike to hug the forward.
const MAX_LEGS_DEFAULT = 128;

export function snapToGrid(x, tick) {
  const r = x % tick;
  return r * 2n >= tick ? x - r + tick : x - r;
}

// BigInt division truncates toward zero; fix up for true floor/ceil on negatives.
function floorDiv(a, b) { const q = a / b; return (a % b !== 0n && a < 0n) ? q - 1n : q; }
function ceilDiv(a, b)  { const q = a / b; return (a % b !== 0n && a > 0n) ? q + 1n : q; }

// Largest grid point ≤ v (mode 'upper') or smallest grid point ≥ v (mode 'lower'),
// where the grid is { center + k*step }. Rounds inward so we never exceed probed bounds.
function snapToCenterGrid(v, center, step, mode) {
  const diff = v - center;
  const k = mode === 'upper' ? floorDiv(diff, step) : ceilDiv(diff, step);
  return center + k * step;
}

export function buildLadder({ forward, tickSize, minStrike, loBound, hiBound, stepMult = 1, maxLegs = MAX_LEGS_DEFAULT }) {
  const step = tickSize * BigInt(stepMult);
  const center = snapToGrid(forward, tickSize);
  const lo = loBound > minStrike ? loBound : minStrike;
  const hi = hiBound;
  let lower = snapToCenterGrid(lo, center, step, 'lower');
  let upper = snapToCenterGrid(hi, center, step, 'upper');
  if (upper < lower) { upper = lower = center; } // probe found nothing → single center leg
  let legs = Number((upper - lower) / step) + 1;
  if (legs > maxLegs) {
    const below = BigInt(Math.floor((maxLegs - 1) / 2));
    const above = BigInt(maxLegs - 1) - below;
    lower = center - below * step;
    upper = center + above * step;
    if (lower < minStrike) lower = snapToCenterGrid(minStrike, center, step, 'lower');
    legs = Number((upper - lower) / step) + 1;
  }
  return { lower, upper, step, legs, center };
}
