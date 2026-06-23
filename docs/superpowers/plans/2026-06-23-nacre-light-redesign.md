# Nacre Light Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the React dApp from the obsidian-dark "fintech ledger" look to the light "Nacre Light" underwater-pearl brand, with zero business-logic change.

**Architecture:** Pure presentation layer. Keystone is `theme.css`: keep token *names*, flip their *values* dark→light, so every component inherits the new palette without rename churn. Then add a fixed underwater background layer (`Sea.jsx`), restyle component CSS for the light surface, and inject six hand-drawn inline SVG ocean icons + a pink-gold bouncy Mint CTA + a bobbing logo. JSX edits are markup/className-only.

**Tech Stack:** React 18, Vite, `@mysten/dapp-kit-react` 2.x, plain CSS (CSS custom properties), Fraunces + Martian Mono (Google Fonts). No new deps.

## Global Constraints

- **Zero business-logic / SDK-wiring change.** These files MUST have an empty `git diff` at the end: `frontend/src/api.js`, `frontend/src/mint.js`, `frontend/src/config.js`, `frontend/src/dapp-kit.js`, `frontend/src/main.jsx`. JSX diffs are markup/className/copy-only — no edits to handlers (`onMint`, `claim`, `load`, `signExec`), state, fetch calls, or props plumbing.
- **No columns dropped.** Leaderboard keeps Rank, Issuer, Realized PnL, **Win Rate (meter bar)**, Notes, **Perf Fee**. MyNotes keeps Note, Expiry, Status, **Action (Claim)**.
- **No new runtime deps.** Bubbles/caustic/icons = pure CSS + inline SVG.
- **`prefers-reduced-motion: reduce` disables ALL motion:** section reveal, logo bob, bubbles, caustic drift, claimable pip pulse, CTA transform, row reveal.
- **Decorative SVG icons** get `aria-hidden="true"`. Logo keeps `alt=""`.
- **Copy (locked):** masthead h1 = `Pearl<em>Foundry</em>`; Mint card title = `Issue a Note`; Leaderboard title = `Nacre Ledger`; keep mascot hint line "pearl bobs · bubbles rise · claimable notes glow" (small, dim).
- **Visual ground truth:** `docs/ui-redesign/v2d-hybrid.html`. Lift exact values (palette, bubble params, SVG paths, animation timings) from it.
- **Visual gate = live browser** (`cd frontend && npm run dev`), NOT ImageMagick (lesson 2026-06-23). `vite build` must stay green after every task.
- **Primary CTA `--pinkgold` is reserved for the Mint button only.** Claim button stays the ghost `.nl-btn`.
- **Known gap (do NOT fix by selector-fishing):** `ConnectButton`'s own wallet modal renders in its default dark theme; dapp-kit-react 2.x exposes no theme prop, so the modal will look dark against the light page. Accept this — do **not** patch `ConnectButton` internals by classname/selector (breaks on SDK minor upgrades). Wrapping in `.nl-connect` (outer layout only) is the only allowed touch.
- **Review-fix provenance:** CSS values tagged `/* review … */` in this plan come from the 2026-06-23 sui-frontend + frontend-design/taste reviews. Implement them as written.

---

### Task 1: Palette flip — `theme.css` + `index.html`

**Files:**
- Modify: `frontend/src/theme.css` (flip `:root` token values, add new tokens, light body bg)
- Modify: `frontend/index.html` (title → PearlFoundry, add Fraunces italic axis)

**Interfaces:**
- Produces (consumed by all later tasks): light-valued tokens under the SAME names — `--obsidian` (page bg, now `#faf6f0`), `--obsidian-raised` (card, `#ffffff`), `--pearl` (primary text, `#3a3340`), `--pearl-dim` (`#8a7f88`), `--hairline` (`rgba(58,51,64,.09)`), `--jade` (`#2c9b6f`), `--rust` (`#cc6a4f`), `--molten`, `--brass`, `--nacre-accent`, `--nacre`, `--font-display`, `--font-mono` — plus NEW tokens: `--surface-sunk #f3ecf3`, `--ink-faint #b6acb4`, `--gold-ink #9a6a1e`, `--pinkgold`, `--pink #f4c2cd`, `--purple #cdc4ee`, `--peach #f8d6bd`, `--mint #bfe4d7`, `--shadow`.

- [ ] **Step 1: Replace the `:root` block and `body` in `theme.css`**

```css
:root {
  /* names kept for backward-compat; values flipped dark→light (roles unchanged:
     --obsidian = page bg, --obsidian-raised = card, --pearl = foreground text) */
  --obsidian: #faf6f0;
  --obsidian-raised: #ffffff;
  --surface-sunk: #f3ecf3;
  --pearl: #3a3340;
  --pearl-dim: #8a7f88;
  --ink-faint: #9b8f99; /* review C1: darkened from #b6acb4 for WCAG on 11px table headers */
  --gold-ink: #9a6a1e;
  --nacre: linear-gradient(115deg, #cdeadf, #d7cef2, #f8ddc9, #cfeae6);
  --jade: #2c9b6f;
  --rust: #cc6a4f;
  --molten: linear-gradient(135deg, #f8d27e, #e0a03c);
  --pinkgold: linear-gradient(120deg, #f9d27c 0%, #f0b56a 45%, #ec8aa6 100%);
  --brass: #9c8045;
  --nacre-accent: #c9c1e8;
  --pink: #f4c2cd;
  --purple: #cdc4ee;
  --peach: #f8d6bd;
  --mint: #bfe4d7;
  --hairline: rgba(58, 51, 64, 0.09);
  --shadow: 0 18px 40px -22px rgba(80, 60, 90, 0.45);
  --font-display: 'Fraunces', Georgia, 'Times New Roman', serif;
  --font-mono: 'Martian Mono', ui-monospace, 'SFMono-Regular', monospace;
}

body {
  margin: 0;
  min-height: 100vh;
  color: var(--pearl);
  background-color: var(--obsidian);
  background-image:
    radial-gradient(80% 50% at 12% -6%, rgba(205, 196, 238, 0.40), transparent 60%),
    radial-gradient(70% 45% at 92% 4%, rgba(244, 194, 205, 0.38), transparent 60%),
    radial-gradient(120% 60% at 50% 112%, rgba(150, 210, 230, 0.38), transparent 60%),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
  background-attachment: fixed;
}
```

- [ ] **Step 2: Update `index.html` title and font axis**

Change `<title>Structured Note Factory</title>` → `<title>PearlFoundry</title>`.
Change the Fraunces href to include the italic axis (add `ital`, keep weights):

```html
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,ital,wght@9..144,0,400;9..144,0,500;9..144,0,600;9..144,0,700;9..144,1,600&family=Martian+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
```

- [ ] **Step 3: Build to verify green**

Run: `cd frontend && npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 4: Visual smoke (dev)**

Run: `cd frontend && npm run dev` then open the URL.
Expected: page background is light pearl (not black); existing text is dark and readable on light; leaderboard renders. (Some surfaces — pill, you-row tint — will look washed-out; that's fixed in later tasks.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theme.css frontend/index.html
git commit -m "feat(frontend): flip palette to Nacre Light (theme tokens + title)"
```

---

### Task 2: Underwater background — `Sea.jsx` + `.nl-sea` rules

**Files:**
- Create: `frontend/src/Sea.jsx`
- Modify: `frontend/src/App.css` (add `.nl-sea`, `.nl-caustic`, `.nl-bubble` rules + reduced-motion entries; set `.nl-app { position: relative; z-index: 1; }`)
- Modify: `frontend/src/App.jsx` (render `<Sea/>` as first child; import)

**Interfaces:**
- Consumes: tokens from Task 1.
- Produces: `<Sea/>` default-export component (no props, no state) rendering a fixed `pointer-events:none; z-index:0` layer. `.nl-app` becomes the `z-index:1` content layer above it.

- [ ] **Step 1: Create `frontend/src/Sea.jsx`** (markup only — lift bubble params verbatim from `docs/ui-redesign/v2d-hybrid.html`)

```jsx
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
```

- [ ] **Step 2: Add sea rules to `App.css`** (append; lift values verbatim from v2d)

```css
/* underwater background layer */
.nl-app { position: relative; z-index: 1; }

.nl-sea { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.nl-caustic {
  position: absolute; inset: -25% 0;
  background:
    radial-gradient(38% 22% at 26% 22%, rgba(150, 210, 230, 0.40), transparent 65%),
    radial-gradient(34% 20% at 70% 38%, rgba(205, 196, 238, 0.38), transparent 65%),
    radial-gradient(40% 22% at 48% 64%, rgba(191, 228, 215, 0.42), transparent 65%);
  animation: nl-drift 12s ease-in-out infinite alternate;
}
@keyframes nl-drift { to { transform: translate3d(0, 28px, 0); } } /* review M9: translate only, no scale (avoids "page breathing") */

.nl-bubble {
  position: absolute; bottom: -60px; border-radius: 50%;
  background: radial-gradient(circle at 34% 30%, rgba(255,255,255,1) 0%, rgba(255,255,255,.6) 22%, rgba(150,205,225,.28) 60%, rgba(120,180,215,.10) 82%);
  border: 1px solid rgba(150, 200, 222, 0.30);
  box-shadow: inset 2px 3px 7px rgba(255,255,255,1), inset -2px -3px 6px rgba(150,200,222,.22), 0 0 14px rgba(170,212,228,.45);
  animation: nl-rise linear infinite; opacity: 0;
}
.nl-bubble::after {
  content: ""; position: absolute; top: 18%; left: 24%;
  width: 26%; height: 26%; border-radius: 50%; background: rgba(255,255,255,.95);
}
@keyframes nl-rise {
  0%   { transform: translateY(0) translateX(0); opacity: 0; }
  10%  { opacity: .95; }
  82%  { opacity: .85; }
  100% { transform: translateY(-112vh) translateX(34px); opacity: 0; }
}
```

- [ ] **Step 3: Disable sea motion under reduced-motion** — extend the existing `@media (prefers-reduced-motion: reduce)` block in `App.css`:

```css
@media (prefers-reduced-motion: reduce) {
  .nl-section, .nl-status { opacity: 1; transform: none; animation: none; }
  .nl-statuspip--claimable { animation: none; }
  .nl-btn { transition: none; }
  .nl-caustic, .nl-bubble { animation: none; }
  .nl-bubble { opacity: 0; }
}
```

- [ ] **Step 4: Mount `<Sea/>` in `App.jsx`** — add import and render as first child of `.nl-app`:

```jsx
import Sea from './Sea.jsx';
// ...
  return (
    <div className="nl-app">
      <Sea />
      <header className="nl-masthead nl-section" style={{ '--i': 0 }}>
      {/* ...rest unchanged... */}
```

- [ ] **Step 5: Build + visual verify**

Run: `cd frontend && npm run build` → green.
Run: `cd frontend && npm run dev` → bubbles rise from the bottom and drift up; soft caustic light shifts slowly behind the cards; content sits above the layer (clickable).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/Sea.jsx frontend/src/App.css frontend/src/App.jsx
git commit -m "feat(frontend): add underwater Sea background (bubbles + caustic)"
```

---

### Task 3: Masthead + Mint card — `App.css` light retune + `App.jsx` markup

**Files:**
- Modify: `frontend/src/App.css` (light retune: masthead bob, card shadow/radius, btn--primary→pinkgold bounce, pill, status; add `.nl-ico`/`.nl-li`/`.nl-mascot` rules)
- Modify: `frontend/src/App.jsx` (wordmark, eyebrow shell SVG, mascot line, mint card wave SVG, CTA sparkle SVG)

**Interfaces:**
- Consumes: tokens (Task 1), `<Sea/>` mounted (Task 2).
- Produces: masthead + mint card matching v2d. SVG icon helper classes `.nl-li` (inline-svg sizing) used again in Tasks 4–5.

- [ ] **Step 1: Retune masthead/card/button/pill rules in `App.css`** — replace the existing rules with these light-surface versions (keep selector names):

```css
/* masthead */
.nl-masthead {
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap; /* review I6: wrap on narrow */
  padding-bottom: 0; border: none; margin-bottom: 8px;
}
@keyframes nl-bob { 0%,100% { transform: translateY(0) rotate(-3deg); } 50% { transform: translateY(-12px) rotate(3deg); } }
.nl-mast-logo {
  width: 80px; height: 80px; flex: none; object-fit: contain;
  transform-origin: 50% 60%;
  filter: drop-shadow(0 12px 20px rgba(227,162,63,.45));
  animation: nl-bob 3.2s ease-in-out infinite;
}
.nl-mast-titles { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.nl-eyebrow {
  font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.18em;
  text-transform: uppercase; color: var(--gold-ink); font-weight: 600;
  display: flex; align-items: center; gap: 7px;
}
.nl-mast-title {
  font-family: var(--font-display); font-weight: 600; font-size: 36px;
  letter-spacing: -0.01em; line-height: 1.02; margin: 4px 0 6px; color: var(--pearl);
}
.nl-mast-title em {
  /* review C2: solid gold-ink instead of molten gradient-text (the light molten stop
     dissolved on white + gradient-text trips anti-slop). molten now lives only in the
     logo drop-shadow + card top-bar. */
  font-style: italic; color: var(--gold-ink);
}
.nl-connect { margin-left: auto; align-self: flex-start; }
.nl-mascot {
  color: var(--ink-faint); font-size: 12px; margin: 0 0 32px; /* review I5: 8px-scale rhythm */
  display: flex; align-items: center; gap: 8px;
}

/* review I6: narrow-viewport masthead — shrink logo, let ConnectButton wrap */
@media (max-width: 480px) {
  .nl-mast-logo { width: 60px; height: 60px; }
  .nl-mast-title { font-size: 30px; }
  .nl-connect { margin-left: 0; flex-basis: 100%; }
}

/* inline SVG line-icons */
.nl-li { display: inline-block; vertical-align: middle; }
.nl-eyebrow .nl-li { width: 14px; height: 14px; color: var(--gold-ink); }
.nl-mascot .nl-li { width: 15px; height: 15px; color: var(--ink-faint); }
.nl-card__title .nl-ico { display: inline-flex; color: var(--gold-b, #e3a23f); margin-right: 9px; }
.nl-card__title .nl-li { width: 22px; height: 22px; }
.nl-btn--primary .nl-li { width: 16px; height: 16px; margin-right: 8px; }

/* card surface (light) */
.nl-card {
  background: var(--obsidian-raised); border: 1px solid var(--hairline);
  border-radius: 22px; padding: 26px; margin-top: 24px;
  box-shadow: var(--shadow); position: relative; overflow: hidden;
}
.nl-card::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 3px; background: var(--nacre); opacity: .6; } /* review I4: thinner+dimmer so CTA/PnL own the hierarchy */
.nl-card__head { display: flex; align-items: baseline; justify-content: space-between; border: none; padding-bottom: 4px; margin-bottom: 14px; }
.nl-card__title { font-family: var(--font-display); font-weight: 600; font-size: 22px; letter-spacing: -0.01em; margin: 0; color: var(--pearl); display: flex; align-items: center; }

/* buttons */
.nl-btn {
  font-family: var(--font-mono); font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--pearl-dim); background: var(--obsidian-raised);
  border: 1px solid var(--hairline); border-radius: 999px; padding: 9px 16px;
  cursor: pointer; box-shadow: var(--shadow);
  transition: color 120ms ease, border-color 120ms ease;
}
.nl-btn:hover:not(:disabled) { color: var(--pearl); border-color: rgba(58,51,64,.22); }
.nl-btn:disabled { opacity: 0.5; cursor: default; }

.nl-btn--primary {
  color: #3d1a28; background: var(--pinkgold); border: none; border-radius: 999px; /* review C1: darker text for WCAG on pink gradient end */
  font-weight: 700; text-transform: none; letter-spacing: 0; font-size: 13px;
  padding: 14px 27px; box-shadow: 0 15px 28px -10px rgba(236,138,166,.7);
  display: inline-flex; align-items: center;
  transition: transform .15s ease, box-shadow .15s ease;
}
.nl-btn--primary:hover:not(:disabled) { transform: translateY(-3px) scale(1.03); box-shadow: 0 24px 40px -12px rgba(236,138,166,.9); } /* review N11: 1.03 not 1.05 */
.nl-btn--primary:active:not(:disabled) { transform: translateY(-1px) scale(1.02); } /* review N12: tactile press */
.nl-btn--primary:disabled { opacity: 0.55; }

/* connected-address pill (light) */
.nl-pill {
  display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-mono);
  font-size: 11px; color: var(--pearl-dim); background: var(--surface-sunk);
  border: 1px solid var(--hairline); border-radius: 999px; padding: 5px 12px; margin-bottom: 16px;
}
.nl-pill__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--molten); flex: none; }

/* status feedback (unchanged colors; keep) */
.nl-status { font-family: var(--font-mono); font-size: 12px; white-space: pre-wrap; margin: 14px 0 0; opacity: 0; transform: translateY(4px); animation: nl-reveal 240ms ease forwards; }
.nl-status--ok { color: var(--jade); }
.nl-status--err { color: var(--rust); }
```

> Note: the existing `nl-statuspip*` rules and `@keyframes nl-reveal/nl-pulse` in `App.css` stay as-is (already token-driven; pulse glow reads fine on light). Add `--gold-b: #e3a23f;` to the `:root` in `theme.css` if you prefer not to use the `var(--gold-b, #e3a23f)` fallback — fallback is acceptable.

- [ ] **Step 2: Update masthead markup in `App.jsx`** — replace the `<header>` block:

```jsx
      <header className="nl-masthead nl-section" style={{ '--i': 0 }}>
        <img className="nl-mast-logo" src="/logo-mark.png" alt="" />
        <div className="nl-mast-titles">
          <span className="nl-eyebrow">
            <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21C5 16 3 10.5 3 8a4.2 3.4 0 0 1 18 0c0 2.5-2 8-9 13Z" />
              <path d="M12 21V8.5M12 21 7.4 10M12 21 16.6 10M12 21 4.6 12.5M12 21 19.4 12.5" />
            </svg>
            Testnet · DeepBook Predict
          </span>
          <h1 className="nl-mast-title">Pearl<em>Foundry</em></h1>
        </div>
        <div className="nl-connect"><ConnectButton /></div>
      </header>
      <div className="nl-mascot nl-section" style={{ '--i': 0 }}>
        <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="14.5" r="3.2" /><circle cx="15.5" cy="9.5" r="2.2" /><circle cx="17.5" cy="15.5" r="1.3" />
        </svg>
        pearl bobs · bubbles rise from the seabed · claimable notes glow
      </div>
```

- [ ] **Step 3: Add wave icon to Mint card title + sparkle icon to CTA in `App.jsx`** — update the `nl-card__head` title and the primary button:

```jsx
            <div className="nl-card__head">
              <h2 className="nl-card__title">
                <span className="nl-ico">
                  <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 9c2-2.6 4-2.6 6 0s4 2.6 6 0 4-2.6 6 0" />
                    <path d="M2 15c2-2.6 4-2.6 6 0s4 2.6 6 0 4-2.6 6 0" />
                  </svg>
                </span>
                Issue a Note
              </h2>
            </div>
```

```jsx
              <button
                className="nl-btn nl-btn--primary"
                disabled={busy}
                onClick={onMint}
                aria-busy={busy}
              >
                <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3.5c.4 3.8 1.7 5.1 5.5 5.5-3.8.4-5.1 1.7-5.5 5.5-.4-3.8-1.7-5.1-5.5-5.5 3.8-.4 5.1-1.7 5.5-5.5Z" />
                  <path d="M18.5 14.5c.2 1.6.7 2.1 2.3 2.3-1.6.2-2.1.7-2.3 2.3-.2-1.6-.7-2.1-2.3-2.3 1.6-.2 2.1-.7 2.3-2.3Z" />
                </svg>
                {busy ? 'Minting…' : 'Mint Range Note'}
              </button>
```

> `onClick={onMint}`, `disabled`, `aria-busy`, and the busy-label logic are unchanged — only the icon `<svg>` is prepended.

- [ ] **Step 4: Build + visual verify**

Run: `cd frontend && npm run build` → green.
Run: `cd frontend && npm run dev`, connect a wallet → masthead shows bobbing logo, gold eyebrow with shell icon, `PearlFoundry` wordmark with molten italic, dim mascot line; Mint card has wave icon + white rounded card with nacre top-bar; Mint button is pink-gold and bounces on hover.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.css frontend/src/App.jsx
git commit -m "feat(frontend): Nacre Light masthead + mint card (wordmark, icons, pink-gold CTA)"
```

---

### Task 4: Leaderboard — `Leaderboard.css` light retune + `Leaderboard.jsx` title/icon

**Files:**
- Modify: `frontend/src/Leaderboard.css` (light retune of board/table/row/you-row/meter; rank-cell padding fix)
- Modify: `frontend/src/Leaderboard.jsx` (title → `Nacre Ledger`, trophy SVG; keep all columns)

**Interfaces:**
- Consumes: tokens (Task 1), `.nl-li`/`.nl-ico` icon classes (Task 3, defined in App.css — Leaderboard.jsx already imports nothing extra; `.nl-board__title .nl-ico` rule added here).
- Produces: light leaderboard matching v2d, you-row highlight not covering rank.

- [ ] **Step 1: Retune `Leaderboard.css`** — replace board surface + row/you/meter rules with light versions (keep selector names; keep Win Rate meter + all columns):

```css
.nl-board {
  max-width: 760px; margin: 32px auto 0; /* review I5: 8px-scale rhythm */
  background: var(--obsidian-raised); border: 1px solid var(--hairline);
  border-radius: 22px; padding: 26px; box-shadow: var(--shadow);
  position: relative; overflow: hidden;
}
.nl-board::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 3px; background: var(--nacre); opacity: .6; } /* review I4: match card top-bar */

.nl-board__head { display: flex; align-items: baseline; justify-content: space-between; border: none; padding-bottom: 4px; margin-bottom: 6px; }
.nl-board__title { font-family: var(--font-display); font-weight: 600; font-size: 22px; letter-spacing: -0.01em; margin: 0; color: var(--pearl); display: flex; align-items: center; }
.nl-board__title .nl-ico { display: inline-flex; color: #e3a23f; margin-right: 9px; }
.nl-board__title .nl-li { width: 22px; height: 22px; }

.nl-refresh {
  font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--pearl-dim); background: var(--surface-sunk); border: 1px solid var(--hairline);
  border-radius: 999px; padding: 6px 12px; cursor: pointer; transition: color 120ms ease, border-color 120ms ease;
}
.nl-refresh:hover:not(:disabled) { color: var(--pearl); border-color: rgba(58,51,64,.22); }
.nl-refresh:disabled { opacity: 0.5; cursor: default; }

.nl-error { font-family: var(--font-mono); font-size: 12px; color: var(--rust); white-space: pre-wrap; margin: 12px 0 0; }
.nl-empty { font-family: var(--font-mono); font-size: 13px; color: var(--pearl-dim); margin: 16px 0 4px; }

.nl-table { width: 100%; border-collapse: collapse; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.nl-th { text-align: left; font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-faint); padding: 14px 10px 10px; border-bottom: 1px solid var(--hairline); } /* review C1: 10→11px */
.nl-th--num { text-align: right; }
.nl-th--rank { width: 64px; padding-left: 20px; } /* review #10: clear gold pip + inset bar */

.nl-row { border-bottom: 1px solid var(--hairline); opacity: 0; transform: translateY(6px); animation: nl-reveal 360ms ease forwards; animation-delay: calc(var(--i) * 40ms); transition: background-color 120ms ease; }
.nl-row:hover { background-color: rgba(58, 51, 64, 0.03); }
@keyframes nl-reveal { to { opacity: 1; transform: none; } }

.nl-td { padding: 13px 10px; font-size: 13px; color: var(--pearl); height: 52px; box-sizing: border-box; }
.nl-td--num { text-align: right; }
.nl-td--rank { position: relative; padding-left: 20px; } /* review #10 */

.nl-rank-n { font-family: var(--font-display); font-size: 18px; color: var(--gold-ink); }
.nl-pip { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 8px; vertical-align: middle; }
.nl-pip--gold { background: var(--molten); box-shadow: 0 0 6px rgba(245, 200, 105, 0.5); }
.nl-pip--brass { background: var(--brass); }

.nl-issuer { color: var(--pearl); }
.nl-you { font-size: 9px; letter-spacing: 0.12em; margin-left: 10px; padding: 2px 8px; border-radius: 999px; color: #3d1a28; background: var(--pinkgold); vertical-align: middle; } /* review C1: darker text */

.nl-row--you { background: linear-gradient(90deg, rgba(246,205,114,.24), transparent); } /* review M7: strengthen tint, keep inset bar */
.nl-row--you td:first-child { box-shadow: inset 4px 0 0 var(--gold-b, #e3a23f); }

.nl-pnl.is-pos { color: var(--jade); }
.nl-pnl.is-neg { color: var(--rust); }

.nl-win { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.nl-meter { width: 64px; height: 3px; background: rgba(58,51,64,.14); overflow: hidden; border-radius: 3px; } /* review M8: thicker+wider+more opaque track so fill ratio is perceptible */
.nl-meter__fill { display: block; height: 100%; background: var(--nacre); }

@media (prefers-reduced-motion: reduce) {
  .nl-row { opacity: 1; transform: none; animation: none; }
  .nl-row, .nl-refresh { transition: none; }
}
```

> Rank-cell fix (Global Constraints): `.nl-th--rank` and `.nl-td--rank` now have `padding-left: 16px`, so the `inset 4px` you-row bar no longer overlaps the rank numeral.

- [ ] **Step 2: Update `Leaderboard.jsx` title + trophy icon** — replace the `<header>` block (everything else, incl. all `<td>` columns, unchanged):

```jsx
      <header className="nl-board__head">
        <h2 className="nl-board__title">
          <span className="nl-ico">
            <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 4h10v3.5a5 5 0 0 1-10 0Z" />
              <path d="M7 5H4.2v1.8a3 3 0 0 0 3 3" />
              <path d="M17 5h2.8v1.8a3 3 0 0 1-3 3" />
              <path d="M12 12.5v3" /><path d="M8.5 20h7" /><path d="M10 20l.6-4.5M14 20l-.6-4.5" />
            </svg>
          </span>
          Nacre Ledger
        </h2>
        <button className="nl-refresh" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>
```

- [ ] **Step 3: Build + visual verify**

Run: `cd frontend && npm run build` → green.
Run: `cd frontend && npm run dev` → Leaderboard titled "Nacre Ledger" with trophy icon; white rounded card + nacre top-bar; Win Rate meter + Perf Fee columns present; rank numerals gold/serif; YOU row pink-gold tag + gold left bar that does NOT cover the rank digit.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/Leaderboard.css frontend/src/Leaderboard.jsx
git commit -m "feat(frontend): Nacre Light leaderboard (light retune, trophy icon, rank-bar fix)"
```

---

### Task 5: MyNotes icon + whole-page verification

**Files:**
- Modify: `frontend/src/MyNotes.jsx` (clam SVG icon on title; markup only)
- (No new CSS — MyNotes uses `.nl-board`/`.nl-table` from Leaderboard.css and `.nl-statuspip*` from App.css, both already migrated.)

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: fully migrated site; the Claim button stays the ghost `.nl-btn` (not the pink-gold primary).

- [ ] **Step 1: Add clam-with-pearl icon to MyNotes title in `MyNotes.jsx`** — replace the `<header>` block (table, Claim button, handlers unchanged):

```jsx
      <header className="nl-board__head">
        <h2 className="nl-board__title">
          <span className="nl-ico">
            <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11a9 4.2 0 0 1 18 0" />
              <path d="M3 12.4a9 4.6 0 0 0 18 0" />
              <circle cx="12" cy="12" r="2.4" />
            </svg>
          </span>
          My Notes
        </h2>
        <button className="nl-refresh" onClick={load} disabled={!!claiming}>Refresh</button>
      </header>
```

- [ ] **Step 2: Build**

Run: `cd frontend && npm run build`
Expected: green.

- [ ] **Step 3: Verify business-logic invariant (the meaningful test)**

Run: `git diff --stat HEAD~4 -- frontend/src/api.js frontend/src/mint.js frontend/src/config.js frontend/src/dapp-kit.js frontend/src/main.jsx`
Expected: **empty output** (zero changes to logic/SDK-wiring files).

Run: `git log --oneline HEAD~4..HEAD` and eyeball that all changes are `frontend/src/{theme.css,App.css,App.jsx,Sea.jsx,Leaderboard.css,Leaderboard.jsx,MyNotes.jsx,index.html}` only.

- [ ] **Step 4: Whole-page live visual gate**

Run: `cd frontend && npm run dev`. Connect a wallet. Confirm against `docs/ui-redesign/v2d-hybrid.html`:
- Light pearl background; bobbing logo; soft rising bubbles + caustic drift.
- Masthead `PearlFoundry` wordmark + shell eyebrow + mascot line.
- Mint card: wave icon, white rounded card, pink-gold bouncy CTA, address pill, status text.
- My Notes: clam icon, light table, status pips (claimable gold pulse), Claim is ghost button.
- Nacre Ledger: trophy icon, all columns incl. Win Rate meter + Perf Fee, YOU row highlight clears rank.

- [ ] **Step 5: Reduced-motion check**

In devtools, emulate `prefers-reduced-motion: reduce`, reload.
Expected: no bob, no bubbles, no caustic drift, no row/section reveal, no pip pulse, CTA static.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/MyNotes.jsx
git commit -m "feat(frontend): Nacre Light MyNotes icon; complete redesign migration"
```

---

## Self-Review

**Spec coverage:**
- §3 palette → Task 1 ✅
- §4 Sea layer → Task 2 ✅
- §5 index.html title/font → Task 1; masthead/mint → Task 3; MyNotes → Task 5; Leaderboard → Task 4 ✅
- §5 SVG icon set (6) → shell+wave+sparkle+bubbles (Task 3), trophy (Task 4), clam (Task 5) ✅
- §2 invariants → Task 5 Step 3 git-diff gate ✅; reduced-motion → Task 2 Step 3 + Task 5 Step 5 ✅; columns kept → Tasks 4/5 explicit ✅
- §6 files → all covered; `Sea.jsx` created Task 2 ✅
- §7 verification → build gates each task + Task 5 whole-page + logic-diff gate ✅
- §8 copy decisions → wordmark/Issue a Note/Nacre Ledger/mascot all in Tasks 3–5 ✅

**Placeholder scan:** none — all CSS/JSX/SVG shown in full.

**Type/name consistency:** `.nl-li` (icon sizing) defined in App.css Task 3, reused Tasks 4–5; `.nl-ico` wrapper consistent; `--gold-b` referenced with fallback everywhere; token names unchanged across tasks; `nl-row--you`/`nl-td--rank` padding fix consistent.
