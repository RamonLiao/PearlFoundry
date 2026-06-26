# Landing Page + Launch-App Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a marketing landing page at `/` that introduces PearlFoundry and routes to the existing dApp at `/app` via "Launch App".

**Architecture:** Introduce `react-router-dom@^6` in `main.jsx` (DAppKitProvider outermost → BrowserRouter → Routes). The current single-page app becomes the `/app` route, body unchanged. A new `Landing.jsx` + `Landing.css` + pure-data `landingContent.js` render the `/` page reusing the Nacre theme, `<Sea/>` background, `<Mascot>`, and App.css primitives (which move to a global import). SPA-fallback config is committed so deep-links don't 404.

**Tech Stack:** React 18, Vite 5, `@mysten/dapp-kit-react`, `react-router-dom@^6.28`, `node --test` (node:test) for unit tests. Nacre Light theme tokens in `theme.css`.

## Global Constraints

Copied verbatim from spec `docs/superpowers/specs/2026-06-25-landing-page-design.md`. Every task implicitly includes these:

- **Router pinned:** `"react-router-dom": "^6.28.0"` in `frontend/package.json` (v6 API; v7 must NOT install).
- **Provider order:** `<DAppKitProvider>` OUTERMOST → `<BrowserRouter>` → `<Routes>`, all in `main.jsx`. `App.jsx` is NOT the router host; its render body is unchanged.
- **App.css global:** `import './App.css'` moves from `App.jsx` to `main.jsx` (Landing reuses `.nl-section`, `@keyframes nl-reveal`, `.sr-only` — without the global import they silently fail).
- **Fonts:** headline + section headings `var(--font-display)` (Fraunces); eyebrows/numbers/ledger/tags `var(--font-mono)` (Martian Mono). NO generic `ui-sans-serif`.
- **Accent dominance:** `--molten` is the ONE saturated accent — primary CTA + YOU-row band only. Jade = secondary (roadmap ticks, nav hover, eyebrow). Molten CTA ink stays `#3d1a28` (WCAG 6.7:1; do not change).
- **One shadow source:** hero mascot shadow from `nl-pearl-well` glow only — no extra `drop-shadow` on the img, no `grayscale()`/`saturate()` on it. The glow orb is a SEPARATE background element, not a second drop-shadow.
- **RWD:** `@media (max-width: 600px)`, NOT `@container`. Nav CTA must be a SIBLING of the nav-links container.
- **Reduced motion:** `Landing.css` contains EXACTLY ONE `@media (prefers-reduced-motion: reduce)` block. Landing.css must NOT redeclare `@keyframes nl-reveal` or any keyframe already in App.css.
- **Stagger:** 60ms `--i` multiplier in Landing.css (App.css uses 90ms).
- **Copy:** all text condensed from `docs/demo-script.md` + `docs/product-economics.md`. NO new claims. Roadmap items phrased as roadmap — never "already live".
- **Honesty:** ledger teaser is static, marked with a visible "Illustrative" chip + an `sr-only` `<caption>`.
- **Test harness:** `node --test` over `src/*.test.js`, pure JS only. Do NOT add jsdom/RTL/vitest. Component render is verified by `vite build` green + human browser pass.

**Build/test commands (run from `frontend/`):**
- Tests: `node --test src/`
- Build: `npx vite build`

---

### Task 1: Routing skeleton + App.css global + SPA fallback + Landing stub

Stands up the route structure with a placeholder Landing so the app still builds and `/app` works unchanged. UI polish comes later.

**Files:**
- Modify: `frontend/package.json` (add dependency)
- Modify: `frontend/src/main.jsx` (router + global App.css)
- Modify: `frontend/src/App.jsx:18` (remove its `import './App.css'`)
- Create: `frontend/src/Landing.jsx` (temporary stub, replaced in Task 3)
- Create: `frontend/public/_redirects`
- Create: `frontend/vercel.json`

**Interfaces:**
- Produces: `Landing` default export (stub now, full in Task 3); routes `/` → Landing, `/app` → App.

- [ ] **Step 1: Add the pinned router dependency**

Edit `frontend/package.json` `dependencies` (keep alphabetical-ish order, after `react-dom`):

```json
  "dependencies": {
    "@mysten/dapp-kit-react": "^2.0.3",
    "@mysten/sui": "^2.17.0",
    "@tanstack/react-query": "^5.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0"
  },
```

- [ ] **Step 2: Install it (pinned, no v7)**

Run (from `frontend/`): `npm install`
Expected: `react-router-dom@6.28.x` resolved (NOT 7.x). Verify: `npm ls react-router-dom` shows a `6.` version.

- [ ] **Step 3: Create the Landing stub**

Create `frontend/src/Landing.jsx`:

```jsx
// Temporary stub — replaced with the full landing in Task 3.
import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <div className="nl-app">
      <h1>PearlFoundry</h1>
      <Link to="/app">Launch App</Link>
    </div>
  );
}
```

- [ ] **Step 4: Restructure `main.jsx` (router + global App.css)**

Replace `frontend/src/main.jsx` entirely:

```jsx
import './theme.css';
import './App.css'; // global so the Landing route ('/') gets .nl-section, nl-reveal, .sr-only
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import { dAppKit } from './dapp-kit.js';
import App from './App.jsx';
import Landing from './Landing.jsx';

// Provider order: DAppKitProvider is OUTERMOST so every route shares one wallet
// context (App.jsx's useCurrentAccount etc. must run inside DAppKitProvider).
createRoot(document.getElementById('root')).render(
  <DAppKitProvider dAppKit={dAppKit}>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<App />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </DAppKitProvider>,
);
```

- [ ] **Step 5: Remove the now-duplicate App.css import from App.jsx**

Delete line `import './App.css';` from `frontend/src/App.jsx` (was line 18). App.jsx no longer imports its own CSS — `main.jsx` loads it globally. Leave everything else in App.jsx unchanged.

- [ ] **Step 6: Create the SPA-fallback configs**

Create `frontend/public/_redirects` (exact content, trailing newline):

```
/*  /index.html  200
```

Create `frontend/vercel.json`:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

- [ ] **Step 7: Build to verify wiring**

Run (from `frontend/`): `npx vite build`
Expected: build succeeds, no missing-import errors.

- [ ] **Step 8: Run existing tests (must stay green)**

Run: `node --test src/`
Expected: all existing tests pass (no regressions; we touched no tested module's logic).

- [ ] **Step 9: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/main.jsx frontend/src/App.jsx frontend/src/Landing.jsx frontend/public/_redirects frontend/vercel.json
git commit -m "feat(frontend): routing skeleton — / landing + /app, global App.css, SPA fallback"
```

---

### Task 2: `landingContent.js` pure data + tests (TDD)

The single source of landing copy, as testable constants. Copy is condensed from `docs/demo-script.md` (Problem/Solution/Roadmap) + `docs/product-economics.md` (hero sub).

**Files:**
- Create: `frontend/src/landingContent.js`
- Create: `frontend/src/landingContent.test.js`

**Interfaces:**
- Produces (consumed by Task 3 & 4 sections):
  - `HERO` — `{ eyebrow:string, headline:string, sub:string }`
  - `PROBLEMS` — `Array<{ num:string, title:string, body:string }>` (length 3)
  - `STEPS` — `Array<{ key:'mint'|'settle'|'claim', title:string, body:string }>` (length 3)
  - `LEDGER_ROWS` — `Array<{ rank:number, issuer:string, pnl:string, win:string, you?:boolean }>` (exactly one `you:true`)
  - `ROADMAP` — `Array<{ title:string, body:string }>` (≥1; no string contains "live")
  - `FOOTER` — `{ brand:string, tag:string }`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/landingContent.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HERO, PROBLEMS, STEPS, LEDGER_ROWS, ROADMAP, FOOTER } from './landingContent.js';

test('HERO has eyebrow, headline, sub', () => {
  for (const k of ['eyebrow', 'headline', 'sub']) {
    assert.equal(typeof HERO[k], 'string');
    assert.ok(HERO[k].length > 0, `HERO.${k} non-empty`);
  }
});

test('PROBLEMS = exactly 3 items, each {num,title,body}', () => {
  assert.equal(PROBLEMS.length, 3);
  for (const p of PROBLEMS) {
    for (const k of ['num', 'title', 'body']) assert.ok(p[k], `problem.${k}`);
  }
});

test('STEPS = exactly mint, settle, claim in order', () => {
  assert.deepEqual(STEPS.map((s) => s.key), ['mint', 'settle', 'claim']);
  for (const s of STEPS) assert.ok(s.title && s.body);
});

test('LEDGER_ROWS has exactly one YOU row', () => {
  assert.ok(LEDGER_ROWS.length >= 2);
  assert.equal(LEDGER_ROWS.filter((r) => r.you).length, 1);
});

test('ROADMAP non-empty and never claims "live" (honesty: R2-M2)', () => {
  assert.ok(ROADMAP.length >= 1);
  for (const r of ROADMAP) {
    const blob = `${r.title} ${r.body}`.toLowerCase();
    assert.ok(!blob.includes('live'), `roadmap item must not assert "live": ${r.title}`);
  }
});

test('FOOTER has brand + tag', () => {
  assert.ok(FOOTER.brand && FOOTER.tag);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/landingContent.test.js`
Expected: FAIL — cannot find module `./landingContent.js`.

- [ ] **Step 3: Write the content module**

Create `frontend/src/landingContent.js`:

```js
// Single source of landing copy. Pure data — no logic. Text condensed from
// docs/demo-script.md (Problem / Solution / Roadmap) and docs/product-economics.md
// (hero sub). No new claims; roadmap items are roadmap, never "live".

export const HERO = {
  eyebrow: 'Testnet · DeepBook Predict',
  headline: 'One-click structured notes, native to DeepBook.',
  sub: 'Deposit dUSDC and take a defined bullish bet that BTC climbs into a strike band by expiry. The higher it settles, the more you get back — payout can exceed your deposit. Stay below the band and you keep the unspent premium instead of going to zero.',
};

export const PROBLEMS = [
  { num: '01', title: 'Retail is priced out', body: 'Bank structured notes demand $50–200k minimums, lock-ups and heavy KYC.' },
  { num: '02', title: 'DeFi v1 collapsed', body: 'Ribbon and Cega broke on oracle manipulation and the absence of a real volatility surface.' },
  { num: '03', title: 'No audit trail', body: 'Neither side gives you an immutable record of the terms you actually bought.' },
];

export const STEPS = [
  { key: 'mint', title: 'Mint', body: 'One atomic PTB bundles a multi-leg DeepBook Predict ladder, sized to your notional — no leg-risk, no slippage. Every leg is priced against DeepBook’s on-chain SVI vol surface.' },
  { key: 'settle', title: 'Settle', body: 'The note settles itself on-chain. A notify-only watcher flags maturity — a keeper structurally cannot claim for you, because the note is an owned soulbound object.' },
  { key: 'claim', title: 'Claim', body: 'You sign once: settle each leg, withdraw the payout, take the performance fee, and burn the note — atomically. A tamper-proof Move-object prospectus, closed in one transaction.' },
];

// Static, illustrative — NOT a live leaderboard fetch (D1). Marked illustrative in the UI.
export const LEDGER_ROWS = [
  { rank: 1, issuer: '0x9d56…fda4', pnl: '+1.03', win: '100%' },
  { rank: 2, issuer: '0xbdec…1f', pnl: '+0.42', win: '67%', you: true },
  { rank: 3, issuer: '0x1509…bc4c', pnl: '+0.18', win: '50%' },
];

export const ROADMAP = [
  { title: 'More templates', body: 'Capped-Upside and Principal-Protected notes, reusing the same atomic-PTB factory.' },
  { title: 'Walrus term attestation', body: 'An immutable PDF term sheet + backtest CSV pinned to Walrus, Blob ID embedded in the note.' },
  { title: 'Gasless claims', body: 'A sponsored-transaction gas station so holders can claim without ever holding SUI.' },
];

export const FOOTER = { brand: 'PearlFoundry · Sui Overflow 2026 · Track 2', tag: 'Testnet' };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/landingContent.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/landingContent.js frontend/src/landingContent.test.js
git commit -m "feat(frontend): landingContent pure-data module + node:test shape/honesty tests"
```

---

### Task 3: Landing shell + Hero section

Replace the stub with the real Landing composing `<Sea/>` + a masthead (brand + nav links + Launch-App CTA sibling) + `LandingHero`. Establishes `Landing.css` base, fonts, glow orb, and the `nl-clam-open` hero beat. Problem/HowItWorks/Ledger come in Task 4 (Landing renders them as it grows).

**Files:**
- Modify: `frontend/src/Landing.jsx` (replace stub)
- Create: `frontend/src/Landing.css`

**Interfaces:**
- Consumes: `HERO` from `landingContent.js`; `Mascot` from `Mascot.jsx`; `MASCOT_VARIANT` from `mascot.js`; `Sea` from `Sea.jsx`.
- Produces: `Landing` default export rendering masthead + hero. Task 4 appends sections inside the same `<main>`.

- [ ] **Step 1: Write Landing.jsx (shell + hero)**

Replace `frontend/src/Landing.jsx`:

```jsx
import { Link } from 'react-router-dom';
import Sea from './Sea.jsx';
import Mascot from './Mascot.jsx';
import { MASCOT_VARIANT } from './mascot.js';
import { HERO } from './landingContent.js';
import './Landing.css';

function Masthead() {
  return (
    <header className="nll-top">
      <Link to="/" className="nll-brand" aria-label="PearlFoundry home">
        <img src="/logo-mark.png" alt="" width="34" height="34" />
        <span>Pearl<em>Foundry</em></span>
      </Link>
      <nav className="nll-nav">
        <span className="nll-navlinks">
          <a href="#problem">Problem</a>
          <a href="#how-it-works">How it works</a>
          <a href="#roadmap">Roadmap</a>
        </span>
        <Link to="/app" className="nll-cta nll-cta--sm">Launch App ↗</Link>
      </nav>
    </header>
  );
}

function LandingHero() {
  return (
    <section className="nl-section nll-hero" style={{ '--i': 0 }}>
      <div className="nll-hero-copy">
        <span className="nl-eyebrow nll-eyebrow">◆ {HERO.eyebrow}</span>
        <h1 className="nll-h1">{HERO.headline}</h1>
        <p className="nll-sub">{HERO.sub}</p>
        <div className="nll-ctas">
          <Link to="/app" className="nll-cta">Launch App ↗</Link>
          <a href="#how-it-works" className="nll-cta nll-cta--ghost">How it works ↓</a>
        </div>
      </div>
      <div className="nll-hero-art">
        <span className="nll-orb" aria-hidden="true" />
        <span className="nll-hero-mascot">
          <Mascot variant={MASCOT_VARIANT.JOYFUL} treatment="full" glow size={180} />
        </span>
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <div className="nl-app nll">
      <Sea />
      <Masthead />
      <main>
        <LandingHero />
        {/* Task 4 appends Problem / HowItWorks / LedgerRoadmap / footer here */}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Write Landing.css (base + masthead + hero + fonts + orb + beat)**

Create `frontend/src/Landing.css`. (Reuses `.nl-section`/`nl-reveal`/`.sr-only` from global App.css — does NOT redeclare them. The hero mascot's `nl-clam-open` reuses App.css's keyframe.)

```css
/* Landing-only styles. Theme tokens from theme.css; .nl-section + nl-reveal +
   .sr-only come from global App.css (do not redeclare). */

.nll { max-width: 1100px; margin: 0 auto; padding: 0 24px 64px; }

/* --- masthead --- */
.nll-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 0; }
.nll-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--pearl); font-family: var(--font-display); font-weight: 600; font-size: 19px; }
.nll-brand em { font-style: normal; color: var(--jade); }
.nll-nav { display: flex; align-items: center; gap: 18px; }
.nll-navlinks { display: flex; gap: 16px; font-family: var(--font-mono); font-size: 12px; }
.nll-navlinks a { color: var(--pearl-dim); text-decoration: none; }
.nll-navlinks a:hover { color: var(--jade); text-decoration: underline; text-underline-offset: 3px; }

/* --- CTA (molten = the one saturated accent) --- */
.nll-cta { display: inline-block; padding: 13px 26px; border-radius: 999px; background: var(--molten); color: #3d1a28; font-weight: 700; text-decoration: none; font-size: 14px; }
.nll-cta--sm { padding: 8px 16px; font-size: 12px; }
.nll-cta--ghost { background: none; border: 1px solid var(--hairline); color: var(--pearl); }
.nll-cta:focus-visible { outline: 2px solid var(--gold-ink); outline-offset: 3px; }

/* --- hero --- */
.nll-hero { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 32px; align-items: center; padding: 56px 0 40px; }
.nll-eyebrow { color: var(--gold-ink); }
.nll-h1 { font-family: var(--font-display); font-variation-settings: 'opsz' 144; font-size: clamp(32px, 6vw, 60px); line-height: 1.05; letter-spacing: -0.02em; margin: 14px 0 16px; color: var(--pearl); }
.nll-sub { font-size: 15px; line-height: 1.6; color: var(--pearl-dim); max-width: 52ch; margin: 0; }
.nll-ctas { display: flex; gap: 12px; margin-top: 26px; flex-wrap: wrap; }

.nll-hero-art { position: relative; display: flex; justify-content: center; align-items: center; }
.nll-orb { position: absolute; width: 340px; height: 340px; border-radius: 50%; background: radial-gradient(circle at 50% 45%, rgba(215, 206, 242, 0.55), rgba(205, 234, 223, 0.25) 55%, transparent 72%); filter: blur(6px); z-index: 0; }
.nll-hero-mascot { position: relative; z-index: 1; } /* mascot's only shadow = its own pearl-well glow */
.nll-hero-mascot .nl-pearl-well { animation: nl-clam-open 560ms ease-out 1 both; } /* signature load beat (reuses App.css keyframe) */
```

- [ ] **Step 3: Build to verify hero renders**

Run (from `frontend/`): `npx vite build`
Expected: build succeeds.

- [ ] **Step 4: Run tests (no regressions)**

Run: `node --test src/`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/Landing.jsx frontend/src/Landing.css
git commit -m "feat(frontend): landing shell + hero (Sea, masthead, molten CTA, glow orb, clam-open beat)"
```

---

### Task 4: Content sections — Problem, How-it-works ladder, Ledger+Roadmap, footer

Adds the three distinct-composition bands + footer inside Landing's `<main>`, with their CSS. Each section a different shape (numbered cells / ascending ladder / weighted table + rail) to break the 3-card monotony.

**Files:**
- Modify: `frontend/src/Landing.jsx` (add sections + render them)
- Modify: `frontend/src/Landing.css` (section styles)

**Interfaces:**
- Consumes: `PROBLEMS`, `STEPS`, `LEDGER_ROWS`, `ROADMAP`, `FOOTER` from `landingContent.js`.
- Produces: HowItWorks section carries `id="how-it-works"`; Problem `id="problem"`; Roadmap `id="roadmap"` (anchor targets).

- [ ] **Step 1: Add section components to Landing.jsx**

In `frontend/src/Landing.jsx`, add imports and components. Update the import line:

```jsx
import { HERO, PROBLEMS, STEPS, LEDGER_ROWS, ROADMAP, FOOTER } from './landingContent.js';
```

Add these components above `export default function Landing`:

```jsx
function LandingProblem() {
  return (
    <section id="problem" className="nl-section nll-band" style={{ '--i': 1 }}>
      <h2 className="nll-h2">The problem · retail is locked out</h2>
      <div className="nll-cells">
        {PROBLEMS.map((p) => (
          <div className="nll-cell" key={p.num}>
            <span className="nll-num">{p.num}</span>
            <h3 className="nll-cell-h">{p.title}</h3>
            <p className="nll-cell-p">{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function LandingHowItWorks() {
  return (
    <section id="how-it-works" className="nl-section nll-band" style={{ '--i': 2 }}>
      <h2 className="nll-h2">How it works · mint → settle → claim</h2>
      <ol className="nll-ladder">
        {STEPS.map((s, i) => (
          <li className="nll-rung" key={s.key} style={{ '--rung': i }}>
            <span className="nll-rung-key">{s.title}</span>
            <p className="nll-rung-p">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function LandingLedgerRoadmap() {
  return (
    <section id="roadmap" className="nl-section nll-band nll-lr" style={{ '--i': 3 }}>
      <div className="nll-ledger">
        <div className="nll-lr-head">
          <h2 className="nll-h2">Nacre Ledger · public track record</h2>
          <span className="nll-chip">Illustrative</span>
        </div>
        <table className="nll-table">
          <caption className="sr-only">Sample data — connect wallet to see live notes</caption>
          <tbody>
            {LEDGER_ROWS.map((r) => (
              <tr key={r.rank} className={r.you ? 'nll-tr nll-tr--you' : 'nll-tr'}>
                <td>#{r.rank}</td>
                <td>{r.issuer}{r.you ? ' · YOU' : ''}</td>
                <td className="nll-num-cell">{r.pnl}</td>
                <td className="nll-num-cell">{r.win}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="nll-foot-note">Ranked by realised PnL — visible before you connect.</p>
      </div>
      <ul className="nll-roadmap">
        <h2 className="nll-h2">Roadmap</h2>
        {ROADMAP.map((r) => (
          <li className="nll-road-item" key={r.title}>
            <span className="nll-tick" aria-hidden="true">✓</span>
            <span><b>{r.title}</b> — {r.body}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="nll-footer">
      <span>{FOOTER.brand}</span>
      <span className="nll-tag">{FOOTER.tag}</span>
    </footer>
  );
}
```

- [ ] **Step 2: Render the sections in Landing**

In the `Landing` component's `<main>`, replace the Task-4 comment with the sections:

```jsx
      <main>
        <LandingHero />
        <LandingProblem />
        <LandingHowItWorks />
        <LandingLedgerRoadmap />
        <LandingFooter />
      </main>
```

- [ ] **Step 3: Add section CSS to Landing.css**

Append to `frontend/src/Landing.css`:

```css
/* --- shared band --- */
.nll-band { margin-top: 36px; padding: 8px 0; }
.nll-h2 { font-family: var(--font-display); font-size: 22px; margin: 0 0 18px; color: var(--pearl); }

/* --- problem: numbered cells (3-col) --- */
.nll-cells { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.nll-cell { background: var(--obsidian-raised); border: 1px solid var(--hairline); border-radius: 16px; padding: 20px; box-shadow: var(--shadow); }
.nll-num { font-family: var(--font-mono); font-size: 12px; color: var(--gold-ink); font-weight: 700; }
.nll-cell-h { font-family: var(--font-display); font-size: 16px; margin: 8px 0 6px; color: var(--pearl); }
.nll-cell-p { font-size: 13px; line-height: 1.55; color: var(--pearl-dim); margin: 0; }

/* --- how-it-works: ascending ladder (each rung climbs left→right & up) --- */
.nll-ladder { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
.nll-rung { background: var(--obsidian-raised); border: 1px solid var(--hairline); border-left: 3px solid var(--jade); border-radius: 14px; padding: 16px 20px; box-shadow: var(--shadow); margin-left: calc(var(--rung) * 56px); } /* rising staircase, echoes the payoff ladder */
.nll-rung-key { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.12em; font-size: 12px; color: var(--jade); font-weight: 700; }
.nll-rung-p { font-size: 13px; line-height: 1.55; color: var(--pearl-dim); margin: 6px 0 0; }

/* --- ledger + roadmap: weighted table + rail (asymmetry through-line) --- */
.nll-lr { display: grid; grid-template-columns: 1.5fr 1fr; gap: 24px; align-items: start; }
.nll-lr-head { display: flex; align-items: center; gap: 10px; }
.nll-chip { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; padding: 3px 9px; border-radius: 999px; background: var(--surface-sunk); color: var(--pearl-dim); }
.nll-table { width: 100%; border-collapse: collapse; font-family: var(--font-mono); font-size: 12px; }
.nll-tr td { padding: 10px 8px; border-bottom: 1px solid var(--hairline); color: var(--pearl-dim); }
.nll-num-cell { text-align: right; }
.nll-tr--you td { background: var(--molten); color: #3d1a28; font-weight: 700; } /* molten = the one accent, on the trust signal */
.nll-tr--you td:first-child { border-top-left-radius: 10px; border-bottom-left-radius: 10px; }
.nll-tr--you td:last-child { border-top-right-radius: 10px; border-bottom-right-radius: 10px; }
.nll-foot-note { font-size: 12px; color: var(--ink-faint); margin: 10px 0 0; }
.nll-roadmap { list-style: none; margin: 0; padding: 0; }
.nll-road-item { display: flex; gap: 10px; font-size: 13px; color: var(--pearl-dim); line-height: 1.5; margin-bottom: 12px; }
.nll-road-item b { color: var(--pearl); }
.nll-tick { color: var(--jade); font-weight: 700; }

/* --- footer --- */
.nll-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 44px; padding-top: 18px; border-top: 1px solid var(--hairline); font-family: var(--font-mono); font-size: 11px; color: var(--ink-faint); }
.nll-tag { padding: 3px 10px; border-radius: 999px; background: var(--surface-sunk); color: var(--jade); font-weight: 700; }
```

- [ ] **Step 4: Build**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 5: Run tests**

Run: `node --test src/`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/Landing.jsx frontend/src/Landing.css
git commit -m "feat(frontend): landing content sections — problem cells, how-it-works ladder, weighted ledger + roadmap, footer"
```

---

### Task 5: RWD + reduced-motion + sticky mobile CTA + stagger

Responsive behaviour at `≤600px`, the single reduced-motion block, the sticky bottom Launch-App bar (mobile only), the 60ms stagger override, and smooth-scroll for the anchor CTA.

**Files:**
- Modify: `frontend/src/Landing.jsx` (add the mobile sticky bar element)
- Modify: `frontend/src/Landing.css` (RWD + reduced-motion + stagger + scroll-behavior)

**Interfaces:**
- Consumes: nothing new. The sticky bar is a `<Link to="/app">`.

- [ ] **Step 1: Add the sticky mobile CTA bar to Landing**

In `frontend/src/Landing.jsx`, add inside the outer `<div className="nl-app nll">`, after `</main>`:

```jsx
      <Link to="/app" className="nll-sticky-cta">Launch App ↗</Link>
```

- [ ] **Step 2: Add stagger override + smooth scroll (base, non-media)**

Append to `frontend/src/Landing.css`:

```css
/* 60ms stagger for landing (App.css base uses 90ms; landing has more sections) */
.nll .nl-section { animation-delay: calc(var(--i, 0) * 60ms); }

/* smooth-scroll for the "How it works ↓" anchor CTA */
html { scroll-behavior: smooth; }

/* sticky mobile CTA — hidden on desktop, shown ≤600px (see media block) */
.nll-sticky-cta { display: none; }
```

- [ ] **Step 3: Add the RWD media block**

Append to `frontend/src/Landing.css`:

```css
@media (max-width: 600px) {
  .nll-navlinks { display: none; } /* CTA is a sibling, stays visible */

  .nll-hero { grid-template-columns: 1fr; text-align: center; justify-items: center; padding: 32px 0 28px; gap: 18px; }
  .nll-hero-art { order: -1; } /* mascot above the headline */
  /* shrink the hero mascot to ~170px: override both the well's --mascot-size and
     the img's element width/height attrs (CSS width beats the HTML attribute) */
  .nll-hero-mascot .nl-pearl-well { --mascot-size: 170px; }
  .nll-hero-mascot .nl-mascot-img { width: 170px; height: 170px; }
  .nll-sub { max-width: 40ch; }
  .nll-ctas { justify-content: center; }
  .nll-orb { width: 240px; height: 240px; }

  .nll-cells { grid-template-columns: 1fr; }
  .nll-rung { margin-left: 0; } /* ladder stacks straight on mobile */
  .nll-lr { grid-template-columns: 1fr; }

  .nll-band { margin-top: 26px; } /* tighter vertical rhythm on mobile */
  .nll { padding-bottom: 96px; } /* room for the sticky bar */

  .nll-sticky-cta {
    display: block; text-align: center;
    position: fixed; left: 12px; right: 12px; bottom: 0;
    z-index: 30; margin-bottom: 10px;
    padding: 14px 26px; padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px));
    border-radius: 14px; background: var(--molten); color: #3d1a28;
    font-weight: 700; text-decoration: none; box-shadow: var(--shadow);
  }
}
```

- [ ] **Step 4: Add the single reduced-motion block**

Append to `frontend/src/Landing.css` (this must be the ONLY `prefers-reduced-motion` block in the file):

```css
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .nll-hero-mascot .nl-pearl-well { animation: none; }
  .nll .nl-section { animation: none; opacity: 1; transform: none; }
}
```

- [ ] **Step 5: Verify exactly one reduced-motion block in Landing.css**

Run (from `frontend/`): `grep -c "prefers-reduced-motion" src/Landing.css`
Expected: `1`

- [ ] **Step 6: Verify Landing.css does not redeclare nl-reveal**

Run: `grep -c "@keyframes nl-reveal" src/Landing.css`
Expected: `0`

- [ ] **Step 7: Build + tests**

Run: `npx vite build` → succeeds. Then `node --test src/` → all pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/Landing.jsx frontend/src/Landing.css
git commit -m "feat(frontend): landing RWD ≤600px + reduced-motion + sticky mobile CTA + 60ms stagger"
```

---

### Task 6: Masthead logo → home Link + relocate the click-cycle easter-egg (App.jsx/App.css)

Resolves O1/D3. In the app (`/app`) masthead, the logo becomes `<Link to="/">`; the mascot click-cycle easter-egg moves to the eyebrow pearl icon so it isn't lost. Prune/relocate the dead `.nl-mast-logo-btn` block.

**Files:**
- Modify: `frontend/src/App.jsx` (masthead logo → Link; move cycle onClick to eyebrow)
- Modify: `frontend/src/App.css` (`.nl-mast-logo-btn` block → logo link + relocated cycle styles)

**Interfaces:**
- Consumes: `Link` from `react-router-dom` (add import); existing `mascotSrc`, `MASCOT_CYCLE`, `mascotIdx` state stay.

- [ ] **Step 1: Import Link in App.jsx**

Add to `frontend/src/App.jsx` imports (top of file):

```jsx
import { Link } from 'react-router-dom';
```

- [ ] **Step 2: Replace the masthead logo button with a home Link, move the cycle to the eyebrow**

In `frontend/src/App.jsx`, the masthead currently is (around lines 110–124):

```jsx
        <button type="button" className="nl-mast-logo-btn" aria-label="PearlFoundry"
          onClick={() => setMascotIdx((i) => (i + 1) % MASCOT_CYCLE.length)}>
          <img className="nl-mast-logo"
            src={mascotSrc(MASCOT_CYCLE[mascotIdx])}
            alt="" width="80" height="80" />
        </button>
        <div className="nl-mast-titles">
          <span className="nl-eyebrow">
            <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21C5 16 3 10.5 3 8a4.2 3.4 0 0 1 18 0c0 2.5-2 8-9 13Z" />
              <path d="M12 21V8.5M12 21 7.4 10M12 21 16.6 10M12 21 4.6 12.5M12 21 19.4 12.5" />
            </svg>
            Testnet · DeepBook Predict
          </span>
```

Replace it with — logo is a home Link (static current cycle image, no longer the cycle trigger); the eyebrow becomes the cycle trigger via a button wrapping the pearl `<svg>`:

```jsx
        <Link to="/" className="nl-mast-logo-link" aria-label="PearlFoundry home">
          <img className="nl-mast-logo"
            src={mascotSrc(MASCOT_CYCLE[mascotIdx])}
            alt="" width="80" height="80" />
        </Link>
        <div className="nl-mast-titles">
          <span className="nl-eyebrow">
            <button type="button" className="nl-eyebrow-cycle" aria-label="Cycle mascot"
              onClick={() => setMascotIdx((i) => (i + 1) % MASCOT_CYCLE.length)}>
              <svg className="nl-li" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 21C5 16 3 10.5 3 8a4.2 3.4 0 0 1 18 0c0 2.5-2 8-9 13Z" />
                <path d="M12 21V8.5M12 21 7.4 10M12 21 16.6 10M12 21 4.6 12.5M12 21 19.4 12.5" />
              </svg>
            </button>
            Testnet · DeepBook Predict
          </span>
```

- [ ] **Step 3: Replace the `.nl-mast-logo-btn` CSS block**

In `frontend/src/App.css` (~lines 347–363), find the `.nl-mast-logo-btn` rules (the button reset + grayscale-at-rest + hover/focus colour-reveal + bob). Replace the whole block with a plain link wrapper + the relocated cycle affordance on the eyebrow button. Keep whatever `.nl-mast-logo` (the `<img>`) rules exist unchanged. New rules:

```css
/* logo is now a home link (no easter-egg); cycle moved to the eyebrow button */
.nl-mast-logo-link { display: inline-flex; border-radius: 50%; }
.nl-mast-logo-link:focus-visible { outline: 2px solid var(--gold-ink); outline-offset: 3px; }

.nl-eyebrow-cycle { display: inline-flex; align-items: center; padding: 0; margin: 0; background: none; border: none; cursor: pointer; color: inherit; -webkit-appearance: none; appearance: none; }
.nl-eyebrow-cycle:focus-visible { outline: 2px solid var(--gold-ink); outline-offset: 2px; border-radius: 4px; }
```

Note: if the old block also styled `.nl-mast-logo-btn .nl-mast-logo` with `grayscale(1)` + hover reveal, drop those — the logo image now shows the current cycle variant in full colour (consistent with the rest of the masthead). If you want to preserve the grayscale-reveal flavour, attach it to `.nl-eyebrow-cycle:hover .nl-li` instead; optional, not required.

- [ ] **Step 4: Grep to confirm no orphaned `.nl-mast-logo-btn` references remain**

Run (from `frontend/`): `grep -rn "nl-mast-logo-btn" src/`
Expected: no matches (both JSX and CSS references replaced).

- [ ] **Step 5: Build + tests**

Run: `npx vite build` → succeeds. Then `node --test src/` → all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.jsx frontend/src/App.css
git commit -m "feat(frontend): /app masthead logo → home link, relocate mascot click-cycle to eyebrow (O1/D3)"
```

---

## Final verification (after all tasks)

- [ ] `node --test src/` — all green (existing + `landingContent.test.js`).
- [ ] `npx vite build` — green.
- [ ] `grep -rn "nl-mast-logo-btn" src/` — empty.
- [ ] `grep -c "prefers-reduced-motion" src/Landing.css` — `1`.
- [ ] `grep -c "@keyframes nl-reveal" src/Landing.css` — `0`.
- [ ] **Human browser pass** (`cd frontend && npm run dev`): `/` landing renders (hero clam-open beat, glow orb, ladder, molten YOU row, Illustrative chip); resize ≤600px → reflow + sticky CTA + safe-area; "Launch App" → `/app` with wallet working; `/app` logo → back to `/`; eyebrow pearl click still cycles the mascot; hard-refresh on `/app` does not 404 (under `vite preview`).

## Spec → task coverage

- Routing / provider order / App.css global / SPA fallback → Task 1.
- `react-router-dom@^6.28` pin → Task 1 (Global Constraints).
- `landingContent` + honesty test → Task 2.
- Hero (asymmetric, size 180, glow orb, clam-open beat, fonts, 60px clamp, one shadow) → Task 3.
- Problem / How-it-works ladder / Ledger+Roadmap (illustrative chip + sr-only caption + molten YOU row) / footer → Task 4.
- RWD ≤600px / nav-CTA sibling / sticky bar z-index+safe-area / single reduced-motion / no keyframe redeclare / 60ms stagger / anchor smooth-scroll → Task 5.
- Masthead logo → Link + easter-egg relocation + `.nl-mast-logo-btn` prune (O1/D3) → Task 6.
- Accent dominance (molten CTA + YOU row only) → Tasks 3 & 4 CSS.
- Copy-source / no-new-claims → Task 2 content + test.
