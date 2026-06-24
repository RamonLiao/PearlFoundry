# Chart-as-Centerpiece Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the Range Accrual payoff chart to a persistent hero (idle explainer → in-place 2-col live preview with a 6-field metric rail), with a "draw → fill-from-nothing → finite shimmer" entrance, de-AI styling, and a widened layout.

**Architecture:** Presentation-layer only + one backend echo line. New pure modules (`demoCurve.js`, `metricRail.js`) are node-testable; `MetricRail.jsx` and the hero restructure in `App.jsx`/`App.css` consume them. `payoff.js` math, `move/`, and the indexer schema stay byte-unchanged. The chart hero un-gates from the wallet-connect guard so it shows on first paint.

**Tech Stack:** React 18 + Vite, `@mysten/dapp-kit-react` 2.x, plain SVG (no chart lib), Node built-in test runner (`node --test`), Node http indexer server.

## Global Constraints

- **Tests run with `node --test <file>` from the project root.** No frontend test runner exists; testable code MUST live in plain `.js` modules (JSX cannot be imported by `node --test`). Use `node:test` + `node:assert/strict`.
- **dUSDC base units = 6 decimals** (`10000000` = 10.00 dUSDC). Oracle price ticks: human price = `tick / 1e12` (`…k`).
- **`/quote` expiry is a unix timestamp in SECONDS** (e.g. `'1750000000'`); the notes table uses `expiry_ts_ms` in MILLISECONDS. Format defensively (10-digit → ×1000).
- **Nacre Light tokens** (theme.css): `--molten-end #e0a03c`, `--gold-ink #9a6a1e`, `--jade #2c9b6f`, `--pearl #3a3340`, `--pearl-dim #8a7f88`, `--ink-faint #9b8f99`, `--hairline rgba(58,51,64,.09)`, `--font-display` Fraunces, `--font-mono` Martian Mono.
- **Accent budget:** gold is THE accent; jade ONLY for the floor/gain signal; rust ONLY for the forward marker. No 4th hue.
- **Every animation class MUST be added by name to the `prefers-reduced-motion` block** (App.css ~line 174) — there is no wildcard reset.
- **Verification for presentation tasks:** `npx vite build` green (run in `frontend/`) + the branch-wide git-diff invariant (move/, indexer schema, payoff.js, mint.js, api.js unchanged except the single notional echo line).
- Match existing code style: 2-space indent, `nl-` CSS prefix, inline `.nl-li` SVGs with `aria-hidden="true"`.

---

### Task 1: Backend — echo `notional` in the `/quote` response

**Files:**
- Modify: `scripts/indexer/server.js` (the `quote()` return object, ~line 155-161)
- Test: `scripts/indexer/server.test.js`

**Interfaces:**
- Produces: `/quote` JSON now includes `notional: string` (base units, e.g. `'10000000'`). `App.jsx`/`mint.js` consume it in Task 7.

- [ ] **Step 1: Write the failing test** — add to `scripts/indexer/server.test.js`, in the existing `/quote` describe/test area (mirror the existing quote test's setup; it already stubs `txdeps`). Add an assertion to the existing successful-quote test (or a new `test`):

```js
test('/quote echoes notional so the metric rail can show it', async () => {
  const res = await quote(fakeClient, fakeTxdeps, { sender: SENDER, mgr: MGR });
  assert.equal(res.notional, '10000000'); // default notional, base units (10 dUSDC)
});
```

(Reuse the existing `fakeClient`/`fakeTxdeps`/`SENDER`/`MGR` fixtures already in this file — find them near the other `quote(...)` tests. If the existing happy-path test already calls `quote(...)`, just add the `assert.equal(res.notional, '10000000')` line to it instead of a new test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/indexer/server.test.js`
Expected: FAIL — `res.notional` is `undefined`.

- [ ] **Step 3: Add the echo line** — in `scripts/indexer/server.js`, the `quote()` return object. Add `notional` (the function already has `notional` in its destructured params with default `'10000000'`):

```js
  return {
    ladder: { lower: lad.lower.toString(), upper: lad.upper.toString(), step: lad.step.toString() },
    forward: lad.forward.toString(),
    qtyPerLeg: qtyPerLeg.toString(),
    oracleId: lad.oracleId, expiry, tx: tx.serialize(),
    leftover: leftover.toString(),
    notional, // echo the principal so the metric rail can display it
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/indexer/server.test.js`
Expected: PASS (all existing quote tests still green).

- [ ] **Step 5: Commit**

```bash
git add scripts/indexer/server.js scripts/indexer/server.test.js
git commit -m "feat(quote): echo notional in /quote response for the metric rail"
```

---

### Task 2: `demoCurve.js` — canned illustrative curve for the idle hero

**Files:**
- Create: `frontend/src/demoCurve.js`
- Test: `frontend/src/demoCurve.test.js`

**Interfaces:**
- Consumes: `computePayoffCurve` from `./payoff.js`.
- Produces: `export const DEMO_CURVE` (a frozen module const, a `computePayoffCurve` result) and `export const DEMO_FORWARD` (number). Task 5 (PayoffChart `illustrative`) and Task 7 (App idle hero) consume these.

- [ ] **Step 1: Write the failing test** — `frontend/src/demoCurve.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_CURVE, DEMO_FORWARD } from './demoCurve.js';

test('DEMO_CURVE is a valid monotonic staircase with a visible floor and few legs', () => {
  assert.ok(DEMO_CURVE.legs >= 4 && DEMO_CURVE.legs <= 8, 'few legs so the staircase reads clearly');
  assert.ok(DEMO_CURVE.baseline > 0, 'non-zero leftover so the floor tick is visible');
  assert.equal(DEMO_CURVE.maxPayout, DEMO_CURVE.baseline + DEMO_CURVE.qtyPerLeg * DEMO_CURVE.legs);
  // strikes strictly increasing
  for (let i = 1; i < DEMO_CURVE.strikes.length; i++) {
    assert.ok(DEMO_CURVE.strikes[i] > DEMO_CURVE.strikes[i - 1]);
  }
});

test('DEMO_FORWARD sits inside the band so the marker lands on the staircase', () => {
  assert.ok(DEMO_FORWARD > DEMO_CURVE.strikes[0]);
  assert.ok(DEMO_FORWARD < DEMO_CURVE.strikes[DEMO_CURVE.strikes.length - 1]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/demoCurve.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `frontend/src/demoCurve.js`** — reuse the authoritative math so the illustration can never diverge from real payoff shape:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test frontend/src/demoCurve.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/demoCurve.js frontend/src/demoCurve.test.js
git commit -m "feat(hero): demoCurve illustrative payoff for the idle hero state"
```

---

### Task 3: `metricRail.js` — pure formatters for the metric rail

**Files:**
- Create: `frontend/src/metricRail.js`
- Test: `frontend/src/metricRail.test.js`

**Interfaces:**
- Produces: `fmtDusdc(base)`, `fmtBand(loTick, hiTick)`, `fmtExpiry(expiry)`, `fmtPerStep(qty, legs)`. Task 4 (`MetricRail.jsx`) consumes them.

- [ ] **Step 1: Write the failing test** — `frontend/src/metricRail.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDusdc, fmtBand, fmtExpiry, fmtPerStep } from './metricRail.js';

test('fmtDusdc renders base units (6 decimals) as 2dp dUSDC, em-dash on null', () => {
  assert.equal(fmtDusdc(5070000), '5.07');
  assert.equal(fmtDusdc('10000000'), '10.00');
  assert.equal(fmtDusdc(null), '—');
  assert.equal(fmtDusdc(undefined), '—');
});

test('fmtBand shows distinct k-labels even for narrow BTC bands', () => {
  // 62.812k vs 62.827k must not both collapse to 63k
  assert.equal(fmtBand(62812_000000000, 62827_000000000), '62.812k–62.827k');
  assert.equal(fmtBand(62000_000000000, 65000_000000000), '62k–65k');
  assert.equal(fmtBand(null, 1), '—');
});

test('fmtExpiry handles SECONDS (10-digit) and millis, em-dash on bad input', () => {
  // 1750000000 s = 2025-06-15T...; result is a yyyy-mm-dd hh:mm string
  assert.match(fmtExpiry('1750000000'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.match(fmtExpiry(1750000000000), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/); // already ms
  assert.equal(fmtExpiry(null), '—');
  assert.equal(fmtExpiry('not-a-number'), '—');
});

test('fmtPerStep shows +qty × legs', () => {
  assert.equal(fmtPerStep(623125, 16), '+0.62 × 16');
  assert.equal(fmtPerStep(null, 16), '—');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/metricRail.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `frontend/src/metricRail.js`:**

```js
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
  for (let d = 0; d <= 3; d++) if ((lo / 1e12).toFixed(d) !== (hi / 1e12).toFixed(d)) return d;
  return 3;
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
  const iso = new Date(ms).toISOString();
  return iso.slice(0, 16).replace('T', ' ');
}

// per-leg qty (base units) × legs → "+0.62 × 16"
export function fmtPerStep(qty, legs) {
  if (qty == null || legs == null) return EMDASH;
  const q = Number(qty);
  if (!Number.isFinite(q)) return EMDASH;
  return `+${(q / 1e6).toFixed(2)} × ${legs}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test frontend/src/metricRail.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/metricRail.js frontend/src/metricRail.test.js
git commit -m "feat(rail): pure metric-rail formatters (dUSDC, band, expiry seconds/ms, per-step)"
```

---

### Task 4: `MetricRail.jsx` — divided-list rail (NOT boxed cards)

**Files:**
- Create: `frontend/src/MetricRail.jsx`
- Modify: `frontend/src/App.css` (append the `.nl-rail*` rules)

**Interfaces:**
- Consumes: `fmtDusdc, fmtBand, fmtExpiry, fmtPerStep` from `./metricRail.js`; a `curve` (computePayoffCurve result), plus `notional` and `expiry` raw values.
- Produces: `export default function MetricRail({ curve, notional, expiry })`. Task 7 renders it in the live hero state.

- [ ] **Step 1: Write `frontend/src/MetricRail.jsx`** — a single divided list, mixed typography per spec (headline numbers Fraunces, ranges/dates mono), Floor jade with a left-rule as the single accent:

```jsx
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
```

- [ ] **Step 2: Append the rail styles to `frontend/src/App.css`** (divided list, mixed type, jade floor left-rule, 1-col but compact at the fold):

```css
/* ── Metric rail (live hero) — divided list, not boxed cards ───────────────── */
.nl-rail { margin: 0; display: flex; flex-direction: column; }
.nl-rail-row {
  display: flex; flex-direction: column; gap: 2px;
  padding: 12px 0; border-top: 1px solid var(--hairline);
}
.nl-rail-row:first-child { border-top: none; }
.nl-rail-row--floor { padding-left: 12px; border-left: 2px solid var(--jade); }
.nl-rail-label {
  font-family: var(--font-mono); font-size: 11px; text-transform: uppercase;
  letter-spacing: .08em; color: var(--ink-faint);
}
.nl-rail-value--num { font-family: var(--font-display); font-size: 21px; color: var(--pearl); line-height: 1.1; }
.nl-rail-value--mono { font-family: var(--font-mono); font-size: 14px; color: var(--pearl); }
.nl-rail-row--floor .nl-rail-value--num { color: var(--jade); }
```

- [ ] **Step 3: Verify the build**

Run: `cd frontend && npx vite build`
Expected: green (MetricRail compiles; it's not mounted yet — that's Task 7).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/MetricRail.jsx frontend/src/App.css
git commit -m "feat(rail): MetricRail divided-list component + styles"
```

---

### Task 5: `PayoffChart.jsx` — `hero` size, `animated`/`illustrative` props, entrance + finite shimmer

**Files:**
- Modify: `frontend/src/PayoffChart.jsx`
- Modify: `frontend/src/App.css` (animation classes + reduced-motion enumeration)

**Interfaces:**
- Consumes: `curve` (unchanged), plus new optional props.
- Produces: `PayoffChart({ curve, forward, settlementPrice, size, animated = true, illustrative = false })`. `size` accepts `'full' | 'compact' | 'hero'`. Task 7 uses `size="hero"` for the hero chart; MyNotes keeps `size="full"` + must pass `animated={false}`.

- [ ] **Step 1: Add the `hero` size + new props** — in `PayoffChart.jsx`, update the signature and dimension block:

```jsx
export default function PayoffChart({ curve, forward, settlementPrice = null, size = 'full', animated = true, illustrative = false }) {
  const uid = useId();
  const hero = size === 'hero';
  const full = size === 'full' || hero;           // hero shares full's axis/label treatment
  const W = hero ? 640 : full ? 420 : 300;
  const H = hero ? 360 : full ? 250 : 140;
  const padL = full ? 50 : 20, padR = full ? 20 : 14, padT = full ? 30 : 14, padB = full ? 22 : 14;
```

And the `maxWidth` cap (so the hero actually fills its column):

```jsx
      style={{ display: 'block', minWidth: 0, maxWidth: hero ? 'none' : full ? 480 : 420 }}>
```

- [ ] **Step 2: Add animation hooks** — set `anim` class flags from `animated`, and apply classes. The axes/band verticals already render as plain lines (full opacity from frame 0 — leave them). Only the polyline draws and the fill/dots gate in:

  - Add near the top of the component body:
    ```jsx
    const a = animated ? '' : ' nl-noanim'; // suppress when caller wants static (e.g. MyNotes rows)
    ```
  - Gradient element → add the shimmer class:
    ```jsx
    <linearGradient id={`nacre-${uid}`} x1="0" y1="1" x2="1" y2="0" className={`nl-shimmerstops${a}`}>
    ```
  - Fill polygon → gate class:
    ```jsx
    <polygon className={`nl-fillgate${a}`} points={area.join(' ')} fill={`url(#nacre-${uid})`} />
    ```
  - Step line → draw class:
    ```jsx
    <polyline className={`nl-draw${a}`} points={line.join(' ')} fill="none" stroke="var(--molten-end)" strokeWidth={full ? 2.4 : 2} strokeLinejoin="round" />
    ```
  - Wrap the strike dots in a gated group:
    ```jsx
    {showDots && (
      <g className={`nl-dotgate${a}`}>
        {strikes.map((s, k) => (
          <circle key={k} cx={px(s)} cy={py(baseline + qtyPerLeg * (k + 1))} r={full ? 2.6 : 2} fill="var(--molten-end)" />
        ))}
      </g>
    )}
    ```

- [ ] **Step 3: `illustrative` aria override** — replace the `aria-label` expression so the idle demo chart never announces fabricated dUSDC figures:

```jsx
      aria-label={illustrative
        ? 'Illustrative Range Accrual payoff shape — connect a wallet and quote for your own numbers.'
        : `Payoff: ${baseline > 0 ? `floor ${fmt(baseline)} ` : ''}below ${fmt(lo)}, rising in steps to ${fmt(maxPayout)} at ${fmt(hi)}.${forward != null ? ` Forward ${fmt(forward)}.` : ''}${settlementPrice != null ? ` Settled at ${fmt(settlementPrice)}.` : ''}`}
```

- [ ] **Step 4: Add the animation CSS to `frontend/src/App.css`** (entrance + finite low-amplitude shimmer; the `nl-noanim` modifier and the reduced-motion block both force the static end-state):

```css
/* ── Payoff chart entrance + finite shimmer ───────────────────────────────── */
/* line draws left→right first; fill + dots are absent until it finishes (from-nothing reveal) */
.nl-draw { stroke-dasharray: 1600; stroke-dashoffset: 1600; animation: nl-draw 1100ms ease forwards; }
@keyframes nl-draw { to { stroke-dashoffset: 0; } }
.nl-fillgate, .nl-dotgate { opacity: 0; animation: nl-fillin 700ms ease 1100ms forwards; }
@keyframes nl-fillin { to { opacity: 1; } }
/* shimmer = low-amplitude stop-opacity sweep, FINITE (3 loops) then settles. Staggered per stop
   so it reads as a sweep, not a synchronized pulse. Starts after the fill is in (1.8s). */
.nl-shimmerstops stop { animation: nl-shimmer 2200ms ease-in-out 1800ms 3 forwards; }
.nl-shimmerstops stop:nth-child(2) { animation-delay: 1950ms; }
.nl-shimmerstops stop:nth-child(3) { animation-delay: 2100ms; }
.nl-shimmerstops stop:nth-child(4) { animation-delay: 2250ms; }
@keyframes nl-shimmer { 0%, 100% { stop-opacity: var(--s0); } 50% { stop-opacity: var(--s1); } }
/* static override: caller opted out (compact rows) */
.nl-noanim { animation: none !important; stroke-dashoffset: 0 !important; opacity: 1 !important; }
```

  Note: the existing `<stop>` elements have inline `stopOpacity` (e.g. `0.12`, `0.30`, `0.40`, `0.45`). The keyframe references `--s0/--s1` per stop; add CSS custom props OR simplify by animating opacity within a fixed small band. **Simplest robust approach:** drop the per-stop `--s0/--s1` indirection and instead animate a low-amplitude multiply on the whole `<polygon>` via a separate class — BUT keep it finite. Replace the shimmer block above with this self-contained version (no inline-stop coupling):

```css
.nl-shimmerstops { /* marker only; shimmer applied to the fill polygon below */ }
.nl-fillgate {
  opacity: 0;
  animation: nl-fillin 700ms ease 1100ms forwards, nl-shimmer 2200ms ease-in-out 1900ms 3;
}
@keyframes nl-shimmer { 0%, 100% { filter: saturate(1); } 50% { filter: saturate(1.18) brightness(1.04); } }
```

  (Use this second, simpler version — it needs no custom props and the `nl-noanim`/reduced-motion `animation:none` already neutralizes it. The `nl-shimmerstops` class stays as an inert marker so the JSX hook is harmless.)

- [ ] **Step 5: Enumerate the new classes in the reduced-motion block** — extend the existing `@media (prefers-reduced-motion: reduce)` block (App.css ~line 174). Add this line inside it:

```css
  .nl-draw, .nl-fillgate, .nl-dotgate { animation: none !important; stroke-dashoffset: 0 !important; opacity: 1 !important; }
```

- [ ] **Step 6: Keep MyNotes static** — in `frontend/src/MyNotes.jsx:184`, add `animated={false}` to the inline `<PayoffChart … size="full" />` so dense table rows don't animate:

```jsx
                            ? <PayoffChart curve={paramsCache[n.note_id].curve}
                                forward={...} settlementPrice={paramsCache[n.note_id].settlementPrice}
                                size="full" animated={false} />
```

(Preserve the existing `forward`/other props exactly — only append `animated={false}`.)

- [ ] **Step 7: Verify the build**

Run: `cd frontend && npx vite build`
Expected: green. Also re-run `node --test frontend/src/payoff.test.js` → still 16/16 (chart math untouched).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/PayoffChart.jsx frontend/src/App.css frontend/src/MyNotes.jsx
git commit -m "feat(chart): hero size + entrance/finite-shimmer animation + illustrative aria; MyNotes stays static"
```

---

### Task 6: `App.css` — widen container, hero surface, asymmetric 2-col grid, molten button

**Files:**
- Modify: `frontend/src/App.css`

**Interfaces:**
- Produces: the `.nl-hero*` grid + surface classes and the restyled `.nl-btn--primary` that Task 7's JSX uses.

- [ ] **Step 1: Widen the app container** — `.nl-app` max-width 760 → 1040 with a fluid gutter:

```css
.nl-app {
  max-width: 1040px;
  margin: 40px auto 64px;
  padding: 0 clamp(16px, 5vw, 40px);
  position: relative;
  z-index: 1;
}
```

- [ ] **Step 2: Hero surface + asymmetric grid** — append to `App.css`. The hero gets a distinct, larger surface (radius 28, pad ~38) than the secondary cards (which keep 22/26); chart column is the wider one and the rail/copy top-align:

```css
/* ── Hero (chart-as-centerpiece) ──────────────────────────────────────────── */
.nl-hero {
  background: var(--obsidian-raised); border: 1px solid var(--hairline);
  border-radius: 28px; padding: clamp(24px, 4vw, 38px); margin-top: 24px;
  box-shadow: var(--shadow); position: relative; overflow: hidden;
}
.nl-hero::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 3px; background: var(--nacre); opacity: .6; }
.nl-hero-grid {
  display: grid; grid-template-columns: 1.6fr 1fr; gap: clamp(32px, 4vw, 56px);
  align-items: start; /* rail/copy top-align to the chart's plot area */
}
.nl-hero-chart { min-width: 0; }
.nl-hero-side { display: flex; flex-direction: column; gap: 18px; }
.nl-hero-explain { font-size: 14px; line-height: 1.5; color: var(--pearl-dim); margin: 0; }
.nl-hero-explain b { color: var(--pearl); }
/* idle concept rows — inline definition rows, NOT boxed cards (one card pattern max per viewport) */
.nl-concepts { display: flex; flex-direction: column; }
.nl-concept { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--hairline); }
.nl-concept:first-child { border-top: none; }
.nl-concept .nl-li { width: 16px; height: 16px; color: var(--gold-ink); flex: none; }
.nl-concept-term { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-faint); }
.nl-concept-val { font-size: 13px; color: var(--pearl); margin-left: auto; }
.nl-hero-cap { font-family: var(--font-mono); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-faint); margin: 0 0 10px; }
@media (max-width: 720px) {
  .nl-hero-grid { grid-template-columns: 1fr; } /* fold: chart on top, side below */
}
```

- [ ] **Step 3: Restyle the primary button** — solid molten gold, dark plum text (computed 6.7:1, passes), inner highlight + tinted shadow for material; drop the pink candy gradient:

```css
.nl-btn--primary {
  color: #3d1a28; background: var(--molten-end); border: none; border-radius: 999px;
  font-weight: 700; text-transform: none; letter-spacing: 0; font-size: 13px;
  padding: 14px 27px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.4), 0 14px 26px -12px rgba(224,160,60,.7);
  display: inline-flex; align-items: center;
  transition: transform .15s ease, box-shadow .15s ease;
}
.nl-btn--primary:hover:not(:disabled) { transform: translateY(-3px) scale(1.03); box-shadow: inset 0 1px 0 rgba(255,255,255,.4), 0 22px 38px -14px rgba(224,160,60,.85); }
.nl-btn--primary:active:not(:disabled) { transform: translateY(-1px) scale(1.02); }
.nl-btn--primary:disabled { opacity: 0.55; }
```

- [ ] **Step 4: Remove the now-unused `--pinkgold` token IF no caller remains**

Run: `grep -rn "pinkgold" frontend/src`
Expected: only the `theme.css` definition (the `.nl-btn--primary` use is gone). If so, delete the `--pinkgold:` line in `theme.css`. If any other caller remains, leave it and note it.

- [ ] **Step 5: Verify the build**

Run: `cd frontend && npx vite build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.css frontend/src/theme.css
git commit -m "style(hero): widen container to 1040, hero surface + asymmetric grid, solid molten primary button"
```

---

### Task 7: `App.jsx` — hero restructure (un-gate, idle/live states, wire it all, glyph→SVG)

**Files:**
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: `DEMO_CURVE`, `DEMO_FORWARD` (Task 2); `MetricRail` (Task 4); `PayoffChart` `size="hero"` + `illustrative` (Task 5); `.nl-hero*`, `.nl-btn--primary` (Task 6).

- [ ] **Step 1: Thread `notional` through `mint.js`** — `quoteMint` currently drops it. Update both the destructure and the return in `frontend/src/mint.js` `quoteMint()` so `preview.notional` reaches the rail:

```js
export async function quoteMint({ sender, mgr }) {
  const { tx, ladder, forward, qtyPerLeg, expiry, leftover, notional } = await postTx('/quote', { sender, mgr });
  return { mgr, tx, ladder, forward, qtyPerLeg, expiry, leftover, notional };
}
```

(`prepareMint` returns `quoteMint(...)` so it inherits `notional` automatically — no other change.)

- [ ] **Step 2: Add imports** — top of `App.jsx`:

```jsx
import MetricRail from './MetricRail.jsx';
import { DEMO_CURVE, DEMO_FORWARD } from './demoCurve.js';
```

- [ ] **Step 3: Lift the hero OUT of the `{account && (…)}` guard.** Restructure the render so the hero (idle explainer) renders for everyone, including `account == null`. The current tree wraps the whole `<section className="nl-card">` + MyNotes inside `{account && (<>…</>)}` (App.jsx:117-201). Change to: render the **hero section unconditionally**, then render `{account && <MyNotes …/>}` and the pending-resume block only when connected.

  Replace the `Issue a Note` `<section>` with a hero `<section className="nl-hero nl-section" style={{ '--i': 2 }}>` containing the 2-col grid. The grid's left column is always the chart; the right column swaps by state. Use this structure:

```jsx
      {/* HERO — chart-as-centerpiece. Renders for everyone (idle explainer); the right column
          becomes the live metric rail once a quote exists. */}
      <section className="nl-hero nl-section" style={{ '--i': 2 }}>
        {mintPhase === 'confirm' && preview ? (() => {
          const curve = computePayoffCurve({
            lower: preview.ladder.lower, upper: preview.ladder.upper,
            step: preview.ladder.step, qtyPerLeg: preview.qtyPerLeg,
            leftover: preview.leftover ?? 0,
          });
          const heroKey = `${preview.ladder.lower}-${preview.ladder.upper}-${preview.ladder.step}`;
          return (
            <>
              <p className="nl-hero-cap">Payoff preview — you&apos;re about to mint</p>
              <div className="nl-hero-grid">
                <div className="nl-hero-chart">
                  <PayoffChart key={heroKey} curve={curve} forward={Number(preview.forward)} size="hero" />
                </div>
                <div className="nl-hero-side">
                  <MetricRail curve={curve} notional={preview.notional} expiry={preview.expiry} />
                  <div className="nl-preview-actions">
                    <button className="nl-btn" onClick={onCancelMint}>Cancel</button>
                    <button className="nl-btn nl-btn--primary" disabled={mintPhase === 'minting'} onClick={onConfirmMint}>Confirm Mint</button>
                  </div>
                </div>
              </div>
            </>
          );
        })() : (
          <div className="nl-hero-grid">
            <div className="nl-hero-chart">
              <PayoffChart key="demo" curve={DEMO_CURVE} forward={DEMO_FORWARD} size="hero" illustrative />
            </div>
            <div className="nl-hero-side">
              <h2 className="nl-card__title">
                <span className="nl-ico">
                  <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 9c2-2.6 4-2.6 6 0s4 2.6 6 0 4-2.6 6 0" />
                    <path d="M2 15c2-2.6 4-2.6 6 0s4 2.6 6 0 4-2.6 6 0" />
                  </svg>
                </span>
                Issue a Range Note
              </h2>
              <p className="nl-hero-explain">
                Below the band you reclaim a <b>floor</b>. Each strike the price clears adds a
                step. Clear the whole band and you collect the <b>max payout</b>.
              </p>
              <div className="nl-concepts">
                <div className="nl-concept"><svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 14l5-5 4 4 7-7" stroke-linecap="round" stroke-linejoin="round"/></svg><span className="nl-concept-term">Direction</span><span className="nl-concept-val">Long · up-ladder</span></div>
                <div className="nl-concept"><svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 18h18M5 18V9m4 9V6m4 12v-7m4 7V8" stroke-linecap="round"/></svg><span className="nl-concept-term">Floor</span><span className="nl-concept-val">leftover premium</span></div>
                <div className="nl-concept"><svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2" stroke-linecap="round" stroke-linejoin="round"/></svg><span className="nl-concept-term">Settles</span><span className="nl-concept-val">self · soulbound</span></div>
              </div>
              {account ? (
                <div className="nl-issue-row">
                  <div className="nl-pill"><span className="nl-pill__dot" />{account.address.slice(0, 10)}…{account.address.slice(-6)}</div>
                  <button className="nl-btn nl-btn--primary"
                    disabled={busy || !!pending || mintPhase === 'preparing' || mintPhase === 'minting'}
                    onClick={onIssue} aria-busy={mintPhase === 'preparing'}
                    title={pending ? 'Resolve the pending mint below first' : undefined}>
                    <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3.5c.4 3.8 1.7 5.1 5.5 5.5-3.8.4-5.1 1.7-5.5 5.5-.4-3.8-1.7-5.1-5.5-5.5 3.8-.4 5.1-1.7 5.5-5.5Z" />
                    </svg>
                    {mintPhase === 'preparing' ? 'Preparing…' : 'Mint Range Note'}
                  </button>
                </div>
              ) : (
                <button className="nl-btn nl-btn--primary" disabled title="Connect your wallet in the header to mint">Connect to mint</button>
              )}
            </div>
          </div>
        )}

        {/* resume / status / error feedback — unchanged logic, now inside the hero section */}
        {account && pending && mintPhase !== 'confirm' && mintPhase !== 'preparing' && mintPhase !== 'minting' && (
          <div className="nl-resume">
            <p className="nl-note">A manager from an earlier session is waiting (<code>{pending.mgr.slice(0, 12)}…</code>) — its mint never finished. Resume to re-quote and complete it, or discard to ignore it.</p>
            <div className="nl-preview-actions">
              <button className="nl-btn" onClick={onDiscardPending}>Discard</button>
              <button className="nl-btn nl-btn--primary" onClick={onResume}>Resume mint</button>
            </div>
          </div>
        )}
        {mintPhase === 'cancelled' && (
          <p className="nl-note">Manager kept on-chain (<code>{preview?.mgr?.slice(0, 12)}…</code>) — re-confirm anytime.
            <button className="nl-btn" disabled={mintPhase === 'minting'} onClick={onConfirmMint}>Confirm Mint</button></p>
        )}
        {mintPhase === 'error' && <p className="nl-error">{mintErr}</p>}
        {mintPhase === 'minting' && <p className="nl-note">Minting…</p>}
        {status && (
          <pre className={`nl-status ${statusKind === 'ok' ? 'nl-status--ok' : 'nl-status--err'}`}>
            {statusKind === 'ok' && (
              <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}><path d="M4 12l5 5L20 6" /></svg>
            )}{status}
            {txUrl && <>{'\n'}<a className="nl-txlink" href={txUrl} target="_blank" rel="noreferrer" aria-label="View transaction on explorer (opens in new tab)">{txUrl} <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg></a></>}
          </pre>
        )}
      </section>

      {account && (
        <div className="nl-section" style={{ '--i': 3 }}>
          <MyNotes account={account} signExec={signExec} />
        </div>
      )}
```

  Delete the old `<section className="nl-card">…</section>` and the old `{account && (<>…</>)}` wrapper around it + MyNotes. Keep `Sea`, masthead, mascot, and Leaderboard exactly as they are (Leaderboard already renders for everyone).

- [ ] **Step 4: Glyph→SVG sanity** — confirm the old `✓ ` text literal in `.nl-status` (was `{statusKind === 'ok' ? '✓ ' : ''}`) and the `↗` in the txlink are both gone, replaced by the inline SVGs above. `grep -n "✓\|↗" frontend/src/App.jsx` → expect no matches.

- [ ] **Step 5: Verify the build + tests**

Run: `cd frontend && npx vite build` → green.
Run (from root): `node --test frontend/src/payoff.test.js frontend/src/demoCurve.test.js frontend/src/metricRail.test.js` → all PASS.

- [ ] **Step 6: Branch-diff invariant check** (encode "this is a presentation migration")

Run: `git diff main --stat -- move/ scripts/pricing/ frontend/src/payoff.js frontend/src/api.js`
Expected: EMPTY (these are byte-unchanged). The only non-presentation diffs in the whole branch are: `scripts/indexer/server.js` (single `notional` echo line) and `frontend/src/mint.js` (threading `notional` through `quoteMint`). If anything else changed, STOP and reconcile.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.jsx frontend/src/mint.js
git commit -m "feat(hero): restructure Issue card into chart-as-centerpiece hero (un-gated idle + live 2-col + metric rail), thread notional, glyph→SVG"
```

---

## Manual / Monkey Verification (after all tasks)

Run `cd frontend && npx vite dev`, then exercise (per project test rule):
- [ ] **First paint, disconnected**: hero renders with the illustrative chart + explainer + "Connect to mint" (disabled). Leaderboard visible. No MyNotes.
- [ ] **Entrance**: line draws → fill+dots appear from nothing → shimmer runs a few loops and settles. No fill visible mid-draw.
- [ ] **reduced-motion** (OS toggle): chart is static, full, legible. No motion anywhere.
- [ ] **Connect → quote**: hero swaps in place to live chart + 6-row rail (Floor jade, mixed type), Cancel/Confirm. Chart fills its column (not a small graphic in dead space).
- [ ] **Narrow viewport (<720px)**: 2-col folds to chart-on-top, side-below; rail rows stay a compact list; MyNotes not pushed absurdly far.
- [ ] **Edge data**: narrow band (band labels still distinct k), leftover 0 (no floor tick, no NaN in rail — but live quotes always have leftover), legs>24 (dots hidden, line still draws).
- [ ] **MyNotes expanded row**: chart still `size="full"` and STATIC (no animation in table rows).
- [ ] **Re-quote**: entrance replays once (stable key), no stutter during `minting`.

## Live (deferred — browser wallet)

Full quote→mint round-trip in a real wallet is deferred per the established sandbox-has-no-wallet pattern; all data paths above are verifiable headless + via dev server without signing.

## Review

- Two-round `dual-review` per project rules: frontend → `sui-frontend` + `frontend-design`/`taste`; the `notional` backend echo is plain JS (generic reviewer fine).
- Final whole-branch opus review — explicitly ask it to check: (a) the idle↔live↔MyNotes integration seams (no dead code, no state that renders nothing), (b) that **every** animation class is in the reduced-motion block, (c) the hero truly un-gated from `account`.
