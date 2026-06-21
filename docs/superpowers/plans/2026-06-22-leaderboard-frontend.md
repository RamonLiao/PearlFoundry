# Leaderboard Frontend View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public, artist-grade "Nacre Ledger" leaderboard to the dApp, ranked by realized PnL, visible pre-wallet-connect and highlighting the connected user's row.

**Architecture:** Read-only React component fetching the existing `GET /leaderboard` REST endpoint (zero backend change). Aesthetics delivered via a shared `theme.css` token layer + a component-scoped `Leaderboard.css`; the rest of the frontend stays on its current bare styling this round.

**Tech Stack:** React 18, Vite 5, `@mysten/dapp-kit-react` v2, `@mysten/sui` v2 (`normalizeSuiAddress`), Google Fonts (Fraunces, Martian Mono). No test runner (frontend has none — kept that way per spec).

## Global Constraints

- dUSDC = 6 decimals; `1 dUSDC = 1_000_000` base units. Display PnL/fees as `X.XX dUSDC`.
- Backend untouched: no edits under `scripts/`. `GET /leaderboard` returns rows `{ issuer, realized_pnl, win_rate, total_perf_fee, note_count }`, already sorted `realized_pnl DESC`.
- Address self-match MUST normalize both sides: `normalizeSuiAddress(account.address) === normalizeSuiAddress(row.issuer)`. Never raw `===`.
- Anti-AI-slop: no Inter/Roboto/system-ui fonts, no purple-on-white gradients, no `rounded-2xl shadow-lg` cards, no zebra striping.
- No new npm dependency: `@mysten/sui` is already installed (peer of dapp-kit). No test runner introduced.
- Verification per task: `cd frontend && npx vite build` must succeed (no syntax/import errors), plus the manual dev checks listed.
- This round styles ONLY the Leaderboard. Do NOT edit `MyNotes.jsx` styling or restructure `App.jsx` beyond the single mount line.

---

### Task 1: Foundation — fonts + theme tokens

**Files:**
- Modify: `frontend/index.html`
- Create: `frontend/src/theme.css`
- Modify: `frontend/src/main.jsx` (add `import './theme.css';`)

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties on `:root` used by Task 2 — `--obsidian`, `--obsidian-raised`, `--pearl`, `--pearl-dim`, `--nacre`, `--jade`, `--rust`, `--molten`, `--hairline`, `--font-display`, `--font-mono`. Global `body` atmosphere (obsidian bg + nacre radial glow + grain).

- [ ] **Step 1: Read current `index.html`**

Run: confirm the current contents so the font `<link>` lands in `<head>` without clobbering the existing root/script tags.

- [ ] **Step 2: Add Google Font links to `frontend/index.html`**

Inside `<head>`, above the existing content, add:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Martian+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
```

- [ ] **Step 3: Create `frontend/src/theme.css`**

```css
:root {
  --obsidian: #0b0d12;
  --obsidian-raised: #14171f;
  --pearl: #f2ede3;
  --pearl-dim: #9aa0ad;
  --nacre: linear-gradient(110deg, #b8e0d2, #c9c1e8, #f3d9c9, #bfe3e0);
  --jade: #5fb89a;
  --rust: #c8765a;
  --molten: linear-gradient(#f5c869, #d99a3c);
  --hairline: rgba(242, 237, 227, 0.08);
  --font-display: 'Fraunces', Georgia, 'Times New Roman', serif;
  --font-mono: 'Martian Mono', ui-monospace, 'SFMono-Regular', monospace;
}

body {
  margin: 0;
  min-height: 100vh;
  color: var(--pearl);
  background-color: var(--obsidian);
  background-image:
    radial-gradient(110% 55% at 50% -8%, rgba(170, 205, 220, 0.07), transparent 62%),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E");
  background-attachment: fixed;
}
```

- [ ] **Step 4: Import the theme in `frontend/src/main.jsx`**

Add as the first import line of `frontend/src/main.jsx`:

```js
import './theme.css';
```

- [ ] **Step 5: Verify build passes**

Run: `cd frontend && npx vite build`
Expected: build completes, no errors, `dist/` emitted.

- [ ] **Step 6: Manual visual check**

Run: `cd frontend && npx vite dev`
Expected: page background is near-black obsidian with a faint cool glow at top and subtle grain; existing "Structured Note Factory" text renders in pearl (off-white). Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add frontend/index.html frontend/src/theme.css frontend/src/main.jsx
git commit -m "feat(frontend): Nacre Ledger theme tokens + fonts foundation"
```

---

### Task 2: Leaderboard component + data helper + mount

**Files:**
- Modify: `frontend/src/api.js` (add `getLeaderboard`)
- Create: `frontend/src/Leaderboard.jsx`
- Create: `frontend/src/Leaderboard.css`
- Modify: `frontend/src/App.jsx` (import + mount outside the `account &&` guard)

**Interfaces:**
- Consumes: `getLeaderboard()` from `api.js` → `Promise<Array<{ issuer: string, realized_pnl: number, win_rate: number, total_perf_fee: number, note_count: number }>>`. Theme tokens from Task 1.
- Produces: default-exported `Leaderboard({ account })` React component (`account` is the dapp-kit account object or `null`).

- [ ] **Step 1: Add `getLeaderboard` to `frontend/src/api.js`**

Append (mirrors the existing `getNotes` error pattern):

```js
export async function getLeaderboard() {
  const r = await fetch(`${API}/leaderboard`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'failed to load leaderboard'); e.code = j.code; e.detail = j.detail; throw e; }
  return j;
}
```

- [ ] **Step 2: Create `frontend/src/Leaderboard.css`**

```css
.nl-board {
  max-width: 760px;
  margin: 28px auto 0;
  background: var(--obsidian-raised);
  border: 1px solid var(--hairline);
  border-radius: 4px;
  padding: 22px 24px 26px;
}

.nl-board__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  border-bottom: 1px solid transparent;
  border-image: var(--nacre) 1;
  padding-bottom: 12px;
  margin-bottom: 6px;
}

.nl-board__title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 26px;
  letter-spacing: -0.01em;
  margin: 0;
  color: var(--pearl);
}

.nl-refresh {
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--pearl-dim);
  background: transparent;
  border: 1px solid var(--hairline);
  border-radius: 3px;
  padding: 6px 12px;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
}
.nl-refresh:hover:not(:disabled) { color: var(--pearl); border-color: rgba(242, 237, 227, 0.25); }
.nl-refresh:disabled { opacity: 0.5; cursor: default; }

.nl-error {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--rust);
  white-space: pre-wrap;
  margin: 12px 0 0;
}
.nl-empty {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--pearl-dim);
  margin: 16px 0 4px;
}

.nl-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.nl-th {
  text-align: left;
  font-weight: 500;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--pearl-dim);
  padding: 14px 10px 10px;
  border-bottom: 1px solid var(--hairline);
}
.nl-th--num { text-align: right; }
.nl-th--rank { width: 64px; }

.nl-row {
  border-bottom: 1px solid var(--hairline);
  opacity: 0;
  transform: translateY(6px);
  animation: nl-reveal 360ms ease forwards;
  animation-delay: calc(var(--i) * 40ms);
  transition: background-color 120ms ease;
}
.nl-row:hover { background-color: rgba(242, 237, 227, 0.03); }

@keyframes nl-reveal {
  to { opacity: 1; transform: none; }
}

.nl-td {
  padding: 13px 10px;
  font-size: 13px;
  color: var(--pearl);
  height: 52px;
  box-sizing: border-box;
}
.nl-td--num { text-align: right; }
.nl-td--rank { position: relative; }

.nl-rank-n { color: var(--pearl-dim); }
.nl-pip {
  display: inline-block;
  width: 7px; height: 7px;
  border-radius: 50%;
  margin-right: 8px;
  vertical-align: middle;
}
.nl-pip--gold { background: var(--molten); box-shadow: 0 0 6px rgba(245, 200, 105, 0.5); }
.nl-pip--brass { background: #9c8045; }

.nl-issuer { color: var(--pearl); }
.nl-you {
  font-size: 9px;
  letter-spacing: 0.12em;
  margin-left: 10px;
  padding: 2px 6px;
  border-radius: 2px;
  color: var(--obsidian);
  background: var(--nacre);
  vertical-align: middle;
}

.nl-row--you {
  background-color: rgba(190, 215, 220, 0.06);
  box-shadow: inset 2px 0 0 0 #c9c1e8;
}

.nl-pnl.is-pos { color: var(--jade); }
.nl-pnl.is-neg { color: var(--rust); }

.nl-win { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.nl-meter {
  width: 56px; height: 1px;
  background: var(--hairline);
  overflow: hidden;
}
.nl-meter__fill { display: block; height: 100%; background: var(--nacre); }

@media (prefers-reduced-motion: reduce) {
  .nl-row { opacity: 1; transform: none; animation: none; }
  .nl-row, .nl-refresh { transition: none; }
}
```

- [ ] **Step 3: Create `frontend/src/Leaderboard.jsx`**

```jsx
import { useEffect, useState } from 'react';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { getLeaderboard } from './api.js';
import './Leaderboard.css';

const DUSDC = 1_000_000; // 6 decimals

/**
 * Leaderboard — public issuer ranking by realized PnL.
 * Backend (`GET /leaderboard`) already sorts realized_pnl DESC, so the array
 * index IS the rank; no client-side re-sort.
 *
 * @param {{ account: { address: string } | null }} props
 */
export default function Leaderboard({ account }) {
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setMsg('');
    try {
      setRows(await getLeaderboard());
    } catch (e) {
      // Fail loud: surface backend {error, code} verbatim.
      setMsg(`Failed to load leaderboard: ${e.message}${e.code ? ` [${e.code}]` : ''}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Normalize BOTH sides: indexer stores full padded on-chain form; wallet form varies.
  const me = account ? normalizeSuiAddress(account.address) : null;

  return (
    <section className="nl-board">
      <header className="nl-board__head">
        <h2 className="nl-board__title">Leaderboard</h2>
        <button className="nl-refresh" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      {msg && <pre className="nl-error">{msg}</pre>}
      {rows.length === 0 && !msg && <p className="nl-empty">No settled notes yet.</p>}

      {rows.length > 0 && (
        <table className="nl-table">
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
            {rows.map((r, i) => {
              const isYou = me != null && normalizeSuiAddress(r.issuer) === me;
              const pnl = Number(r.realized_pnl) / DUSDC;
              const winPct = Number(r.win_rate) * 100;
              const perf = Number(r.total_perf_fee) / DUSDC;
              return (
                <tr key={r.issuer} className={`nl-row${isYou ? ' nl-row--you' : ''}`} style={{ '--i': i }}>
                  <td className="nl-td nl-td--rank">
                    {i === 0 && <span className="nl-pip nl-pip--gold" />}
                    {i > 0 && i < 3 && <span className="nl-pip nl-pip--brass" />}
                    <span className="nl-rank-n">{i + 1}</span>
                  </td>
                  <td className="nl-td nl-issuer" title={r.issuer}>
                    {r.issuer.slice(0, 8)}…{r.issuer.slice(-4)}
                    {isYou && <span className="nl-you">YOU</span>}
                  </td>
                  <td className={`nl-td nl-td--num nl-pnl ${pnl >= 0 ? 'is-pos' : 'is-neg'}`}>
                    {pnl > 0 ? '+' : ''}{pnl.toFixed(2)} dUSDC
                  </td>
                  <td className="nl-td nl-td--num">
                    <span className="nl-win">
                      {winPct.toFixed(1)}%
                      <span className="nl-meter">
                        <span className="nl-meter__fill" style={{ width: `${Math.max(0, Math.min(100, winPct))}%` }} />
                      </span>
                    </span>
                  </td>
                  <td className="nl-td nl-td--num">{r.note_count}</td>
                  <td className="nl-td nl-td--num">{perf.toFixed(2)} dUSDC</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Mount in `frontend/src/App.jsx`**

Add the import next to the existing `import MyNotes from './MyNotes.jsx';`:

```jsx
import Leaderboard from './Leaderboard.jsx';
```

Place `<Leaderboard account={account} />` OUTSIDE the `{account && (...)}` block so it shows pre-connect. Concretely, change the return so the structure is:

```jsx
return (
  <div style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'system-ui' }}>
    <h1>Structured Note Factory</h1>
    <ConnectButton />
    <Leaderboard account={account} />
    {account && (
      <>
        <p>Connected: {account.address}</p>
        <button disabled={busy} onClick={onMint} aria-busy={busy}>
          {busy ? 'Minting…' : 'Mint Range Note'}
        </button>
        <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>{status}</pre>
        <MyNotes account={account} signExec={signExec} />
      </>
    )}
  </div>
);
```

- [ ] **Step 5: Verify build passes**

Run: `cd frontend && npx vite build`
Expected: build completes, no errors. (Catches the `@mysten/sui/utils` import path and JSX syntax.)

- [ ] **Step 6: Manual visual + behavior check**

Prereq: a running indexer with at least one settled note. In one shell: `cd scripts/indexer && node server.js indexer.db 8787`. In another: `cd frontend && npx vite dev`.

Expected:
1. Leaderboard renders BEFORE connecting a wallet (public).
2. Rows appear ranked PnL-descending with a staggered fade-in; rank #1 has a molten-gold pip, #2–3 brass.
3. PnL/Perf show `X.XX dUSDC`; positive PnL jade-green, negative rust-red; digits column-aligned (tabular mono).
4. Win Rate shows `NN.N%` with a thin nacre meter bar.
5. Connect the wallet that issued a note → that row gets the nacre left-border wash + `YOU` tag (confirms `normalizeSuiAddress` match works).
6. Empty DB → `No settled notes yet.`; stop the indexer and Refresh → fail-loud `Failed to load leaderboard: …` in rust.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api.js frontend/src/Leaderboard.jsx frontend/src/Leaderboard.css frontend/src/App.jsx
git commit -m "feat(frontend): Nacre Ledger leaderboard view with self-row highlight"
```

---

## Post-implementation

- Run the mandatory two-round review (`dual-review`) — this is frontend/SUI-integration code, so per project routing also apply `sui-frontend` review for the dapp-kit/address handling.
- Update `tasks/progress.md`.
