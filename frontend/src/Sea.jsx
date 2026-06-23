/**
 * Sea — decorative underwater background: drifting caustic light + rising bubbles.
 * Pure presentation, no props/state. Sits behind app content (z-index 0).
 * All motion is disabled under prefers-reduced-motion via App.css.
 */
const BUBBLES = [
  { left: '6%',  size: 16, dur: '11s',   delay: '0s' },
  { left: '15%', size: 9,  dur: '14s',   delay: '2s' },
  { left: '24%', size: 22, dur: '16s',   delay: '5s' },
  { left: '33%', size: 12, dur: '12s',   delay: '7s' },
  { left: '44%', size: 18, dur: '15s',   delay: '1s' },
  { left: '55%', size: 10, dur: '13s',   delay: '3.5s' },
  { left: '64%', size: 24, dur: '18s',   delay: '6s' },
  { left: '74%', size: 11, dur: '12.5s', delay: '0.8s' },
  { left: '83%', size: 15, dur: '14.5s', delay: '4.5s' },
  { left: '92%', size: 20, dur: '17s',   delay: '9s' },
];

export default function Sea() {
  return (
    <div className="nl-sea" aria-hidden="true">
      <div className="nl-caustic" />
      {BUBBLES.map((b, i) => (
        <span
          key={i}
          className="nl-bubble"
          style={{
            left: b.left,
            width: b.size,
            height: b.size,
            animationDuration: b.dur,
            animationDelay: b.delay,
          }}
        />
      ))}
    </div>
  );
}
