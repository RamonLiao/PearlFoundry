# Payoff Diagram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a Range Accrual note's payoff curve (payout vs. settlement price) as a preview in the mint card and inside expandable MyNotes rows.

**Architecture:** Pure staircase-math function + a presentational inline-SVG component, consumed in two places. The mint preview gets its ladder/forward/qty from an extended `/quote`; MyNotes gets per-note params from a new backend `/note-params` route (frontend stays read-through-backend, matching the existing convention). Zero contract changes, zero indexer schema changes, no new dependency.

**Tech Stack:** React 18 + Vite (frontend), `@mysten/sui` JSON-RPC `SuiClient` (backend indexer server), `@mysten/dapp-kit-react` 2.x (signing only), Node `node:test` for pure-function tests.

## Global Constraints

- **Presentation-layer only.** No changes to `move/`, contract addresses, dapp-kit signing wiring, or business logic. Verification includes a branch-wide `git diff` confirming `move/` and on-chain constants are byte-unchanged.
- **No new npm dependency.** Inline SVG only — no D3/Recharts/canvas lib.
- **All palette via theme tokens** in `frontend/src/theme.css`. No raw hex in components (mockup hex was sketch-only).
- **WCAG AA** for all chart text: ≥4.5:1 on the white card (`--obsidian-raised: #ffffff`). Tick labels ≥11px.
- **Honor `prefers-reduced-motion`**: components emit no entrance animation by default; any motion gated behind `@media (prefers-reduced-motion: no-preference)`.
- **Fail loud.** Guards throw; never silently clamp. Success claims require the stated verification output.
- **English UI copy.** No Chinese strings in shipped code (mockup captions were sketch-only).
- **BigInt for on-chain integer math.** Oracle ticks are e9 (e.g. `60000_000_000_000`); never use float modulo on them.
- Frontend test runner: `node --test` against `*.test.js` using `node:test` + `node:assert/strict` (matches `scripts/pricing/*.test.js`). Run from repo root.

---

### Task 1: `computePayoffCurve` pure function

**Files:**
- Create: `frontend/src/payoff.js`
- Test: `frontend/src/payoff.test.js`

**Interfaces:**
- Produces: `computePayoffCurve({ lower, upper, step, qtyPerLeg }) -> { legs: number, maxPayout: number, qtyPerLeg: number, strikes: number[], points: Array<{price:number, payout:number}> }`. Inputs accept BigInt | string | number (oracle-tick / base-unit integers). `points` are staircase vertices from the first strike to the last (component adds flat extensions + axis domain). Throws `Error` with a code-ish message on invalid grid.

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/payoff.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePayoffCurve } from './payoff.js';

const T = 1_000_000_000_000n;            // $1k tick for readable numbers
const base = { lower: 60n * T, upper: 66n * T, step: T, qtyPerLeg: 2_000_000n }; // 7 legs

test('legs count = (upper-lower)/step + 1', () => {
  const c = computePayoffCurve(base);
  assert.equal(c.legs, 7);
});

test('maxPayout = qtyPerLeg * legs', () => {
  const c = computePayoffCurve(base);
  assert.equal(c.maxPayout, 7 * 2_000_000);
});

test('payout is monotonic non-decreasing across points', () => {
  const c = computePayoffCurve(base);
  for (let i = 1; i < c.points.length; i++) {
    assert.ok(c.points[i].payout >= c.points[i - 1].payout, `drop at ${i}`);
  }
});

test('each riser steps up by exactly qtyPerLeg', () => {
  const c = computePayoffCurve(base);
  // points come in (bottom,top) pairs per strike; top-bottom == qtyPerLeg
  for (let i = 0; i + 1 < c.points.length; i += 2) {
    assert.equal(c.points[i + 1].payout - c.points[i].payout, 2_000_000);
  }
});

test('first strike payout starts at 0, last reaches maxPayout', () => {
  const c = computePayoffCurve(base);
  assert.equal(c.points[0].payout, 0);
  assert.equal(c.points[c.points.length - 1].payout, c.maxPayout);
  assert.equal(c.strikes.length, 7);
  assert.equal(c.strikes[0], Number(60n * T));
  assert.equal(c.strikes[6], Number(66n * T));
});

test('accepts string and number inputs', () => {
  const c = computePayoffCurve({ lower: '60000000000000', upper: '66000000000000', step: '1000000000000', qtyPerLeg: '2000000' });
  assert.equal(c.legs, 7);
});

// Monkey / fail-loud guards
test('throws on step <= 0', () => {
  assert.throws(() => computePayoffCurve({ ...base, step: 0n }), /step/);
});
test('throws on upper <= lower', () => {
  assert.throws(() => computePayoffCurve({ ...base, upper: 60n * T }), /range/i);
});
test('throws on grid misalignment ((upper-lower) % step != 0)', () => {
  assert.throws(() => computePayoffCurve({ ...base, step: 700_000_000_000n }), /grid|align/i);
});
test('throws on legs > 128', () => {
  assert.throws(() => computePayoffCurve({ lower: 0n, upper: 200n * T, step: T, qtyPerLeg: 1n }), /128|legs/i);
});
test('grid guard uses BigInt (no float precision loss at e9)', () => {
  // (upper-lower) = 6e12, step = 1e12 → exactly 7 legs; a float % would be fine here,
  // but a misaligned e9 grid must still be caught:
  assert.throws(() => computePayoffCurve({ lower: 60_000_000_000_000n, upper: 66_000_000_000_001n, step: 1_000_000_000_000n, qtyPerLeg: 1n }), /grid|align/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/payoff.test.js`
Expected: FAIL — `computePayoffCurve is not a function` / module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/payoff.js
const MAX_LEGS = 128n;

/**
 * Range Accrual payoff = a ladder of long up(strike) binaries: each leg pays
 * qtyPerLeg once settlement > its strike. Payout is a monotonic staircase in
 * settlement price. Mirrors on-chain invariants in strategy_range_accrual.move.
 *
 * @param {{lower: bigint|string|number, upper: bigint|string|number,
 *          step: bigint|string|number, qtyPerLeg: bigint|string|number}} p
 */
export function computePayoffCurve(p) {
  const lower = BigInt(p.lower);
  const upper = BigInt(p.upper);
  const step = BigInt(p.step);
  const qty = BigInt(p.qtyPerLeg);

  if (step <= 0n) throw new Error('payoff: step must be > 0');
  if (upper <= lower) throw new Error('payoff: invalid range (upper <= lower)');
  if ((upper - lower) % step !== 0n) throw new Error('payoff: grid misaligned ((upper-lower) % step != 0)');

  const legsBig = (upper - lower) / step + 1n;
  if (legsBig < 1n) throw new Error('payoff: legs < 1');
  if (legsBig > MAX_LEGS) throw new Error(`payoff: too many legs (${legsBig} > 128)`);

  const legs = Number(legsBig);
  const strikes = [];
  const points = [];
  for (let k = 0n; k < legsBig; k++) {
    const strike = lower + k * step;
    strikes.push(Number(strike));
    const before = qty * k;            // payout just below this strike
    const after = qty * (k + 1n);      // payout once this leg pays
    points.push({ price: Number(strike), payout: Number(before) });
    points.push({ price: Number(strike), payout: Number(after) });
  }
  return {
    legs,
    qtyPerLeg: Number(qty),
    maxPayout: Number(qty * legsBig),
    strikes,
    points,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test frontend/src/payoff.test.js`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/payoff.js frontend/src/payoff.test.js
git commit -m "feat(frontend): computePayoffCurve pure staircase function + tests"
```

---

### Task 2: `computeQtyPerLeg` pure function (server-side fee math)

**Files:**
- Create: `scripts/pricing/qty.js`
- Test: `scripts/pricing/qty.test.js`

**Interfaces:**
- Produces: `computeQtyPerLeg({ notional, feeBps, legs, expiryCount = 1 }) -> bigint`. Mirrors `note_factory.move` exactly: `fee = notional*feeBps/10000` (u128 floor), `net = notional - fee`, `qty = net / (legs*expiryCount)`. Throws if result is 0.

- [ ] **Step 1: Write the failing test**

```js
// scripts/pricing/qty.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQtyPerLeg } from './qty.js';

test('matches on-chain: fee=30bps, net split equally across legs', () => {
  // notional 10 dUSDC = 10_000_000 (6dp); fee = 10_000_000*30/10000 = 30_000; net = 9_970_000
  // legs 7 → qty = floor(9_970_000 / 7) = 1_424_285
  assert.equal(computeQtyPerLeg({ notional: 10_000_000n, feeBps: 30, legs: 7 }), 1_424_285n);
});

test('accepts string/number inputs', () => {
  assert.equal(computeQtyPerLeg({ notional: '10000000', feeBps: '30', legs: '7' }), 1_424_285n);
});

test('fee uses floor division (no rounding up)', () => {
  // notional 1_000_001, fee = floor(1_000_001*30/10000) = floor(3000.003) = 3000
  assert.equal(computeQtyPerLeg({ notional: 1_000_001n, feeBps: 30, legs: 1 }), 997_001n);
});

test('throws when qty would be 0 (dust over too many legs)', () => {
  assert.throws(() => computeQtyPerLeg({ notional: 100n, feeBps: 30, legs: 128 }), /qty|zero/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/pricing/qty.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/pricing/qty.js
// Off-chain mirror of note_factory::mint_begin qty allocation. Keep in lockstep with
// compute_issuance_fee (notional*fee_bps/10000) and ra::qty_per_leg (net/(legs*expiry)).
export function computeQtyPerLeg({ notional, feeBps, legs, expiryCount = 1 }) {
  const n = BigInt(notional);
  const bps = BigInt(feeBps);
  const fee = (n * bps) / 10000n;        // u128 floor, same as Move
  const net = n - fee;
  const total = BigInt(legs) * BigInt(expiryCount);
  const q = net / total;
  if (q <= 0n) throw new Error(`computeQtyPerLeg: zero qty (net=${net}, total=${total})`);
  return q;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/pricing/qty.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pricing/qty.js scripts/pricing/qty.test.js
git commit -m "feat(pricing): computeQtyPerLeg off-chain mirror of mint fee/qty math + tests"
```

---

### Task 3: Extend `/quote` + add `/note-params` backend routes

**Files:**
- Modify: `scripts/indexer/server.js` (the `quote()` function ~line 65-73; add a `/note-params` GET handler ~line 36 alongside `/oracle`)
- Reference (read-only): `scripts/pricing/oracle.js` (`resolveOracle`), `scripts/integration/config.js` (`CFG`), `scripts/pricing/qty.js` (Task 2)

**Interfaces:**
- Consumes: `computeQtyPerLeg` (Task 2); `lad.legs` and `lad.forward` from `computeLadder` (`price.js:32` returns both).
- Produces:
  - `/quote` response gains `forward: string` and `qtyPerLeg: string`.
  - `GET /note-params?note=<id>&asset=<a>&expiry=<ms>` → `{ params: { lower, upper, strike_step, qty_per_leg, legs_per_expiry, expiry_count, hurdle_bps, version }, forward: string|null, settlementPrice: string|null }`. Returns 404-style `{ error, code:'NO_PARAMS' }` if the dynamic field is absent (e.g. note already claimed/deleted).

- [ ] **Step 1: Add `forward` + `qtyPerLeg` to `quote()`**

In `scripts/indexer/server.js`, replace the `quote()` body's return so it reads `fee_bps` from the FactoryConfig and computes qty. Add the import at top of file:

```js
import { computeQtyPerLeg } from '../pricing/qty.js';
import { CFG } from '../integration/config.js';
```

Replace the `return { ladder: ... }` line in `quote()` with:

```js
  // Authoritative fee_bps from FactoryConfig so the preview can't drift from the contract.
  const cfgObj = await client.getObject({ id: CFG, options: { showContent: true } });
  const feeBps = Number(cfgObj.data?.content?.fields?.fee_bps ?? 30);
  const qtyPerLeg = computeQtyPerLeg({ notional, feeBps, legs: lad.legs, expiryCount: 1 });
  return {
    ladder: { lower: lad.lower.toString(), upper: lad.upper.toString(), step: lad.step.toString() },
    forward: lad.forward.toString(),
    qtyPerLeg: qtyPerLeg.toString(),
    oracleId: lad.oracleId, expiry, tx: tx.serialize(),
  };
```

- [ ] **Step 2: Add the `/note-params` GET route**

In the `if (req.method === 'GET')` block of `createServer`, after the `/oracle` handler, add:

```js
        if (p === '/note-params') {
          if (!client || !txdeps) return json(res, 503, { error: 'tx routes not configured', code: 'NO_CLIENT' });
          const note = url.searchParams.get('note');
          const asset = url.searchParams.get('asset') ?? 'BTC';
          const expiry = url.searchParams.get('expiry');
          if (!note || !expiry) return json(res, 400, { error: 'note, expiry required', code: 'BAD_PARAMS' });
          const { resolveOracle } = await import('../pricing/oracle.js');
          const { PKG } = await import('../integration/config.js');
          // RangeParams lives as a dynamic field under the note, keyed by the unit struct note::ParamsKey.
          const dfo = await client.getDynamicFieldObject({
            parentId: note,
            name: { type: `${PKG}::note::ParamsKey`, value: {} },
          });
          const pf = dfo.data?.content?.fields;
          // df value object wraps the stored struct under `.value.fields` (JSON-RPC layout for
          // a struct-valued dynamic field). Fall back to flat fields if the layout differs.
          const rp = pf?.value?.fields ?? pf;
          if (!rp || rp.lower == null) {
            return json(res, 404, { error: 'no params (note may be claimed/deleted)', code: 'NO_PARAMS' });
          }
          const params = {
            version: Number(rp.version), lower: rp.lower, upper: rp.upper,
            strike_step: rp.strike_step, qty_per_leg: rp.qty_per_leg,
            legs_per_expiry: Number(rp.legs_per_expiry), expiry_count: Number(rp.expiry_count),
            hurdle_bps: Number(rp.hurdle_bps),
          };
          // Oracle forward / settlement_price — read raw (NOT fetchOracle, which throws on settled).
          let forward = null, settlementPrice = null;
          try {
            const { oracleId } = await resolveOracle(client, asset, BigInt(expiry));
            const oc = await client.getObject({ id: oracleId, options: { showContent: true } });
            const f = oc.data?.content?.fields;
            settlementPrice = f?.settlement_price ?? null;
            forward = f?.prices?.fields?.forward ?? null;
          } catch (_) { /* oracle may have rolled; forward optional for the chart */ }
          return json(res, 200, { params, forward, settlementPrice });
        }
```

Confirm `PKG` is exported from `scripts/integration/config.js` (it is — used by `scripts/pricing/probe.js`).

- [ ] **Step 3: Calibrate against a live note (runtime-assumption gate, per project SOP)**

Start the server and verify both routes against real testnet data. The dynamic-field JSON-RPC layout (`rp.value.fields` vs flat) is a runtime assumption — confirm it now, do not trust it.

Run (in one shell):
```bash
node scripts/indexer/server.js indexer.db 8787 &
sleep 2
# Pick a live un-claimed note id + its expiry from the indexer:
curl -s 'http://localhost:8787/notes' | head -c 600; echo
# Then, with a real <note>/<expiry> from above:
curl -s 'http://localhost:8787/note-params?note=<NOTE_ID>&asset=BTC&expiry=<EXPIRY_MS>'; echo
kill %1
```
Expected: `/note-params` returns `{ params: { lower, upper, strike_step, qty_per_leg, ... }, forward, settlementPrice }` with numeric strings, NOT `NO_PARAMS`. If the shape differs (e.g. params under a different nesting), fix the `rp` extraction line and re-run before proceeding. Record the confirmed layout in the commit message.

- [ ] **Step 4: Verify existing indexer tests still green**

Run: `node --test scripts/indexer/*.test.js`
Expected: PASS (no regression — routes are additive).

- [ ] **Step 5: Commit**

```bash
git add scripts/indexer/server.js
git commit -m "feat(server): /quote returns forward+qtyPerLeg; add /note-params route (calibrated live)"
```

---

### Task 4: `<PayoffChart>` presentational component + theme tokens

> **Delegation note (`.claude/rules/frontend.md`):** This is a pure presentational component (no API/state/business logic) → preferred Gemini-CLI delegation candidate. The controller may delegate the JSX/SVG authoring to Gemini with this task's spec, then verify against the build gate. Logic/integration Tasks 1-3, 5-6 stay with Claude.

**Files:**
- Create: `frontend/src/PayoffChart.jsx`
- Modify: `frontend/src/theme.css` (add flat chart tokens)

**Interfaces:**
- Consumes: `computePayoffCurve` output (Task 1).
- Produces: `<PayoffChart curve={...} forward={number} settlementPrice={number|null} size={'full'|'compact'} />` — a self-contained inline-SVG React component. No external props beyond these.

- [ ] **Step 1: Add flat chart tokens to `theme.css`**

`--molten` is a gradient and cannot be an SVG `stroke`. Add flat tokens in `:root` (after the existing `--molten` line):

```css
  /* chart (SVG strokes can't consume gradient vars) — flat stops of --molten */
  --molten-start: #f8d27e;
  --molten-end: #e0a03c;
  --chart-axis: var(--hairline);
  --chart-grid: rgba(58, 51, 64, 0.05);
  --chart-tick: var(--ink-faint);   /* #9b8f99, WCAG-corrected */
  --chart-fwd: var(--gold-ink);     /* #9a6a1e, label text ≥4.5:1 */
```

- [ ] **Step 2: Write the component**

```jsx
// frontend/src/PayoffChart.jsx
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
```

- [ ] **Step 3: Verify build is green**

Run: `cd frontend && npm run build`
Expected: `vite build` succeeds, no unresolved import / JSX errors. (No unit test — SVG is visual; build + the live visual gate in Tasks 5-6 cover it.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/PayoffChart.jsx frontend/src/theme.css
git commit -m "feat(frontend): PayoffChart inline-SVG component + chart theme tokens"
```

---

### Task 5: Mint card preview integration (split runMint)

**Files:**
- Modify: `frontend/src/mint.js` (split `runMint` → `prepareMint` + `finalizeMint`)
- Modify: `frontend/src/App.jsx` (mint card: `mintPhase` state machine, render preview + Confirm/Cancel)
- Modify: `frontend/src/App.css` (preview panel layout, cancelled-state note)

**Interfaces:**
- Consumes: `computePayoffCurve` (Task 1), `<PayoffChart>` (Task 4), extended `/quote` (Task 3).
- Produces: `prepareMint({ signExec, sender }) -> { mgr, tx, ladder, forward, qtyPerLeg, expiry }` (PTB1 + quote, PTB2 unsigned). `finalizeMint({ signExec, tx, mgr }) -> { mgr, mintDigest, expiry }` (signs PTB2). Preserves existing `$kind` / `effects.changedObjects` handling verbatim.

- [ ] **Step 1: Split `mint.js`**

Replace the body of `frontend/src/mint.js` (keep imports) with two exported functions, preserving the existing PTB1 extraction and `$kind` error handling exactly:

```js
import { Transaction } from '@mysten/sui/transactions';
import { postTx } from './api.js';

/** Phase 1: create the PredictManager (PTB1) and fetch the mint quote (unsigned PTB2). */
export async function prepareMint({ signExec, sender }) {
  const { tx: cmTxJson } = await postTx('/create-manager-tx', { sender });
  const r1 = await signExec(Transaction.from(cmTxJson));
  if (r1.$kind === 'FailedTransaction') {
    const err = r1.FailedTransaction?.effects?.status?.error;
    throw new Error(`PTB1 failed on-chain: ${err?.message ?? JSON.stringify(err)} — mint NOT completed`);
  }
  const changed = r1.Transaction?.effects?.changedObjects ?? [];
  const mgrObj = changed.find((c) => c.idOperation === 'Created' && c.outputState === 'ObjectWrite');
  if (!mgrObj) {
    throw new Error('PTB1 landed but no Created ObjectWrite found in effects.changedObjects — mint NOT completed. ' +
      `changedObjects=${JSON.stringify(changed)}`);
  }
  const mgr = mgrObj.objectId;
  const { tx, ladder, forward, qtyPerLeg, expiry } = await postTx('/quote', { sender, mgr });
  return { mgr, tx, ladder, forward, qtyPerLeg, expiry };
}

/** Phase 2: sign the mint (PTB2) after the user confirms the payoff preview. */
export async function finalizeMint({ signExec, tx, mgr }) {
  const r2 = await signExec(Transaction.from(tx));
  if (r2.$kind === 'FailedTransaction') {
    const err = r2.FailedTransaction?.effects?.status?.error;
    throw new Error(`PTB2 (mint) failed — manager was created (${mgr}) but note was NOT minted. ` +
      `Error: ${err?.message ?? JSON.stringify(err)}`);
  }
  const mintDigest = r2.Transaction?.digest;
  if (!mintDigest) throw new Error('PTB2 returned no digest — mint status unknown, treat as NOT completed');
  return { mgr, mintDigest };
}
```

- [ ] **Step 2: Wire the `mintPhase` state machine in `App.jsx`**

In the mint card section of `App.jsx`, replace the single `runMint`-on-click handler with the two-phase flow. Add state near the other mint state hooks:

```jsx
import { prepareMint, finalizeMint } from './mint.js';
import { computePayoffCurve } from './payoff.js';
import PayoffChart from './PayoffChart.jsx';

// inside the component:
const [mintPhase, setMintPhase] = useState('idle'); // idle|preparing|confirm|minting|done|cancelled|error
const [preview, setPreview] = useState(null);       // { mgr, tx, ladder, forward, qtyPerLeg, expiry }
const [mintErr, setMintErr] = useState(null);

async function onIssue() {
  setMintErr(null); setMintPhase('preparing');
  try {
    const p = await prepareMint({ signExec, sender: account.address });
    setPreview(p); setMintPhase('confirm');
  } catch (e) { setMintErr(e.message); setMintPhase('error'); }
}
async function onConfirmMint() {
  setMintPhase('minting');
  try {
    await finalizeMint({ signExec, tx: preview.tx, mgr: preview.mgr });
    setMintPhase('done');
  } catch (e) { setMintErr(e.message); setMintPhase('error'); }
}
function onCancelMint() { setMintPhase('cancelled'); }
```

- [ ] **Step 3: Render preview + Confirm/Cancel in the mint card**

In the mint card JSX, render by phase. Confirm uses the existing primary CTA style; Cancel is a ghost button. Build the curve from the preview ladder:

```jsx
{mintPhase === 'confirm' && preview && (() => {
  const curve = computePayoffCurve({
    lower: preview.ladder.lower, upper: preview.ladder.upper,
    step: preview.ladder.step, qtyPerLeg: preview.qtyPerLeg,
  });
  return (
    <div className="nl-preview">
      <p className="nl-cap">Payoff preview — you're about to mint</p>
      <PayoffChart curve={curve} forward={Number(preview.forward)} size="full" />
      <div className="nl-preview-actions">
        <button className="nl-btn" onClick={onCancelMint}>Cancel</button>
        <button className="nl-btn nl-btn--primary" onClick={onConfirmMint}>Confirm Mint</button>
      </div>
    </div>
  );
})()}

{mintPhase === 'cancelled' && (
  <p className="nl-note">Manager kept on-chain (<code>{preview?.mgr?.slice(0, 12)}…</code>) — re-confirm anytime.
    <button className="nl-btn" onClick={onConfirmMint}>Confirm Mint</button></p>
)}
{mintPhase === 'error' && <p className="nl-error">{mintErr}</p>}
{mintPhase === 'minting' && <p className="nl-note">Minting…</p>}
```

Wire the existing "Issue a Note" button's `onClick` to `onIssue` and disable it while `mintPhase` is `preparing`/`minting`.

- [ ] **Step 4: Add preview layout CSS to `App.css`**

```css
.nl-preview { margin-top: 14px; }
.nl-cap { font-family: var(--font-mono); font-size: 11px; letter-spacing: .04em;
  text-transform: uppercase; color: var(--ink-faint); margin: 0 0 8px; }
.nl-preview-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }
.nl-note { font-size: 13px; color: var(--pearl-dim); margin-top: 12px; display: flex; gap: 10px; align-items: center; }
.nl-note code { font-family: var(--font-mono); }
```

- [ ] **Step 5: Verify build + invariant + live visual gate**

```bash
cd frontend && npm run build          # expected: green
cd .. && git diff --stat move/         # expected: NO output (contracts byte-unchanged)
```
Then live visual gate (real browser, per lessons — not ImageMagick): `cd frontend && npm run dev`, connect wallet, click Issue → after PTB1 signs, confirm the payoff chart renders with the gold staircase + nacre fill + forward marker, then Confirm completes the mint. Capture a screenshot via the dev server / playwright; if not found immediately, `git status` the repo root before concluding it's missing (MCP writes to cwd).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/mint.js frontend/src/App.jsx frontend/src/App.css
git commit -m "feat(frontend): mint-card payoff preview between PTB1 and PTB2 (split runMint)"
```

---

### Task 6: MyNotes expandable payoff integration

**Files:**
- Modify: `frontend/src/api.js` (add `getNoteParams`)
- Modify: `frontend/src/MyNotes.jsx` (expandable detail row + compact chart)
- Modify: `frontend/src/MyNotes.css` or the shared table CSS (detail-row styling) — match where `.nl-table`/`.nl-row` live (`Leaderboard.css`); add a small block in `App.css` if MyNotes has no own stylesheet.

**Interfaces:**
- Consumes: `/note-params` (Task 3), `computePayoffCurve` (Task 1), `<PayoffChart>` (Task 4).
- Produces: per-row expand toggle; on expand, fetch params and render `<PayoffChart size="compact">`. No chart for `state === 'settled'` (claimed → on-chain note deleted).

- [ ] **Step 1: Add `getNoteParams` to `api.js`**

```js
export async function getNoteParams(note, asset, expiry) {
  const r = await fetch(`${API}/note-params?note=${encodeURIComponent(note)}&asset=${encodeURIComponent(asset)}&expiry=${encodeURIComponent(expiry)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'note params lookup failed'); e.code = j.code; throw e; }
  return j; // { params, forward, settlementPrice }
}
```

- [ ] **Step 2: Add expand state + fetch in `MyNotes.jsx`**

Add near the top of the component:

```jsx
import { getNoteParams } from './api.js';
import { computePayoffCurve } from './payoff.js';
import PayoffChart from './PayoffChart.jsx';

const [expanded, setExpanded] = useState(null);     // note_id currently open
const [paramsCache, setParamsCache] = useState({}); // note_id -> { curve, forward, settlementPrice } | { error }

async function toggleExpand(n) {
  if (expanded === n.note_id) { setExpanded(null); return; }
  setExpanded(n.note_id);
  if (paramsCache[n.note_id]) return;
  try {
    const asset = n.strategy || 'BTC';
    const { params, forward, settlementPrice } = await getNoteParams(n.note_id, asset, n.expiry_ts_ms);
    const curve = computePayoffCurve({
      lower: params.lower, upper: params.upper, step: params.strike_step, qtyPerLeg: params.qty_per_leg,
    });
    setParamsCache((c) => ({ ...c, [n.note_id]: {
      curve, forward: forward != null ? Number(forward) : undefined,
      settlementPrice: settlementPrice != null ? Number(settlementPrice) : null } }));
  } catch (e) {
    setParamsCache((c) => ({ ...c, [n.note_id]: { error: e.message } }));
  }
}
```

- [ ] **Step 3: Make rows expandable + render the detail row**

In the `.map` over notes, make the row clickable and append a detail `<tr>`. Only fetch/draw for non-settled (un-claimed) notes; settled shows the payout number only:

```jsx
<tr key={n.note_id} className="nl-row" style={{ '--i': i }} onClick={() => state !== 'settled' && toggleExpand(n)}>
  {/* ...existing cells unchanged... */}
</tr>
{expanded === n.note_id && state !== 'settled' && (
  <tr className="nl-detailrow">
    <td colSpan={4} className="nl-detail">
      {paramsCache[n.note_id]?.error
        ? <p className="nl-error">{paramsCache[n.note_id].error}</p>
        : paramsCache[n.note_id]?.curve
          ? <PayoffChart curve={paramsCache[n.note_id].curve}
              forward={paramsCache[n.note_id].forward}
              settlementPrice={paramsCache[n.note_id].settlementPrice} size="compact" />
          : <p className="nl-note">Loading payoff…</p>}
    </td>
  </tr>
)}
```

(`state === 'settled'` rows render the existing "Settled" label + payout, with no expand affordance.)

- [ ] **Step 4: Add detail-row CSS**

In the stylesheet where `.nl-table` lives (or `App.css`):

```css
.nl-row { cursor: pointer; }
.nl-detailrow .nl-detail { padding: 8px 12px 14px; background: rgba(58, 51, 64, 0.02); }
.nl-detail svg { max-width: 420px; }
```

- [ ] **Step 5: Verify build + invariant + live visual gate**

```bash
cd frontend && npm run build           # expected: green
cd .. && git diff --stat move/ scripts/indexer/db.js   # expected: NO output (no schema/contract change)
```
Live: `cd frontend && npm run dev`, connect a wallet that holds a `pending` or `claimable` note, click the row → compact chart appears; for a `claimable` note confirm the settlement marker shows. Screenshot via dev server.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api.js frontend/src/MyNotes.jsx frontend/src/*.css
git commit -m "feat(frontend): expandable MyNotes rows with compact payoff chart"
```

---

## Self-Review

**Spec coverage:**
- §1 payoff math → Task 1. ✓
- §Components #1 pure fn → Task 1. ✓
- §Components #2 `<PayoffChart>` (nacre fill, gold line, sparse dots, forward gold-ink label w/ flip, structural settlement marker, useId gradients, WCAG ticks, reduced-motion, band-edge verticals, edge states) → Task 4. ✓
- §3 mint flow split + Confirm/Cancel hierarchy + cancelled-manager affordance → Task 5. ✓
- §4 `/quote` + `forward`/`qtyPerLeg` (server-side authoritative fee) → Tasks 2+3. ✓
- §5 MyNotes backend-route read + state-guard (no chart for claimed) + raw oracle read for settlement → Tasks 3+6. ✓
- §Testing pure-fn tests + build/invariant gate + live visual gate → Tasks 1,2,5,6. ✓
- §Design-review decisions (all C/I/M items) → mapped into Tasks 3-6 inline. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. Calibration step (Task 3 Step 3) requires a real note id — this is a runtime gate, not a placeholder; the command shows how to obtain it.

**Type consistency:** `prepareMint`/`finalizeMint` return shapes match Task 5 consumption. `/note-params` `params` field names (`lower`, `upper`, `strike_step`, `qty_per_leg`) match `computePayoffCurve` inputs via Task 6's mapping (`step: params.strike_step`, `qtyPerLeg: params.qty_per_leg`). `computeQtyPerLeg` (Task 2) consumed in Task 3. `<PayoffChart>` props consistent across Tasks 5-6.

**Edge-state note:** Task 4's `payoutAt` recomputes per-leg as `maxPayout/legs`; for a 1-leg note this is `maxPayout`, correct. `legs <= 24` dot gate implemented. Forward-label flip implemented (`fwdRight`).
