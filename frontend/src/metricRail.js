// Pure formatters for the metric rail. Kept JSX-free so node --test can exercise them directly.
// Mirrors PayoffChart's tick/dUSDC conventions (duplicated here, trivially, to avoid coupling the
// chart's private helpers to the rail).

const EMDASH = '—';

// base units (6 decimals) → "5.07" dUSDC
export function fmtDusdc(base) {
  if (base == null || base === '') return EMDASH;
  const n = Number(base);
  if (!Number.isFinite(n)) return EMDASH;
  return (n / 1e6).toFixed(2);
}

// fewest decimals (0–3) that render lo and hi as distinct 'k' labels (narrow BTC bands collapse).
function kDecimals(lo, hi) {
  const loNum = lo / 1e12, hiNum = hi / 1e12;
  // Find the maximum significant decimals in either number (up to 3)
  const loStr = loNum.toFixed(3), hiStr = hiNum.toFixed(3);
  // Remove trailing zeros to find actual significant decimals
  const loSig = loStr.replace(/\.?0+$/, '').split('.')[1]?.length || 0;
  const hiSig = hiStr.replace(/\.?0+$/, '').split('.')[1]?.length || 0;
  const needed = Math.max(loSig, hiSig);
  // Ensure they're distinct at the needed precision
  for (let d = 0; d <= needed; d++) {
    if (loNum.toFixed(d) !== hiNum.toFixed(d)) return Math.max(d, needed);
  }
  return needed;
}

// oracle ticks → "62.812k–62.827k"
export function fmtBand(loTick, hiTick) {
  if (loTick == null || hiTick == null) return EMDASH;
  const lo = Number(loTick), hi = Number(hiTick);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return EMDASH;
  const d = kDecimals(lo, hi);
  return `${(lo / 1e12).toFixed(d)}k–${(hi / 1e12).toFixed(d)}k`;
}

// unix ts (SECONDS from /quote, MILLIS from notes table) → "2025-06-15 12:00"
export function fmtExpiry(expiry) {
  if (expiry == null || expiry === '') return EMDASH;
  let ms = Number(expiry);
  if (!Number.isFinite(ms)) return EMDASH;
  if (ms < 1e12) ms *= 1000; // 10-digit seconds → millis
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return EMDASH; // out of Date range → don't let toISOString throw
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

// per-leg qty (base units) × legs → "+0.62 × 16"
export function fmtPerStep(qty, legs) {
  if (qty == null || legs == null) return EMDASH;
  const q = Number(qty);
  if (!Number.isFinite(q)) return EMDASH;
  return `+${(q / 1e6).toFixed(2)} × ${legs}`;
}
