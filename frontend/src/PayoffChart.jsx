import { useId } from 'react';

/**
 * Range Accrual payoff staircase. Pure presentational — feed it computePayoffCurve() output.
 * Visual: iridescent nacre fill + molten gold step line + (sparse) strike dots + rust forward
 * marker + optional settlement marker. Honors prefers-reduced-motion (no entrance animation).
 *
 * @param {{curve: object, forward?: number, settlementPrice?: number|null, size?: 'full'|'compact'}} props
 */
export default function PayoffChart({ curve, forward, settlementPrice = null, size = 'full' }) {
  const uid = useId();
  const full = size === 'full';
  const W = full ? 420 : 300;
  const H = full ? 250 : 140;
  const padL = full ? 50 : 20, padR = full ? 20 : 14, padT = full ? 30 : 14, padB = full ? 22 : 14;
  const x0 = padL, x1 = W - padR, y0 = H - padB, y1 = padT;

  const { points, strikes, maxPayout, legs, baseline = 0, qtyPerLeg } = curve;
  // Price domain: pad one step on each side of the band so the flat ends are visible.
  const lo = strikes[0], hi = strikes[strikes.length - 1];
  const stepW = strikes.length > 1 ? (hi - lo) / (strikes.length - 1) : (hi || 1) * 0.05;
  const pMin = lo - stepW, pMax = hi + stepW;
  const px = (p) => x0 + ((p - pMin) / (pMax - pMin)) * (x1 - x0);
  const py = (v) => y0 - (maxPayout ? (v / maxPayout) * (y0 - y1) : 0);

  // Build the polyline: flat from pMin@baseline → first point, the staircase, then flat to pMax@max.
  // baseline (= leftover) lifts both flat ends off 0 — the floor a holder reclaims even all-OTM.
  const stair = points.map((pt) => `${px(pt.price).toFixed(1)},${py(pt.payout).toFixed(1)}`);
  const line = [`${px(pMin).toFixed(1)},${py(baseline).toFixed(1)}`, ...stair, `${px(pMax).toFixed(1)},${py(maxPayout).toFixed(1)}`];
  // Fill spans from the step line down to 0, so close the polygon at py(0) on both ends.
  const area = [`${px(pMin).toFixed(1)},${py(0).toFixed(1)}`, ...line, `${px(pMax).toFixed(1)},${py(0).toFixed(1)}`];

  const showDots = legs <= 24;
  // Markers can fall outside the band domain (e.g. forward below the accrual zone at mint).
  // Clamp them to the plot edges so they never collide with the axis labels, and flag the
  // off-scale direction so the staircase stays readable instead of squashed.
  const clampX = (x) => Math.max(x0, Math.min(x1, x));
  const fwdRaw = forward != null ? px(forward) : null;
  const fwdX = fwdRaw != null ? clampX(fwdRaw) : null;
  const fwdBelow = fwdRaw != null && fwdRaw < x0;
  const fwdAbove = fwdRaw != null && fwdRaw > x1;
  const fwdRight = fwdX != null && fwdX > x0 + (x1 - x0) * 0.7; // flip label left when forward is far right
  const setRaw = settlementPrice != null ? px(settlementPrice) : null;
  const setX = setRaw != null ? clampX(setRaw) : null;
  const setY = settlementPrice != null ? py(payoutAt(curve, settlementPrice)) : null;
  const setRight = setX != null && setX > x0 + (x1 - x0) * 0.7;
  // Axis ticks: pick the fewest decimals that render the band edges distinctly (narrow BTC
  // bands round to the same integer 'k' otherwise — e.g. 62.632k and 62.647k both → 63k).
  const kd = kDecimals(lo, hi);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label={`Payoff: floor ${fmt(baseline)} below ${fmt(lo)}, rising in steps to ${fmt(maxPayout)} at ${fmt(hi)}.${forward != null ? ` Forward ${fmt(forward)}.` : ''}${settlementPrice != null ? ` Settled at ${fmt(settlementPrice)}.` : ''}`}
      style={{ display: 'block', minWidth: 0, maxWidth: full ? 480 : 420 }}>
      <defs>
        {/* Real --nacre 4-stop iridescent sweep (theme.css), low opacity */}
        <linearGradient id={`nacre-${uid}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#cdeadf" stopOpacity="0.12" />
          <stop offset="0.4" stopColor="#d7cef2" stopOpacity="0.30" />
          <stop offset="0.7" stopColor="#f8ddc9" stopOpacity="0.40" />
          <stop offset="1" stopColor="#cfeae6" stopOpacity="0.45" />
        </linearGradient>
      </defs>

      {/* band-edge verticals (full only): the accrual band edges = the product story */}
      {full && <line x1={px(lo)} y1={y1} x2={px(lo)} y2={y0} stroke="var(--chart-grid)" />}
      {full && <line x1={px(hi)} y1={y1} x2={px(hi)} y2={y0} stroke="var(--chart-grid)" />}

      {/* axes */}
      <line x1={x0} y1={y0} x2={x1} y2={y0} stroke="var(--chart-axis)" />
      {full && <line x1={x0} y1={y1} x2={x0} y2={y0} stroke="var(--chart-axis)" />}

      {/* fill + step line */}
      <polygon points={area.join(' ')} fill={`url(#nacre-${uid})`} />
      <polyline points={line.join(' ')} fill="none" stroke="var(--molten-end)" strokeWidth={full ? 2.4 : 2} strokeLinejoin="round" />

      {/* strike dots (hidden when crowded) */}
      {showDots && strikes.map((s, k) => (
        <circle key={k} cx={px(s)} cy={py(baseline + qtyPerLeg * (k + 1))} r={full ? 2.6 : 2} fill="var(--molten-end)" />
      ))}

      {/* forward marker */}
      {fwdX != null && <>
        <line x1={fwdX} y1={y1} x2={fwdX} y2={y0} stroke="var(--chart-fwd)" strokeWidth="1.3" strokeDasharray="4 3" />
        <text x={fwdRight ? fwdX - 4 : fwdX + 4} y={y1 + 12} textAnchor={fwdRight ? 'end' : 'start'}
          fill="var(--chart-fwd)" fontFamily="var(--font-mono)" fontSize="11">{fwdBelow ? '< ' : ''}fwd {fmt(forward)}{fwdAbove ? ' >' : ''}</text>
      </>}

      {/* settlement marker — structurally distinct (solid line + ringed dot + tag) */}
      {setX != null && <>
        <line x1={setX} y1={y1} x2={setX} y2={y0} stroke="var(--chart-settlement)" strokeWidth="1.3" />
        <circle cx={setX} cy={setY} r={full ? 5 : 4} fill="none" stroke="var(--chart-settlement)" strokeWidth="1.5" />
        <circle cx={setX} cy={setY} r={full ? 2.5 : 2} fill="var(--chart-settlement)" />
        {full && <text x={setRight ? setX - 6 : setX + 6} y={setY - 6} textAnchor={setRight ? 'end' : 'start'} fill="var(--chart-settlement)" fontFamily="var(--font-mono)" fontSize="11">settled {fmt(settlementPrice)}</text>}
      </>}

      {/* axis ticks (full only) */}
      {full && <>
        <text x={x0 - 6} y={y0 + 3} textAnchor="end" fill="var(--chart-tick)" fontFamily="var(--font-mono)" fontSize="11">0</text>
        {baseline > 0 && (
          <text x={x0 - 6} y={py(baseline) + 3} textAnchor="end" fill="var(--chart-tick)"
            fontFamily="var(--font-mono)" fontSize="11">{fmt(baseline)}</text>
        )}
        <text x={x0 - 6} y={y1 + 8} textAnchor="end" fill="var(--chart-tick)" fontFamily="var(--font-mono)" fontSize="11">{fmt(maxPayout)}</text>
        <text x={px(lo)} y={y0 + 16} textAnchor="middle" fill="var(--chart-tick)" fontFamily="var(--font-mono)" fontSize="11">{fmtK(lo, kd)}</text>
        <text x={px(hi)} y={y0 + 16} textAnchor="middle" fill="var(--chart-tick)" fontFamily="var(--font-mono)" fontSize="11">{fmtK(hi, kd)}</text>
      </>}
    </svg>
  );
}

// payout at an arbitrary settlement price = baseline (leftover) + per-leg × strikes strictly below.
function payoutAt(curve, price) {
  const below = curve.strikes.filter((s) => s < price).length;
  return (curve.baseline ?? 0) + curve.qtyPerLeg * below;
}
// compact formatting for oracle ticks (e9) → human price, and base-unit payout → dUSDC.
function fmtK(tick, decimals = 0) { return `${(tick / 1e12).toFixed(decimals)}k`; }
// fewest decimals (0–3) that render lo and hi as distinct 'k' labels.
function kDecimals(lo, hi) {
  for (let d = 0; d <= 3; d++) if ((lo / 1e12).toFixed(d) !== (hi / 1e12).toFixed(d)) return d;
  return 3;
}
function fmt(v) { return v >= 1e9 ? `${(v / 1e9 / 1000).toFixed(1)}k` : `${(v / 1e6).toFixed(2)}`; }
