# Mascot Accents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three kawaii pearl-shell logo variants into the frontend as small, nacre-framed accents (empty states, mint success, masthead easter-egg) without breaking the refined "Nacre Light" brand.

**Architecture:** A single `<Mascot>` component owns a "pearl-well" frame + a treatment filter. Hybrid treatment by placement: empty states use nacre-duotone (always-on); the masthead logo becomes a click-to-cycle button using grayscale→colour reveal; the mint-success moment uses full colour + molten glow. Pure presentation layer — zero business-logic changes.

**Tech Stack:** React (function components, hooks), plain CSS (theme.css tokens + App.css/Leaderboard.css), Vite, `node --test` for pure helpers. No new dependencies.

## Global Constraints

- **Pure presentation only.** Branch-wide `git diff` must show `move/`, `scripts/indexer/`, `scripts/integration/`, `frontend/src/api.js`, `frontend/src/mint.js`, `frontend/src/config.js`, and dapp-kit wiring **byte-unchanged**.
- **No new dependencies.** No carousel/animation library, no confetti.
- **Keyframe names are global.** `@keyframes nl-reveal` is already defined in BOTH App.css AND Leaderboard.css (both imported by MyNotes). Reserved — do NOT reuse: `nl-reveal`, `nl-pulse`, `nl-bob`, `nl-draw`, `nl-fillin`, `nl-shimmer`, `nl-drift`, `nl-rise`, `nl-pearl`, `nl-skel-sweep`. New keyframe in this work: `nl-clam-open`. Run `grep -rn '@keyframes' frontend/src/*.css` before adding any.
- **Component root class** = `.nl-pearl-well` (container) + `.nl-mascot-img` (img). Do NOT use `.nl-mascot` — taken by the masthead tagline (App.jsx:118).
- **Reduced-motion:** extend the EXISTING `@media (prefers-reduced-motion: reduce)` block in App.css (~lines 210–221). Do NOT add a second block. Verify with `grep -c 'prefers-reduced-motion' frontend/src/App.css` (must stay 1).
- **Filter on `<img>`, not the well wrapper** (blend overlay must composite against the source image).
- **Assets:** canonical files are `logo_{1,2,3}-clear.png` (transparent). `-ondark.png` are previews, not shipped.

---

### Task 1: Mascot foundation — assets, pure helper, component, pearl-well + treatment CSS

**Files:**
- Create: `frontend/public/logo_1-clear.png`, `frontend/public/logo_2-clear.png`, `frontend/public/logo_3-clear.png` (copied from `docs/logo-clear/`)
- Create: `frontend/src/mascot.js`
- Create: `frontend/src/mascot.test.js`
- Create: `frontend/src/Mascot.jsx`
- Modify: `frontend/src/App.css` (append a `/* ── Mascot ── */` block)

**Interfaces:**
- Produces:
  - `mascotSrc(variant: 1|2|3): string` → `'/logo_1-clear.png'` etc.
  - `treatmentClass(treatment: 'duotone'|'reveal'|'full'): string` → `'nl-mascot-img--duotone'` etc.
  - `<Mascot variant={1|2|3} treatment={'duotone'|'reveal'|'full'} size={number=72} alt={string=''} />` → renders `<span class="nl-pearl-well"><img class="nl-mascot-img nl-mascot-img--<t>" .../></span>`
  - CSS classes: `.nl-pearl-well`, `.nl-mascot-img`, `.nl-mascot-img--duotone`, `.nl-mascot-img--reveal`, `.nl-mascot-img--full`, `.nl-pearl-well--glow`

- [ ] **Step 1: Copy the three PNG assets**

```bash
cd "$(git rev-parse --show-toplevel)"
cp docs/logo-clear/logo_1-clear.png frontend/public/logo_1-clear.png
cp docs/logo-clear/logo_2-clear.png frontend/public/logo_2-clear.png
cp docs/logo-clear/logo_3-clear.png frontend/public/logo_3-clear.png
ls -la frontend/public/logo_*-clear.png
```
Expected: three files listed, each ~120–140 KB.

- [ ] **Step 2: Write the failing test for the pure helper**

Create `frontend/src/mascot.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mascotSrc, treatmentClass } from './mascot.js';

test('mascotSrc maps variant number to the public clear-png path', () => {
  assert.equal(mascotSrc(1), '/logo_1-clear.png');
  assert.equal(mascotSrc(2), '/logo_2-clear.png');
  assert.equal(mascotSrc(3), '/logo_3-clear.png');
});

test('mascotSrc rejects out-of-range / non-integer variants (fail loud, not a 404 src)', () => {
  assert.throws(() => mascotSrc(0), /variant/);
  assert.throws(() => mascotSrc(4), /variant/);
  assert.throws(() => mascotSrc('1'), /variant/);
});

test('treatmentClass maps each treatment to its modifier class', () => {
  assert.equal(treatmentClass('duotone'), 'nl-mascot-img--duotone');
  assert.equal(treatmentClass('reveal'), 'nl-mascot-img--reveal');
  assert.equal(treatmentClass('full'), 'nl-mascot-img--full');
});

test('treatmentClass rejects an unknown treatment (fail loud)', () => {
  assert.throws(() => treatmentClass('sparkly'), /treatment/);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && node --test src/mascot.test.js`
Expected: FAIL — `Cannot find module './mascot.js'`.

- [ ] **Step 4: Write the pure helper**

Create `frontend/src/mascot.js`:

```js
// Pure mapping helpers for the Mascot component. Kept separate so the
// variant→asset and treatment→class logic is unit-testable without a DOM.

const VARIANTS = new Set([1, 2, 3]);
const TREATMENTS = {
  duotone: 'nl-mascot-img--duotone', // empty states — nacre duotone, always on
  reveal: 'nl-mascot-img--reveal',   // masthead — grayscale at rest, colour on hover/focus
  full: 'nl-mascot-img--full',       // mint success — full colour peak
};

export function mascotSrc(variant) {
  if (!VARIANTS.has(variant)) throw new Error(`mascot: bad variant ${variant} (expected 1|2|3)`);
  return `/logo_${variant}-clear.png`;
}

export function treatmentClass(treatment) {
  const cls = TREATMENTS[treatment];
  if (!cls) throw new Error(`mascot: unknown treatment ${treatment}`);
  return cls;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && node --test src/mascot.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the `<Mascot>` component**

Create `frontend/src/Mascot.jsx`:

```jsx
import { mascotSrc, treatmentClass } from './mascot.js';

/**
 * Pearl-well-framed kawaii mascot. The well tones the raster toward the brand;
 * `treatment` selects the filter (duotone / reveal / full). Decorative by default
 * (alt=''): meaning is carried by adjacent copy.
 */
export default function Mascot({ variant, treatment, size = 72, glow = false, alt = '' }) {
  return (
    <span className={`nl-pearl-well${glow ? ' nl-pearl-well--glow' : ''}`}
      style={{ '--mascot-size': `${size}px` }}>
      <img
        className={`nl-mascot-img ${treatmentClass(treatment)}`}
        src={mascotSrc(variant)}
        width={size} height={size}
        loading="eager" decoding="async" alt={alt}
      />
    </span>
  );
}
```

- [ ] **Step 7: Append the Mascot CSS block to App.css**

Append to `frontend/src/App.css`:

```css
/* ── Mascot (kawaii pearl-shell accents) ─────────────────────────────────────
   Single source of truth for the pearl-well frame + treatments. The well is QUIET
   at rest (no molten halo); molten glow is reserved for the mint-success peak. */
.nl-pearl-well {
  --mascot-size: 72px;
  position: relative; display: inline-grid; place-items: center;
  width: calc(var(--mascot-size) + 32px); height: calc(var(--mascot-size) + 32px);
  border-radius: 50%; overflow: hidden;
  background: radial-gradient(circle at 38% 32%, #fff 0%, #f3ecf5 55%, #e7dcef 100%);
  box-shadow: inset 0 1px 3px rgba(58,51,64,.10),
              inset 0 -6px 14px rgba(160,140,180,.12),
              0 1px 2px rgba(58,51,64,.06);
}
/* nacre tint overlay — stains duotone shells into the palette (above img in paint order) */
.nl-pearl-well::after {
  content: ""; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle at 50% 45%, rgba(216,206,242,0), rgba(216,206,242,.30) 70%, rgba(201,193,232,.42));
  mix-blend-mode: color; opacity: 0; /* only duotone turns it on, see below */
}
.nl-pearl-well:has(.nl-mascot-img--duotone)::after { opacity: 1; }

.nl-mascot-img {
  width: var(--mascot-size); height: var(--mascot-size); object-fit: contain; display: block;
  /* mask away the raster's baked-in bottom drop-shadow into the well floor */
  -webkit-mask-image: linear-gradient(to bottom, #000 84%, transparent 100%);
  mask-image: linear-gradient(to bottom, #000 84%, transparent 100%);
}
.nl-mascot-img--duotone { filter: saturate(.5) contrast(.97) brightness(1.02) sepia(.14); }
.nl-mascot-img--reveal  { filter: grayscale(1) opacity(.85); transition: filter .45s ease; }
.nl-mascot-img--full    { filter: none; }

/* molten glow — mint-success peak only */
.nl-pearl-well--glow {
  box-shadow: inset 0 1px 3px rgba(58,51,64,.10),
              0 0 0 1px rgba(224,160,60,.35),
              0 6px 22px rgba(224,160,60,.45);
}
```

- [ ] **Step 8: Verify build is green**

Run: `cd frontend && npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 9: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add frontend/public/logo_1-clear.png frontend/public/logo_2-clear.png frontend/public/logo_3-clear.png \
        frontend/src/mascot.js frontend/src/mascot.test.js frontend/src/Mascot.jsx frontend/src/App.css
git commit -m "feat(frontend): Mascot component — pearl-well frame + duotone/reveal/full treatments"
```

---

### Task 2: Empty-state illustrations (MyNotes + Leaderboard) — Treatment B (duotone)

**Files:**
- Modify: `frontend/src/MyNotes.jsx:190`
- Modify: `frontend/src/Leaderboard.jsx:59`
- Modify: `frontend/src/App.css` (add `.nl-empty--illustrated` block)
- Modify: `frontend/src/Leaderboard.css` (top padding so the well clears `overflow:hidden` edge)

**Interfaces:**
- Consumes: `<Mascot>` (Task 1), class `.nl-empty--illustrated`.

- [ ] **Step 1: Replace the MyNotes empty `<p>` with an illustrated figure**

In `frontend/src/MyNotes.jsx`, first add the import near the other component imports at the top of the file:

```jsx
import Mascot from './Mascot.jsx';
```

Then replace line 190:

```jsx
{!loading && !msg && notes.length === 0 && <p className="nl-empty">No notes found.</p>}
```

with:

```jsx
{!loading && !msg && notes.length === 0 && (
  <figure className="nl-empty nl-empty--illustrated">
    <Mascot variant={3} treatment="duotone" size={72} />
    <figcaption>
      <p className="nl-empty-h">No notes yet</p>
      <p className="nl-empty-p">Issue your first Range Note above to see it appear here.</p>
    </figcaption>
  </figure>
)}
```

- [ ] **Step 2: Replace the Leaderboard empty `<p>` with an illustrated figure**

In `frontend/src/Leaderboard.jsx`, add the import near the top:

```jsx
import Mascot from './Mascot.jsx';
```

Then replace line 59:

```jsx
{rows.length === 0 && !msg && !loading && <p className="nl-empty">No settled notes yet.</p>}
```

with:

```jsx
{rows.length === 0 && !msg && !loading && (
  <figure className="nl-empty nl-empty--illustrated">
    <Mascot variant={3} treatment="duotone" size={72} />
    <figcaption>
      <p className="nl-empty-h">Be the first on the Ledger</p>
      <p className="nl-empty-p">No settled notes yet — issuers appear here once their notes settle.</p>
    </figcaption>
  </figure>
)}
```

- [ ] **Step 3: Add the illustrated empty-state CSS to App.css**

Append to `frontend/src/App.css` (App.css is imported by both MyNotes and Leaderboard):

```css
/* illustrated empty state — text-led with a mascot grace note */
.nl-empty--illustrated {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: clamp(40px, 8vh, 72px) 24px; margin: 0;
}
.nl-empty--illustrated .nl-pearl-well { margin-bottom: 20px; }
.nl-empty--illustrated figcaption { display: contents; }
.nl-empty-h {
  font-family: var(--font-display); font-size: 18px; color: var(--pearl);
  letter-spacing: -0.01em; margin: 0;
}
.nl-empty-p {
  font-size: 13px; color: var(--pearl-dim); max-width: 34ch;
  margin: 6px 0 0; line-height: 1.5;
}
```

- [ ] **Step 4: Ensure the Leaderboard card doesn't clip the well**

`.nl-board` has `overflow: hidden`. The `clamp(40px,…)` top padding from Step 3 already keeps the 104px well clear of the `border-radius` edge — no Leaderboard.css change is required for clipping. Confirm by reading `frontend/src/Leaderboard.css` line 1–7 that `.nl-board` padding is not zero; if `.nl-board` has `padding: 0`, add `padding-top: 8px` to `.nl-board` in Leaderboard.css. (Current `.nl-board` has non-zero padding, so this is a no-op check.)

Run: `grep -n 'nl-board {' -A3 frontend/src/Leaderboard.css`
Expected: `.nl-board` has a non-zero `padding`. If so, no edit.

- [ ] **Step 5: Verify build is green and helper tests still pass**

Run: `cd frontend && npm run build && node --test src/mascot.test.js`
Expected: build succeeds; 4 tests pass.

- [ ] **Step 6: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add frontend/src/MyNotes.jsx frontend/src/Leaderboard.jsx frontend/src/App.css frontend/src/Leaderboard.css
git commit -m "feat(frontend): duotone mascot empty states for MyNotes + Leaderboard"
```

---

### Task 3: Mint-success celebration — full colour + molten glow + `nl-clam-open`

**Files:**
- Modify: `frontend/src/App.jsx` (add a `mintPhase === 'done'` block + import)
- Modify: `frontend/src/App.css` (add `nl-clam-open` keyframe, `.nl-mint-celebration`; extend reduced-motion block)

**Interfaces:**
- Consumes: `<Mascot>` (Task 1), existing `mintPhase`/`statusKind` state.

- [ ] **Step 1: Import Mascot into App.jsx**

In `frontend/src/App.jsx`, add after the existing `import Leaderboard ...` line (line 14):

```jsx
import Mascot from './Mascot.jsx';
```

- [ ] **Step 2: Add the celebration block before the status `<pre>`**

In `frontend/src/App.jsx`, immediately BEFORE the `{status && (` block at line 220, insert:

```jsx
{mintPhase === 'done' && statusKind === 'ok' && (
  <div className="nl-mint-celebration" role="status" aria-live="polite">
    <Mascot variant={1} treatment="full" size={88} glow />
    <p className="nl-mint-celebration-cap">Minted — your note is live.</p>
  </div>
)}
```

- [ ] **Step 3: Add the celebration CSS + keyframe to App.css**

Append to `frontend/src/App.css`:

```css
/* mint-success celebration — the single high-saturation moment */
.nl-mint-celebration {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  gap: 10px; margin: 18px 0 4px;
}
.nl-mint-celebration .nl-pearl-well { animation: nl-clam-open 560ms ease-out 1 both; }
.nl-mint-celebration-cap {
  font-family: var(--font-display); font-size: 16px; color: var(--pearl); margin: 0;
}
@keyframes nl-clam-open {
  from { opacity: 0; transform: translateY(6px) scale(.94); }
  to   { opacity: 1; transform: translateY(0)   scale(1); }
}
```

- [ ] **Step 4: Gate the celebration animation under reduced-motion**

In `frontend/src/App.css`, inside the EXISTING `@media (prefers-reduced-motion: reduce)` block (the one containing `.nl-mast-logo { animation: none; }`), add this line:

```css
  .nl-mint-celebration .nl-pearl-well { animation: none; }
```

- [ ] **Step 5: Verify only one reduced-motion block exists**

Run: `grep -c 'prefers-reduced-motion' frontend/src/App.css`
Expected: `1`.

- [ ] **Step 6: Verify build is green**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add frontend/src/App.jsx frontend/src/App.css
git commit -m "feat(frontend): mint-success mascot celebration (full colour + clam-open)"
```

---

### Task 4: Masthead easter-egg — click-to-cycle button + Treatment A reveal

**Files:**
- Modify: `frontend/src/App.jsx` (masthead `<img>` → `<button>` + cycle state)
- Modify: `frontend/src/App.css` (button reset, reveal hover/focus, focus ring, freeze-bob-on-focus; extend reduced-motion)

**Interfaces:**
- Consumes: `mascotSrc` (Task 1) for cycling, existing `.nl-mast-logo` styles.

- [ ] **Step 1: Add the cycle state to App.jsx**

In `frontend/src/App.jsx`, add `mascotSrc` to the existing mint import is NOT needed; instead add a dedicated import after `import Mascot ...` (Task 3 added that line):

```jsx
import { mascotSrc } from './mascot.js';
```

Then add a state hook with the other `useState` calls (after line 30, `const [pending, setPending] = useState(null);`):

```jsx
const MASCOT_CYCLE = [3, 1, 2]; // serene → joyful → showy
const [mascotIdx, setMascotIdx] = useState(0);
```

- [ ] **Step 2: Convert the masthead logo `<img>` to a cycling `<button>`**

In `frontend/src/App.jsx`, replace line 105:

```jsx
<img className="nl-mast-logo" src="/logo-mark.png" alt="" />
```

with:

```jsx
<button type="button" className="nl-mast-logo-btn" aria-label="PearlFoundry"
  onClick={() => setMascotIdx((i) => (i + 1) % MASCOT_CYCLE.length)}>
  <img className="nl-mast-logo"
    src={mascotIdx === 0 ? '/logo-mark.png' : mascotSrc(MASCOT_CYCLE[mascotIdx])}
    alt="" width="80" height="80" />
</button>
```

(Initial render uses the already-cached `/logo-mark.png`; first click swaps to the `/logo_n-clear.png` set. The img keeps ONLY `.nl-mast-logo` — NOT `.nl-mascot-img--reveal` — to avoid a `filter` collision: `.nl-mast-logo` already sets `filter: drop-shadow(...)`, and CSS `filter` is single-valued, so a second `filter` rule would clobber the drop-shadow. The masthead reveal is done with explicit combined-filter rules in Step 3 instead.)

- [ ] **Step 3: Add the button + reveal CSS to App.css**

Append to `frontend/src/App.css`. These masthead-specific rules combine the existing drop-shadow with the grayscale reveal in ONE `filter` value (CSS `filter` is single-valued — both must live in the same declaration):

```css
/* masthead logo as a click-to-cycle easter-egg button (Treatment A reveal) */
.nl-mast-logo-btn {
  appearance: none; background: none; border: none; padding: 0; cursor: pointer;
  border-radius: 50%; line-height: 0; flex: none;
}
.nl-mast-logo-btn .nl-mast-logo {
  display: block;
  filter: drop-shadow(0 12px 20px rgba(227,162,63,.45)) grayscale(1) opacity(.85);
  transition: filter .45s ease;
}
.nl-mast-logo-btn:hover .nl-mast-logo,
.nl-mast-logo-btn:focus-visible .nl-mast-logo {
  filter: drop-shadow(0 12px 20px rgba(227,162,63,.45)) grayscale(0) opacity(1);
}
.nl-mast-logo-btn:focus-visible { outline: 2px solid var(--gold-ink); outline-offset: 4px; }
/* freeze the bob while keyboard-focused so the focus ring doesn't bob */
.nl-mast-logo-btn:focus-visible .nl-mast-logo { animation: none; }
```

(The base `.nl-mast-logo` rule at App.css ~24 still sets `width/height/object-fit/animation: nl-bob` and its own `filter: drop-shadow(...)`. The new `.nl-mast-logo-btn .nl-mast-logo` rule is more specific, so its combined `filter` wins — drop-shadow + grayscale coexist, and the bob animation is untouched.)

- [ ] **Step 4: Gate the reveal transition under reduced-motion**

In `frontend/src/App.css`, inside the EXISTING `@media (prefers-reduced-motion: reduce)` block, add:

```css
  .nl-mast-logo-btn .nl-mast-logo { transition: none; }
```

(The bob is already gated via the existing `.nl-mast-logo { animation: none; }` line in that block. Click still swaps variants instantly — only the filter transition is removed.)

- [ ] **Step 5: Verify only one reduced-motion block + build green**

Run: `cd frontend && grep -c 'prefers-reduced-motion' src/App.css && npm run build`
Expected: prints `1`; build succeeds.

- [ ] **Step 6: Verify the zero-logic invariant (presentation-only)**

Run from repo root:

```bash
git diff --stat $(git merge-base HEAD main)..HEAD -- move scripts frontend/src/api.js frontend/src/mint.js frontend/src/config.js
```
Expected: empty output (no business-logic files changed across the branch).

- [ ] **Step 7: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add frontend/src/App.jsx frontend/src/App.css
git commit -m "feat(frontend): masthead click-to-cycle mascot easter-egg (grayscale reveal)"
```

---

## Verification (whole feature)

- `cd frontend && npm run build` → green.
- `cd frontend && node --test src/*.test.js` → all green (mascot + existing suites).
- `grep -c 'prefers-reduced-motion' frontend/src/App.css` → `1`.
- `grep -rn '@keyframes' frontend/src/*.css` → no duplicate of any reserved name; `nl-clam-open` present once.
- Branch-wide zero-logic invariant (Task 4 Step 6) → empty.
- **Human-deferred (sandbox has no browser-with-wallet):** `cd frontend && npm run dev` and visually confirm: duotone empty states (MyNotes + Leaderboard), masthead grayscale→colour on hover + click-cycle through 3 variants, mint-success full-colour clam-open. Tune treatment filter values by eye if needed. The starting values live in `docs/logo-clear/treatment-compare.html`.
