# MyNotes / Leaderboard UX Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a five-item presentation-only UX polish batch (id truncation, Claim→primary, expanded-row close, load skeleton, mint loader) across the front-end with no business-logic change.

**Architecture:** One new pure helper (`format.js`, TDD-tested) plus surgical JSX/CSS edits to `MyNotes.jsx`, `App.jsx`, `Leaderboard.jsx`, `App.css`, `Leaderboard.css`. All animation is brand-coherent (nacre sweep, rising-pearl dots) and reduced-motion gated by extending the two existing media blocks.

**Tech Stack:** React 18 (function components, hooks), Vite, plain CSS with `theme.css` tokens, `node:test` for the one unit-tested module.

## Global Constraints

- **Presentation-only.** Branch-wide `git diff --stat` MUST show `frontend/src/api.js`, `mint.js`, `config.js`, `payoff.js`, `pendingMint.js`, `dapp-kit.js`, and everything under `scripts/` byte-unchanged.
- **No new dependencies.** Use only what `package.json` already has.
- **Truncation glyph** is `…` (U+2026), same color/weight as the hex (not dimmed).
- **Keyframe `nl-skel-sweep`** — never reuse the name `nl-shimmer` (already defined App.css:187; would clobber the chart shimmer in MyNotes which imports both stylesheets).
- **reduced-motion:** EXTEND the existing blocks (App.css:191, Leaderboard.css:58). Do NOT add new `@media (prefers-reduced-motion: reduce)` blocks.
- **CSS placement:** skeleton bar + `nl-skel-sweep` → `Leaderboard.css` (shared board stylesheet, imported by both `Leaderboard.jsx` and `MyNotes.jsx`). Close-button chip, table-scoped `.nl-btn--primary`, pearl-dot loader, `.sr-only` util → `App.css` (imported by both `App.jsx` and `MyNotes.jsx`).
- **Test runner:** `node --test <file>` from `frontend/`; test files use `import { test } from 'node:test'; import assert from 'node:assert/strict';`.
- **Build gate:** `cd frontend && npx vite build` must stay green after every task.

---

## File Structure

| File | Responsibility | Tasks |
|------|----------------|-------|
| `frontend/src/format.js` | **new** — `shortId(id, head, tail)` pure helper | 1 |
| `frontend/src/format.test.js` | **new** — unit + monkey tests | 1 |
| `frontend/src/MyNotes.jsx` | note-link shortId, Claim→primary, close button, loading state + skeleton | 2,3,4 |
| `frontend/src/App.jsx` | mgr shortId, pearl-dot loader in mint flow | 2,5 |
| `frontend/src/Leaderboard.jsx` | issuer shortId, skeleton tbody | 2,4 |
| `frontend/src/App.css` | close-button chip, table-scoped primary, pearl-dot loader, `.sr-only`, reduced-motion extend | 3,4,5 |
| `frontend/src/Leaderboard.css` | skeleton bar + `nl-skel-sweep`, reduced-motion extend | 4 |

---

### Task 1: `shortId` helper (TDD)

**Files:**
- Create: `frontend/src/format.js`
- Test: `frontend/src/format.test.js`

**Interfaces:**
- Produces: `shortId(id: string, head = 6, tail = 4): string` — returns `0x1a2b…cd34`; `''` for null/empty/non-string; the input unchanged when `id.length <= head + tail`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/format.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortId } from './format.js';

// 66-char normalized id: 0x + 64 hex
const FULL = '0x' + '1a2b3c4d'.repeat(8); // length 66

test('shortId truncates a normalized id to head…tail', () => {
  assert.equal(shortId(FULL), '0x1a2b…4d4d');           // head 6, tail 4
});

test('shortId default byte-identity vs slice(0,6)…slice(-4)', () => {
  assert.equal(shortId(FULL), `${FULL.slice(0, 6)}…${FULL.slice(-4)}`);
});

// THE BUG THIS FIXES: a left-zero-padded id renders all-zeros under slice(0,12);
// head…tail keeps the meaningful tail bytes visible.
test('shortId on a zero-padded id still shows the tail (the slice(0,12) bug)', () => {
  const padded = '0x' + '0'.repeat(60) + 'dead'; // length 66, tail = "dead"
  const out = shortId(padded);
  assert.equal(out, '0x0000…dead');
  assert.ok(out.endsWith('dead'), 'tail bytes must survive truncation');
});

test('shortId custom head/tail matches Leaderboard issuer slicing byte-for-byte', () => {
  assert.equal(shortId(FULL, 8, 4), `${FULL.slice(0, 8)}…${FULL.slice(-4)}`);
});

// monkey: degenerate inputs must never throw and never emit a bare "…"
test('shortId returns empty string for null/undefined/empty/non-string', () => {
  assert.equal(shortId(null), '');
  assert.equal(shortId(undefined), '');
  assert.equal(shortId(''), '');
  assert.equal(shortId(12345), '');
});

test('shortId returns short input unchanged (no negative-index surprise)', () => {
  assert.equal(shortId('0xabcd'), '0xabcd'); // length 6 <= 6+4
  assert.equal(shortId('0x', 6, 4), '0x');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/format.test.js`
Expected: FAIL — `Cannot find module './format.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/format.js`:

```js
/**
 * shortId — truncate a Sui object id / address to `head…tail`, e.g. "0x1a2b…cd34".
 *
 * Why head…tail (not slice(0,N)): ids normalize to 0x + 64 hex and numerically small
 * ids are left-zero-padded, so a leading slice renders "0x0000000000…" — all zeros, no
 * signal. The tail end is always the meaningful bytes.
 *
 * @param {unknown} id
 * @param {number} [head=6] leading chars to keep (includes the "0x")
 * @param {number} [tail=4] trailing chars to keep
 * @returns {string} truncated id, or '' for null/empty/non-string input
 */
export function shortId(id, head = 6, tail = 4) {
  if (typeof id !== 'string' || id.length === 0) return '';
  if (id.length <= head + tail) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/format.test.js`
Expected: PASS — 6 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/format.js frontend/src/format.test.js
git commit -m "feat(format): shortId head…tail truncation helper (+monkey tests)"
```

---

### Task 2: Apply `shortId` at all id call sites (item ③)

**Files:**
- Modify: `frontend/src/MyNotes.jsx` (note link, currently line ~151)
- Modify: `frontend/src/App.jsx` (pending.mgr ~line 193, preview.mgr ~line 201)
- Modify: `frontend/src/Leaderboard.jsx` (issuer ~line 86)

**Interfaces:**
- Consumes: `shortId` from Task 1.

- [ ] **Step 1: MyNotes — import and use shortId on the note link**

In `frontend/src/MyNotes.jsx`, add to the existing import group near the top:

```js
import { shortId } from './format.js';
```

Replace the note-link text `{n.note_id.slice(0, 12)}…` with `{shortId(n.note_id)}`. The full line becomes:

```jsx
<a className="nl-hashlink" href={`${EXPLORER_OBJ}${n.note_id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{shortId(n.note_id)}</a>
```

- [ ] **Step 2: App.jsx — use shortId on both manager-id displays**

In `frontend/src/App.jsx`, add to the imports:

```js
import { shortId } from './format.js';
```

Replace the pending-manager `<code>` content `{pending.mgr.slice(0, 12)}…` with `{shortId(pending.mgr)}`:

```jsx
<code>{shortId(pending.mgr)}</code>
```

Replace the cancelled-manager `<code>` content `{preview?.mgr?.slice(0, 12)}…` with `{shortId(preview?.mgr)}`:

```jsx
<code>{shortId(preview?.mgr)}</code>
```

(`shortId` is null-safe, so `preview?.mgr` being `undefined` yields `''`.)

- [ ] **Step 3: Leaderboard.jsx — use shortId on issuer (head 8, tail 4)**

In `frontend/src/Leaderboard.jsx`, add to the imports:

```js
import { shortId } from './format.js';
```

Replace `{(r.issuer ?? '').slice(0, 8)}…{(r.issuer ?? '').slice(-4)}` with `{shortId(r.issuer, 8, 4)}`. The cell becomes:

```jsx
<td className="nl-td nl-issuer" title={r.issuer}>
  {shortId(r.issuer, 8, 4)}
  {isYou && <span className="nl-you">YOU</span>}
</td>
```

Output is byte-identical for normalized 66-char addresses; null issuer now renders `''` instead of a bare `…` (intended improvement, see spec M1).

- [ ] **Step 4: Build to verify no regression**

Run: `cd frontend && npx vite build`
Expected: green (built modules, no errors).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/MyNotes.jsx frontend/src/App.jsx frontend/src/Leaderboard.jsx
git commit -m "refactor(ui): truncate all on-chain ids via shortId head…tail (fixes padded 0x000…)"
```

---

### Task 3: Claim→primary + table-scoped button + expanded-row close (items ① and ②)

**Files:**
- Modify: `frontend/src/MyNotes.jsx` (Claim button className; detail-row close button)
- Modify: `frontend/src/App.css` (table-scoped `.nl-btn--primary`; `.nl-detail-close` chip; extend reduced-motion)

**Interfaces:**
- Consumes: existing `setExpanded` state setter and `.nl-detail`/`.nl-btn--primary` styles.

- [ ] **Step 1: MyNotes — promote Claim to primary**

In `frontend/src/MyNotes.jsx`, the Claim button currently has `className="nl-btn"`. Change to:

```jsx
<button
  className="nl-btn nl-btn--primary"
  disabled={isClaiming || !!claiming}
  onClick={(e) => { e.stopPropagation(); claim(n); }}
  aria-busy={isClaiming}
>
  {isClaiming ? 'Claiming…' : 'Claim'}
</button>
```

- [ ] **Step 2: MyNotes — add the close button to the detail row**

In the detail-row `<td className="nl-detail">`, wrap its existing content and add a close button as the first child (so it can position absolutely against the cell). Replace the detail `<td>` block with:

```jsx
<td colSpan={4} className="nl-detail">
  <button
    type="button"
    className="nl-detail-close"
    aria-label="Close payoff"
    onClick={(e) => { e.stopPropagation(); setExpanded(null); }}
  >
    <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  </button>
  {paramsCache[n.note_id]?.error
    ? <p className="nl-error">{paramsCache[n.note_id].error}</p>
    : paramsCache[n.note_id]?.curve
      ? <PayoffChart curve={paramsCache[n.note_id].curve}
          forward={paramsCache[n.note_id].forward}
          settlementPrice={paramsCache[n.note_id].settlementPrice} size="full" animated={false} />
      : <p className="nl-note">Loading payoff…</p>}
</td>
```

(The `onClick` stops propagation so it never bubbles to the row's toggle. A `<button>` activates on Enter/Space and `stopPropagation` covers keyboard too, since React routes those through the same synthetic click for buttons.)

- [ ] **Step 3: App.css — table-scoped primary size override + close chip**

Append to `frontend/src/App.css` (after the `.nl-btn--primary` rules, ~line 98):

```css
/* table-scoped primary: damp the hero CTA so it fits a 52px action cell (review M1) */
.nl-td .nl-btn--primary { padding: 8px 16px; font-size: 12px; }
.nl-td .nl-btn--primary:hover:not(:disabled) {
  transform: translateY(-1px) scale(1.01);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.4), 0 10px 18px -10px rgba(224,160,60,.75);
}

/* expanded-row close — pearl chip with the app's line-icon X (review ②) */
.nl-detail { position: relative; }
.nl-detail-close {
  position: absolute; top: 8px; right: 10px;
  width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
  background: var(--surface-sunk); border: 1px solid var(--hairline); border-radius: 999px;
  color: var(--pearl-dim); cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
}
.nl-detail-close:hover { color: var(--pearl); border-color: rgba(58,51,64,.22); }
.nl-detail-close:focus-visible { outline: 2px solid var(--gold-ink); outline-offset: 2px; }
.nl-detail-close .nl-li { width: 12px; height: 12px; }
```

- [ ] **Step 4: App.css — extend the existing reduced-motion block**

In `frontend/src/App.css`, inside the existing `@media (prefers-reduced-motion: reduce)` block (~line 191-200), add this line alongside the others:

```css
  .nl-detail-close { transition: none; }
```

- [ ] **Step 5: Build to verify**

Run: `cd frontend && npx vite build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/MyNotes.jsx frontend/src/App.css
git commit -m "feat(mynotes): Claim→primary (table-scoped) + pearl-chip close on expanded row"
```

---

### Task 4: Load skeleton for MyNotes + Leaderboard (item ④)

**Files:**
- Modify: `frontend/src/Leaderboard.css` (`.nl-skel` bar, `@keyframes nl-skel-sweep`, extend reduced-motion)
- Modify: `frontend/src/App.css` (`.sr-only` utility)
- Modify: `frontend/src/Leaderboard.jsx` (skeleton `<tbody>` when `loading && rows.length===0`)
- Modify: `frontend/src/MyNotes.jsx` (add `loading` state; skeleton; empty-state gate; sr-only status)

**Interfaces:**
- Consumes: existing `loading` state (Leaderboard) / new `loading` state (MyNotes).

- [ ] **Step 1: Leaderboard.css — skeleton bar + sweep keyframe**

Append to `frontend/src/Leaderboard.css`:

```css
/* load skeleton — nacre sweep (NOT a grey pulse); keyframe MUST be nl-skel-sweep
   to avoid clobbering App.css's nl-shimmer (chart). */
.nl-skel {
  display: block; height: 11px; border-radius: 4px;
  background: linear-gradient(100deg,
    var(--surface-sunk) 30%, rgba(215,206,242,.55) 45%,
    rgba(248,221,201,.55) 55%, var(--surface-sunk) 70%);
  background-size: 200% 100%;
  animation: nl-skel-sweep 1.4s ease-in-out infinite;
}
@keyframes nl-skel-sweep { to { background-position: -200% 0; } }
```

- [ ] **Step 2: Leaderboard.css — extend the existing reduced-motion block**

Inside the existing `@media (prefers-reduced-motion: reduce)` block (Leaderboard.css:58-61), add:

```css
  .nl-skel { animation: none; background: var(--surface-sunk); }
```

- [ ] **Step 3: App.css — add the `.sr-only` utility (none exists)**

Append to `frontend/src/App.css`:

```css
/* visually-hidden but screen-reader-announced (no such utility existed) */
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
```

- [ ] **Step 4: Leaderboard.jsx — render skeleton tbody during initial load**

In `frontend/src/Leaderboard.jsx`, the table currently renders only when `rows.length > 0`. Add a skeleton table for the loading case. Insert directly BEFORE the `{rows.length > 0 && (` block:

```jsx
{loading && rows.length === 0 && (
  <table className="nl-table" aria-hidden="true">
    <thead>
      <tr>
        <th className="nl-th nl-th--rank">Rank</th>
        <th className="nl-th">Issuer</th>
        <th className="nl-th nl-th--num">Realized PnL</th>
        <th className="nl-th nl-th--num">Win Rate</th>
        <th className="nl-th nl-th--num">Notes</th>
        <th className="nl-th nl-th--num">Perf Fee</th>
      </tr>
    </thead>
    <tbody>
      {[0, 1, 2, 3].map((i) => (
        <tr className="nl-row" key={i} style={{ animation: 'none', opacity: 1 }}>
          <td className="nl-td nl-td--rank"><span className="nl-skel" style={{ width: 24 }} /></td>
          <td className="nl-td"><span className="nl-skel" style={{ width: '60%' }} /></td>
          <td className="nl-td nl-td--num"><span className="nl-skel" style={{ width: '50%', marginLeft: 'auto' }} /></td>
          <td className="nl-td nl-td--num"><span className="nl-skel" style={{ width: '45%', marginLeft: 'auto' }} /></td>
          <td className="nl-td nl-td--num"><span className="nl-skel" style={{ width: '30%', marginLeft: 'auto' }} /></td>
          <td className="nl-td nl-td--num"><span className="nl-skel" style={{ width: '50%', marginLeft: 'auto' }} /></td>
        </tr>
      ))}
    </tbody>
  </table>
)}
```

The existing empty-state line is already gated `!msg && !loading` (Leaderboard.jsx:58) — leave it unchanged.

- [ ] **Step 5: MyNotes.jsx — add loading state**

In `frontend/src/MyNotes.jsx`, add the state near the other `useState` calls:

```jsx
const [loading, setLoading] = useState(true);
```

Update `load()` to toggle it (wrap the existing body):

```jsx
async function load() {
  setMsg('');
  setMsgKind('');
  setLoading(true);
  try {
    // Normalize: indexer stores the full padded on-chain address; wallet form may be unpadded.
    setNotes(await getNotes(normalizeSuiAddress(account.address)));
  } catch (e) {
    setMsg(`Failed to load notes: ${e.message}`);
    setMsgKind('err');
  } finally {
    setLoading(false);
  }
}
```

- [ ] **Step 6: MyNotes.jsx — skeleton + gate the empty-state**

Replace the existing empty-state line `{notes.length === 0 && <p className="nl-empty">No notes found.</p>}` with the skeleton + gated empty-state:

```jsx
{loading && notes.length === 0 && !msg && (
  <table className="nl-table" aria-hidden="true">
    <thead>
      <tr>
        <th className="nl-th">Note</th>
        <th className="nl-th">Expiry</th>
        <th className="nl-th">Status</th>
        <th className="nl-th nl-th--num">Action</th>
      </tr>
    </thead>
    <tbody>
      {[0, 1, 2].map((i) => (
        <tr className="nl-row" key={i} style={{ animation: 'none', opacity: 1 }}>
          <td className="nl-td"><span className="nl-skel" style={{ width: '60%' }} /></td>
          <td className="nl-td"><span className="nl-skel" style={{ width: '40%' }} /></td>
          <td className="nl-td"><span className="nl-skel" style={{ width: '30%' }} /></td>
          <td className="nl-td nl-td--num"><span className="nl-skel" style={{ width: '50%', marginLeft: 'auto' }} /></td>
        </tr>
      ))}
    </tbody>
  </table>
)}
{loading && <span className="sr-only" role="status">Loading notes…</span>}
{!loading && !msg && notes.length === 0 && <p className="nl-empty">No notes found.</p>}
```

- [ ] **Step 7: Build to verify**

Run: `cd frontend && npx vite build`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/Leaderboard.css frontend/src/App.css frontend/src/Leaderboard.jsx frontend/src/MyNotes.jsx
git commit -m "feat(ui): nacre-sweep load skeleton for MyNotes + Leaderboard (+sr-only status)"
```

---

### Task 5: Rising-pearl mint loader (item ⑤)

**Files:**
- Modify: `frontend/src/App.css` (`.nl-spinner` pearl dots, `@keyframes nl-pearl`, button min-width, extend reduced-motion)
- Modify: `frontend/src/App.jsx` (loader before "Preparing…" in the Mint button; before "Minting…" note)

**Interfaces:**
- Consumes: nothing new; pure markup + CSS.

- [ ] **Step 1: App.css — pearl-dot loader**

Append to `frontend/src/App.css`:

```css
/* mint progress: 3 rising-pearl dots (NOT a rotating ring — review C1) */
.nl-spinner { display: inline-flex; gap: 3px; align-items: center; margin-right: 7px; }
.nl-spinner i {
  width: 6px; height: 6px; border-radius: 50%;
  background: radial-gradient(circle at 34% 30%, #fff 0%, rgba(255,255,255,.6) 22%, rgba(150,205,225,.28) 60%, rgba(120,180,215,.10) 82%);
  animation: nl-pearl 1.2s ease-in-out infinite;
}
.nl-spinner i:nth-child(2) { animation-delay: .15s; }
.nl-spinner i:nth-child(3) { animation-delay: .30s; }
@keyframes nl-pearl { 0%, 100% { transform: translateY(0); opacity: .45; } 50% { transform: translateY(-4px); opacity: 1; } }
/* on the molten button the pearl gradient is invisible on gold — use the button's text color */
.nl-btn--primary .nl-spinner i { background: #3d1a28; }
/* pin width so swapping "Mint Range Note"→"Preparing…" + dots doesn't reflow .nl-issue-row */
.nl-issue-row .nl-btn--primary { min-width: 196px; justify-content: center; }
```

- [ ] **Step 2: App.css — extend the existing reduced-motion block**

Inside the existing `@media (prefers-reduced-motion: reduce)` block (~line 191), add:

```css
  .nl-spinner i { animation: none; opacity: .6; }
```

- [ ] **Step 3: App.jsx — loader in the Mint button**

In `frontend/src/App.jsx`, the Mint button label currently is:

```jsx
{mintPhase === 'preparing' ? 'Preparing…' : 'Mint Range Note'}
```

Replace with a conditional that prepends the loader while preparing:

```jsx
{mintPhase === 'preparing'
  ? (<><span className="nl-spinner" aria-hidden="true"><i /><i /><i /></span>Preparing…</>)
  : 'Mint Range Note'}
```

- [ ] **Step 4: App.jsx — loader in the "Minting…" note**

Replace the line `{mintPhase === 'minting' && <p className="nl-note">Minting…</p>}` with:

```jsx
{mintPhase === 'minting' && (
  <p className="nl-note"><span className="nl-spinner" aria-hidden="true"><i /><i /><i /></span>Minting…</p>
)}
```

- [ ] **Step 5: Build to verify**

Run: `cd frontend && npx vite build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.css frontend/src/App.jsx
git commit -m "feat(mint): rising-pearl loader (replaces text-only Preparing/Minting states)"
```

---

## Final Verification (after all tasks)

- [ ] **All unit tests pass:** `cd frontend && node --test src/*.test.js` → green (format + existing payoff/metricRail/demoCurve).
- [ ] **Build:** `cd frontend && npx vite build` → green.
- [ ] **Presentation-gate (Rule 9):** `git diff main --stat -- frontend/src/api.js frontend/src/mint.js frontend/src/config.js frontend/src/payoff.js frontend/src/pendingMint.js frontend/src/dapp-kit.js scripts/` → **empty** (no business-logic file touched).
- [ ] **Keyframe-collision check:** `grep -rn "@keyframes nl-shimmer" frontend/src` → exactly one hit (App.css:187, the chart). `grep -rn "nl-skel-sweep" frontend/src` → the skeleton only.

## Human-deferred (non-blocking)

Browser + real-wallet visual pass (sandbox has no wallet): skeleton→loaded transition, pearl-dot loader on the molten button (dark dots visible), close-chip placement vs chart axis labels, truncated-id readability, reduced-motion fallbacks. All data paths are headless-verifiable.
