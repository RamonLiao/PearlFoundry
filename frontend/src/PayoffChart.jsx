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

  const { points, strikes, maxPayout, legs } = curve;
  // Price domain: pad one step on each side of the band so the flat ends are visible.
  const lo = strikes[0], hi = strikes[strikes.length - 1];
  const stepW = strikes.length > 1 ? (hi - lo) / (strikes.length - 1) : (hi || 1) * 0.05;
  const pMin = lo - stepW, pMax = hi + stepW;
  const px = (p) => x0 + ((p - pMin) / (pMax - pMin)) * (x1 - x0);
  const py = (v) => y0 - (maxPayout ? (v / maxPayout) * (y0 - y1) : 0);

  // Build the polyline: flat from pMin@0 → first point, the staircase, then flat to pMax@max.
  const stair = points.map((pt) => `${px(pt.price).toFixed(1)},${py(pt.payout).toFixed(1)}`);
  const line = [`${px(pMin).toFixed(1)},${py(0).toFixed(1)}`, ...stair, `${px(pMax).toFixed(1)},${py(maxPayout).toFixed(1)}`];
  const area = [`${px(pMin).toFixed(1)},${py(0).toFixed(1)}`, ...line, `${px(pMax).toFixed(1)},${py(0).toFixed(1)}`];

  const showDots = legs <= 24;
  const fwdX = forward != null ? px(forward) : null;
  const fwdRight = fwdX != null && fwdX > x0 + (x1 - x0) * 0.7; // flip label left when forward is far right
  const setX = settlementPrice != null ? px(settlementPrice) : null;
  const setY = settlementPrice != null ? py(payoutAt(curve, settlementPrice)) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label={`Payoff: 0 below ${fmt(lo)}, rising in steps to ${fmt(maxPayout)} at ${fmt(hi)}.${forward != null ? ` Forward ${fmt(forward)}.` : ''}${settlementPrice != null ? ` Settled at ${fmt(settlementPrice)}.` : ''}`}
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
        <circle key={k} cx={px(s)} cy={py((maxPayout / legs) * (k + 1))} r={full ? 2.6 : 2} fill="var(--molten-end)" />
      ))}

      {/* forward marker */}
      {fwdX != null && <>
        <line x1={fwdX} y1={y1} x2={fwdX} y2={y0} stroke="var(--rust)" strokeWidth="1.3" strokeDasharray="4 3" />
        <text x={fwdRight ? fwdX - 4 : fwdX + 4} y={y1 + 12} textAnchor={fwdRight ? 'end' : 'start'}
          fill="var(--chart-fwd)" fontFamily="var(--font-mono)" fontSize="11">fwd {fmt(forward)}</text>
      </>}

      {/* settlement marker — structurally distinct (solid line + ringed dot + tag) */}
      {setX != null && <>
        <line x1={setX} y1={y1} x2={setX} y2={y0} stroke="var(--pearl)" strokeWidth="1.3" />
        <circle cx={setX} cy={setY} r={full ? 5 : 4} fill="none" stroke="var(--pearl)" strokeWidth="1.5" />
        <circle cx={setX} cy={setY} r={full ? 2.5 : 2} fill="var(--pearl)" />
        {full && <text x={setX + 6} y={setY - 6} fill="var(--pearl)" fontFamily="var(--font-mono)" fontSize="11">settled {fmt(settlementPrice)}</text>}
      </>}

      {/* axis ticks (full only) */}
      {full && <>
        <text x={x0 - 6} y={y0 + 3} textAnchor="end" fill="var(--chart-tick)" fontFamily="var(--font-mono)" fontSize="11">0</text>
        <text x={x0 - 6} y={y1 + 8} textAnchor="end" fill="var(--chart-tick)" fontFamily="var(--font-mono)" fontSize="11">{fmt(maxPayout)}</text>
        <text x={px(lo)} y={y0 + 16} textAnchor="middle" fill="var(--chart-tick)" fontFamily="var(--font-mono)" fontSize="11">{fmtK(lo)}</text>
        <text x={px(hi)} y={y0 + 16} textAnchor="middle" fill="var(--chart-tick)" fontFamily="var(--font-mono)" fontSize="11">{fmtK(hi)}</text>
      </>}
    </svg>
  );
}

// payout at an arbitrary settlement price (count strikes strictly below it × per-leg).
function payoutAt(curve, price) {
  const below = curve.strikes.filter((s) => s < price).length;
  return (curve.maxPayout / curve.legs) * below;
}
// compact integer formatting for oracle ticks (e9) → human price, and base-unit payout → dUSDC.
function fmtK(tick) { return `${Math.round(tick / 1e9 / 1000)}k`; }
function fmt(v) { return v >= 1e9 ? `${(v / 1e9 / 1000).toFixed(1)}k` : `${(v / 1e6).toFixed(2)}`; }
