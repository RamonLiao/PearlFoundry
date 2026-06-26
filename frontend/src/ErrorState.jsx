import './App.css';

// Cracked pearl-shell line glyph. No mascot: the only mascot variants are happy,
// so a frowning pearl is impossible — a neutral fractured shell carries "broke"
// without tone-mismatch slop. Rust stroke only (graphic ≥3:1, not body text).
const SHELL = (
  <svg className="nl-errglyph" viewBox="0 0 48 48" fill="none" stroke="var(--rust)"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <g className="nl-errglyph-top">
      <path d="M24 8C14 8 7 16 6 24h36C41 16 34 8 24 8Z" />
      <path d="M16 22l4-9M24 22V9M32 22l-4-9" />
    </g>
    <g className="nl-errglyph-bot">
      <path d="M6 24c1 8 8 16 18 16s17-8 18-16" />
    </g>
    <path className="nl-errglyph-crack" pathLength="1" d="M24 9l-3 8 5 6-4 7 3 9" />
  </svg>
);

export default function ErrorState({ title = 'Something went wrong', message, compact = false }) {
  return (
    <div className={`nl-errstate${compact ? ' nl-errstate--compact' : ''}`} role="alert">
      {SHELL}
      <div className="nl-errstate-body">
        {!compact && <p className="nl-errstate-h">{title}</p>}
        <p className="nl-errstate-p">{message}</p>
      </div>
    </div>
  );
}
