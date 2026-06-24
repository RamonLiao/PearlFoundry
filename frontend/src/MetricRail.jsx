import { fmtDusdc, fmtBand, fmtExpiry, fmtPerStep } from './metricRail.js';

/**
 * Live quote metric rail — a divided list (no boxed cards). Headline numbers (Floor / Max /
 * Notional) render in Fraunces; ranges/dates/compound values (Band / Expiry / Per-step) in mono.
 * Floor carries the single jade accent. All values null-safe (em-dash, never NaN).
 * @param {{curve: object, notional: string|number, expiry: string|number}} props
 */
export default function MetricRail({ curve, notional, expiry }) {
  const lo = curve.strikes[0];
  const hi = curve.strikes[curve.strikes.length - 1];
  const rows = [
    { label: 'Floor (leftover)', value: `${fmtDusdc(curve.baseline)} dUSDC`, kind: 'num floor' },
    { label: 'Max payout',       value: `${fmtDusdc(curve.maxPayout)} dUSDC`, kind: 'num' },
    { label: 'Notional',         value: `${fmtDusdc(notional)} dUSDC`, kind: 'num' },
    { label: 'Accrual band',     value: fmtBand(lo, hi), kind: 'mono' },
    { label: 'Per step · legs',  value: fmtPerStep(curve.qtyPerLeg, curve.legs), kind: 'mono' },
    { label: 'Expiry',           value: fmtExpiry(expiry), kind: 'mono' },
  ];
  return (
    <dl className="nl-rail">
      {rows.map((r) => (
        <div key={r.label} className={`nl-rail-row${r.kind.includes('floor') ? ' nl-rail-row--floor' : ''}`}>
          <dt className="nl-rail-label">{r.label}</dt>
          <dd className={`nl-rail-value ${r.kind.includes('mono') ? 'nl-rail-value--mono' : 'nl-rail-value--num'}`}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
