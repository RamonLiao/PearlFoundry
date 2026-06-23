# Site-wide Nacre Ledger Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify `App.jsx`, `MyNotes.jsx`, ConnectButton chrome, and `index.html` into the established Nacre Ledger aesthetic (from `Leaderboard.jsx`/`.css`), plus 3 deferred cleanups.

**Architecture:** Presentation-layer only. New `App.css` reuses the `nl-` class convention + `theme.css` tokens. JSX files drop inline styles and mount classes. ConnectButton wrapped in chrome, internals untouched. One business-logic line changes (address normalize in MyNotes).

**Tech Stack:** React 18, Vite 5, `@mysten/dapp-kit-react` 2.x, `@mysten/sui` 2.x (`normalizeSuiAddress` from `@mysten/sui/utils`). No test harness (no vitest) — verification gate is `npm run build` + visual check.

## Global Constraints

- No new dependencies. No changes to `api.js`, `mint.js`, backend, or any mint/claim logic.
- All colors via `theme.css` tokens — no new stray hex literals.
- Reuse existing `Leaderboard.css` classes where applicable (`.nl-table`, `.nl-th`, `.nl-td`, `.nl-row`, `.nl-board`); do NOT duplicate them in `App.css`.
- Every component honors `@media (prefers-reduced-motion: reduce)`.
- ConnectButton: wrap only, never CSS-override its internal rendered classes.
- Working dir for all `npm`/path-relative commands: `frontend/`.
- Verification per task: `cd frontend && npm run build` must exit 0.

---

### Task 1: Cleanups (tokens, de-hardcode, charset)

**Files:**
- Modify: `frontend/src/theme.css` (add 2 tokens after `--molten` line)
- Modify: `frontend/src/Leaderboard.css:112` and `:128`
- Modify: `frontend/index.html` (`<head>` order)

**Interfaces:**
- Produces: CSS vars `--brass`, `--nacre-accent` consumed by `Leaderboard.css` and later `App.css`.

- [ ] **Step 1: Add tokens to `theme.css`** — after the `--molten: linear-gradient(...);` line, inside `:root`:

```css
  --brass: #9c8045;
  --nacre-accent: #c9c1e8;
```

- [ ] **Step 2: De-hardcode `Leaderboard.css`**

Line 112: `.nl-pip--brass { background: #9c8045; }` → `.nl-pip--brass { background: var(--brass); }`
Line 128: in `.nl-row--you`, `box-shadow: inset 2px 0 0 0 #c9c1e8;` → `box-shadow: inset 2px 0 0 0 var(--nacre-accent);`

- [ ] **Step 3: Fix `index.html` head order** — make `<meta charset="utf-8" />` the FIRST child of `<head>`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Martian+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
    <title>Structured Note Factory</title>
  </head>
  <body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>
</html>
```

- [ ] **Step 4: Verify build**

Run: `cd frontend && npm run build`
Expected: exit 0, no CSS/HTML errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theme.css frontend/src/Leaderboard.css frontend/index.html
git commit -m "refactor(frontend): tokenize brass/nacre-accent, fix meta charset order"
```

---

### Task 2: Logo variants

**Files:**
- Create: `frontend/public/logo-mark.png`, `frontend/public/logo-mark-tinted.png`, `frontend/public/logo-mark.svg`
- Create (backup): `docs/logo-variants/` copies of all three + source note

**Interfaces:**
- Produces: three asset paths under `/` (Vite public root): `/logo-mark.png`, `/logo-mark-tinted.png`, `/logo-mark.svg`. App masthead defaults to `/logo-mark.svg`.

- [ ] **Step 1: Make dirs**

```bash
mkdir -p frontend/public docs/logo-variants
```

- [ ] **Step 2: Variant (a) — transparent bg**

```bash
magick docs/logo_3.png -fuzz 12% -transparent white frontend/public/logo-mark.png
```

- [ ] **Step 3: Variant (b) — transparent + nacre/pearl tint**

```bash
magick docs/logo_3.png -fuzz 12% -transparent white \
  \( +clone -fill "#c9c1e8" -colorize 55% \) -compose over -composite \
  -modulate 100,70 frontend/public/logo-mark-tinted.png
```
(If the composite flattens transparency, fall back to: `magick docs/logo_3.png -fuzz 12% -transparent white -modulate 100,40 -fill "#c9c1e8" -tint 40 frontend/public/logo-mark-tinted.png`.)

- [ ] **Step 4: Variant (c) — hand-drawn refined SVG glyph**

Create `frontend/public/logo-mark.svg` — a simple pearl-in-shell: nacre-gradient shell arc + molten-gradient pearl. Tuned to ~28px render.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Nacre Ledger">
  <defs>
    <linearGradient id="nacre" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#b8e0d2"/>
      <stop offset="0.4" stop-color="#c9c1e8"/>
      <stop offset="0.7" stop-color="#f3d9c9"/>
      <stop offset="1" stop-color="#bfe3e0"/>
    </linearGradient>
    <radialGradient id="pearl" cx="0.38" cy="0.34" r="0.7">
      <stop offset="0" stop-color="#fbe9b8"/>
      <stop offset="0.5" stop-color="#f5c869"/>
      <stop offset="1" stop-color="#d99a3c"/>
    </radialGradient>
  </defs>
  <!-- shell: two fan halves -->
  <path d="M6 40 Q32 8 58 40 Q46 34 32 34 Q18 34 6 40 Z" fill="url(#nacre)" opacity="0.92"/>
  <path d="M8 42 Q32 60 56 42 Q44 50 32 50 Q20 50 8 42 Z" fill="url(#nacre)" opacity="0.7"/>
  <!-- shell ribs -->
  <g stroke="#0b0d12" stroke-opacity="0.18" stroke-width="0.8" fill="none">
    <path d="M32 33 L24 14"/><path d="M32 33 L32 12"/><path d="M32 33 L40 14"/>
  </g>
  <!-- pearl -->
  <circle cx="32" cy="40" r="9" fill="url(#pearl)"/>
  <circle cx="29" cy="37" r="2.4" fill="#fff" opacity="0.65"/>
</svg>
```

- [ ] **Step 5: Back up variants + source note**

```bash
cp frontend/public/logo-mark.png frontend/public/logo-mark-tinted.png frontend/public/logo-mark.svg docs/logo-variants/
printf 'Variants of docs/logo_3.png for the masthead mark.\n(a) logo-mark.png  transparent bg\n(b) logo-mark-tinted.png  nacre tint\n(c) logo-mark.svg  hand-drawn refined glyph (current default)\nUser to pick final.\n' > docs/logo-variants/README.txt
```

- [ ] **Step 6: Verify assets exist & are non-empty**

Run: `ls -l frontend/public/logo-mark.* docs/logo-variants/`
Expected: all three present, png files > 1KB, svg present.

- [ ] **Step 7: Commit**

```bash
git add frontend/public/logo-mark.png frontend/public/logo-mark-tinted.png frontend/public/logo-mark.svg docs/logo-variants/
git commit -m "feat(frontend): add 3 masthead logo variants (transparent/tinted/svg)"
```

---

### Task 3: `App.css` stylesheet

**Files:**
- Create: `frontend/src/App.css`

**Interfaces:**
- Consumes: tokens from `theme.css` (incl. `--brass`, `--nacre-accent` from Task 1); reuses `.nl-table`/`.nl-th`/`.nl-td`/`.nl-row`/`.nl-board` defined in `Leaderboard.css` (Task 5 imports both stylesheets transitively).
- Produces: classes consumed by `App.jsx` (Task 4) and `MyNotes.jsx` (Task 5): `.nl-app`, `.nl-masthead`, `.nl-mast-logo`, `.nl-mast-titles`, `.nl-eyebrow`, `.nl-mast-title`, `.nl-connect`, `.nl-card`, `.nl-card__head`, `.nl-card__title`, `.nl-btn`, `.nl-btn--primary`, `.nl-pill`, `.nl-pill__dot`, `.nl-status`, `.nl-status--ok`, `.nl-status--err`, `.nl-statuspip`, `.nl-statuspip--settled`, `.nl-statuspip--claimable`, `.nl-statuspip--pending`, `.nl-section` (+ `--i` reveal).

- [ ] **Step 1: Write `frontend/src/App.css`**

```css
.nl-app {
  max-width: 760px;
  margin: 40px auto 64px;
  padding: 0 16px;
}

/* page-load staggered section reveal */
.nl-section {
  opacity: 0;
  transform: translateY(8px);
  animation: nl-reveal 420ms ease forwards;
  animation-delay: calc(var(--i, 0) * 90ms);
}

/* masthead */
.nl-masthead {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-bottom: 16px;
  border-bottom: 1px solid transparent;
  border-image: var(--nacre) 1;
  margin-bottom: 28px;
}
.nl-mast-logo { width: 40px; height: 40px; flex: none; object-fit: contain; }
.nl-mast-titles { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.nl-eyebrow {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--pearl-dim);
}
.nl-mast-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 28px;
  letter-spacing: -0.01em;
  line-height: 1;
  margin: 0;
  color: var(--pearl);
}
.nl-connect { margin-left: auto; }

/* card surface (shares the visual language of .nl-board) */
.nl-card {
  background: var(--obsidian-raised);
  border: 1px solid var(--hairline);
  border-radius: 4px;
  padding: 22px 24px 26px;
  margin-top: 22px;
}
.nl-card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  border-bottom: 1px solid transparent;
  border-image: var(--nacre) 1;
  padding-bottom: 12px;
  margin-bottom: 16px;
}
.nl-card__title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 22px;
  letter-spacing: -0.01em;
  margin: 0;
  color: var(--pearl);
}

/* buttons */
.nl-btn {
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--pearl-dim);
  background: transparent;
  border: 1px solid var(--hairline);
  border-radius: 3px;
  padding: 7px 14px;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
}
.nl-btn:hover:not(:disabled) { color: var(--pearl); border-color: rgba(242, 237, 227, 0.25); }
.nl-btn:disabled { opacity: 0.5; cursor: default; }

.nl-btn--primary {
  color: var(--obsidian);
  background: var(--molten);
  border: none;
  font-weight: 600;
  padding: 10px 20px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
}
.nl-btn--primary:hover:not(:disabled) { filter: brightness(1.06); }
.nl-btn--primary:disabled { opacity: 0.55; }

/* connected-address pill */
.nl-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--pearl-dim);
  background: rgba(242, 237, 227, 0.03);
  border: 1px solid var(--hairline);
  border-radius: 999px;
  padding: 5px 12px;
  margin-bottom: 16px;
}
.nl-pill__dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--nacre);
  flex: none;
}

/* status feedback */
.nl-status {
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: pre-wrap;
  margin: 14px 0 0;
  opacity: 0;
  transform: translateY(4px);
  animation: nl-reveal 240ms ease forwards;
}
.nl-status--ok { color: var(--jade); }
.nl-status--err { color: var(--rust); }

/* MyNotes status pip */
.nl-statuspip {
  display: inline-block;
  width: 7px; height: 7px;
  border-radius: 50%;
  margin-right: 8px;
  vertical-align: middle;
}
.nl-statuspip--settled { background: var(--jade); }
.nl-statuspip--pending { background: var(--pearl-dim); opacity: 0.4; }
.nl-statuspip--claimable {
  background: var(--molten);
  box-shadow: 0 0 6px rgba(245, 200, 105, 0.5);
  animation: nl-pulse 1.6s ease-in-out infinite;
}

@keyframes nl-reveal { to { opacity: 1; transform: none; } }
@keyframes nl-pulse {
  0%, 100% { box-shadow: 0 0 4px rgba(245, 200, 105, 0.35); }
  50% { box-shadow: 0 0 9px rgba(245, 200, 105, 0.7); }
}

@media (prefers-reduced-motion: reduce) {
  .nl-section, .nl-status { opacity: 1; transform: none; animation: none; }
  .nl-statuspip--claimable { animation: none; }
  .nl-btn { transition: none; }
}
```

- [ ] **Step 2: Verify build** (CSS unused until imported, but must parse via the import in Task 4 — defer build gate to Task 4. For now lint by eye.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.css
git commit -m "feat(frontend): add App.css Nacre Ledger stylesheet"
```

---

### Task 4: Migrate `App.jsx`

**Files:**
- Modify: `frontend/src/App.jsx` (full rewrite of the JSX return + add import)

**Interfaces:**
- Consumes: `App.css` classes (Task 3); existing `runMint`, `EXPLORER`, `MyNotes`, `Leaderboard`, dapp-kit hooks (unchanged).
- Produces: nothing for later tasks (leaf).

- [ ] **Step 1: Rewrite `App.jsx`** — keep ALL logic (`onMint`, `signExec`, sender-assert, busy, fail-loud); replace presentation only. Status class derives from a `statusKind` state (`'' | 'ok' | 'err'`).

```jsx
import { useState } from 'react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { runMint } from './mint.js';
import { EXPLORER } from './config.js';
import MyNotes from './MyNotes.jsx';
import Leaderboard from './Leaderboard.jsx';
import './App.css';

export default function App() {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState(/** @type {''|'ok'|'err'} */ (''));
  const [busy, setBusy] = useState(false);

  // Shared signExec: wraps dAppKit.signAndExecuteTransaction; accepts a Transaction object.
  const signExec = (tx) => dAppKit.signAndExecuteTransaction({ transaction: tx });

  async function onMint() {
    if (!account) return;
    setBusy(true);
    setStatus('');
    setStatusKind('');
    try {
      // Sender-assert: never sign a tx built for a different address (spec §5).
      const sender = account.address;

      const out = await runMint({ signExec, sender });
      setStatus(`Minted OK — ${EXPLORER}${out.mintDigest}`);
      setStatusKind('ok');
    } catch (e) {
      // Fail loud: surface backend {error, code} verbatim; never hide PTB1-landed-but-PTB2-failed.
      setStatus(`FAILED: ${e.message}${e.code ? ` [${e.code}]` : ''}`);
      setStatusKind('err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nl-app">
      <header className="nl-masthead nl-section" style={{ '--i': 0 }}>
        <img className="nl-mast-logo" src="/logo-mark.svg" alt="" />
        <div className="nl-mast-titles">
          <span className="nl-eyebrow">Structured Note Factory · Testnet</span>
          <h1 className="nl-mast-title">Structured Note Factory</h1>
        </div>
        <div className="nl-connect"><ConnectButton /></div>
      </header>

      <div className="nl-section" style={{ '--i': 1 }}>
        <Leaderboard account={account} />
      </div>

      {account && (
        <>
          <section className="nl-card nl-section" style={{ '--i': 2 }}>
            <div className="nl-card__head">
              <h2 className="nl-card__title">Issue a Note</h2>
            </div>
            <div className="nl-pill">
              <span className="nl-pill__dot" />
              {account.address.slice(0, 10)}…{account.address.slice(-6)}
            </div>
            <div>
              <button
                className="nl-btn nl-btn--primary"
                disabled={busy}
                onClick={onMint}
                aria-busy={busy}
              >
                {busy ? 'Minting…' : 'Mint Range Note'}
              </button>
            </div>
            {status && (
              <pre className={`nl-status ${statusKind === 'ok' ? 'nl-status--ok' : 'nl-status--err'}`}>
                {statusKind === 'ok' ? '✓ ' : ''}{status}
              </pre>
            )}
          </section>

          <div className="nl-section" style={{ '--i': 3 }}>
            <MyNotes account={account} signExec={signExec} />
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npm run build`
Expected: exit 0; `App.css` parses; no missing-import errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(frontend): migrate App to Nacre Ledger masthead + mint card"
```

---

### Task 5: Migrate `MyNotes.jsx` (table + normalize fix)

**Files:**
- Modify: `frontend/src/MyNotes.jsx`

**Interfaces:**
- Consumes: `App.css` + `Leaderboard.css` classes (`.nl-board`/`.nl-table`/`.nl-th`/`.nl-td`/`.nl-row`/`.nl-refresh`/`.nl-empty`/`.nl-error` from Leaderboard; `.nl-btn`/`.nl-statuspip*`/`.nl-status*` from App.css). Import `'./Leaderboard.css'` so this component's classes resolve even if rendered standalone.
- Consumes: `normalizeSuiAddress` from `@mysten/sui/utils` (same import Leaderboard already uses).

- [ ] **Step 1: Rewrite `MyNotes.jsx`** — keep ALL logic (`load`, `claim`, oracle resolve, result-union, fail-loud); change presentation to a table and add the normalize fix.

```jsx
import { useEffect, useState } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { getNotes, getOracle, postTx } from './api.js';
import { EXPLORER } from './config.js';
import './Leaderboard.css';

/**
 * MyNotes — lists the connected address's notes and allows claiming expired ones.
 *
 * Real column names from scripts/indexer/db.js + queries.js listNotes:
 *   note_id, manager_id, expiry_ts_ms, settled (LEFT JOIN settlements), strategy (hex→utf8)
 *
 * oracle_id is NOT stored in the notes table. It is resolved at claim time via
 * GET /oracle?asset=<strategy>&expiry=<expiry_ts_ms> (added to server.js).
 *
 * @param {{ account: { address: string }, signExec: (tx: Transaction) => Promise<any> }} props
 */
export default function MyNotes({ account, signExec }) {
  const [notes, setNotes] = useState([]);
  const [msg, setMsg] = useState('');
  const [msgKind, setMsgKind] = useState(/** @type {''|'ok'|'err'} */ (''));
  const [claiming, setClaiming] = useState(/** @type {string|null} */ (null));

  async function load() {
    setMsg('');
    setMsgKind('');
    try {
      // Normalize: indexer stores the full padded on-chain address; wallet form may be unpadded.
      setNotes(await getNotes(normalizeSuiAddress(account.address)));
    } catch (e) {
      setMsg(`Failed to load notes: ${e.message}`);
      setMsgKind('err');
    }
  }

  useEffect(() => { load(); }, [account.address]);

  async function claim(n) {
    if (claiming) return;
    setClaiming(n.note_id);
    setMsg('');
    setMsgKind('');
    try {
      // oracle_id not stored in indexer; resolve from (asset, expiry) at claim time.
      const asset = n.strategy || 'BTC';
      const oracle = await getOracle(asset, n.expiry_ts_ms);

      const { tx: txJson } = await postTx('/claim-tx', {
        sender: account.address,
        note: n.note_id,
        mgr: n.manager_id,
        oracle,
      });

      const r = await signExec(Transaction.from(txJson));

      if (r.$kind === 'FailedTransaction') {
        const err = r.FailedTransaction?.effects?.status?.error;
        throw new Error(`Claim failed on-chain: ${err?.message ?? JSON.stringify(err)}`);
      }

      const digest = r.Transaction?.digest;
      if (!digest) throw new Error('Claim returned no digest — status unknown, treat as NOT completed');

      setMsg(`Claimed ${EXPLORER}${digest}`);
      setMsgKind('ok');
      await load();
    } catch (e) {
      setMsg(`CLAIM FAILED: ${e.message}${e.code ? ` [${e.code}]` : ''}`);
      setMsgKind('err');
    } finally {
      setClaiming(null);
    }
  }

  const now = Date.now();
  return (
    <section className="nl-board" style={{ marginTop: 22 }}>
      <header className="nl-board__head">
        <h2 className="nl-board__title">My Notes</h2>
        <button className="nl-refresh" onClick={load} disabled={!!claiming}>Refresh</button>
      </header>

      {notes.length === 0 && <p className="nl-empty">No notes found.</p>}

      {notes.length > 0 && (
        <table className="nl-table">
          <thead>
            <tr>
              <th className="nl-th">Note</th>
              <th className="nl-th">Expiry</th>
              <th className="nl-th">Status</th>
              <th className="nl-th nl-th--num">Action</th>
            </tr>
          </thead>
          <tbody>
            {notes.map((n, i) => {
              const expired = Number(n.expiry_ts_ms) < now;
              const isClaiming = claiming === n.note_id;
              const state = n.settled ? 'settled' : expired ? 'claimable' : 'pending';
              return (
                <tr key={n.note_id} className="nl-row" style={{ '--i': i }}>
                  <td className="nl-td" title={n.note_id}>{n.note_id.slice(0, 12)}…</td>
                  <td className="nl-td">{new Date(Number(n.expiry_ts_ms)).toISOString().slice(0, 16).replace('T', ' ')}</td>
                  <td className="nl-td">
                    <span className={`nl-statuspip nl-statuspip--${state}`} />
                    {state === 'settled' ? 'Settled' : state === 'claimable' ? 'Claimable' : 'Pending'}
                  </td>
                  <td className="nl-td nl-td--num">
                    {state === 'claimable'
                      ? (
                        <button
                          className="nl-btn"
                          disabled={isClaiming || !!claiming}
                          onClick={() => claim(n)}
                          aria-busy={isClaiming}
                        >
                          {isClaiming ? 'Claiming…' : 'Claim'}
                        </button>
                      )
                      : <span style={{ color: 'var(--pearl-dim)' }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {msg && <pre className={`nl-status ${msgKind === 'ok' ? 'nl-status--ok' : 'nl-status--err'}`}>{msgKind === 'ok' ? '✓ ' : ''}{msg}</pre>}
    </section>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npm run build`
Expected: exit 0; no import errors for `normalizeSuiAddress`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/MyNotes.jsx
git commit -m "feat(frontend): migrate MyNotes to Nacre Ledger table + normalize address"
```

---

### Task 6: Final verification + progress note

**Files:**
- Modify: `tasks/progress.md` (mark migration done; record out-of-scope waitForTransaction follow-up)

- [ ] **Step 1: Full build**

Run: `cd frontend && npm run build`
Expected: exit 0.

- [ ] **Step 2: Visual check** — run `cd frontend && npm run dev`, open the served URL. Confirm: masthead (logo + title + ConnectButton) renders on obsidian; mint card + pill + molten button; Leaderboard unchanged; My Notes is a table with status pips; sections stagger-reveal once. Toggle OS reduced-motion → no animation. Take a screenshot for the user.

- [ ] **Step 3: Record progress + out-of-scope follow-up**

Append to `tasks/progress.md`: migration completed (which files), logo variants awaiting user pick, and the deferred `MyNotes.claim()` `waitForTransaction` follow-up surfaced by sui-frontend review.

- [ ] **Step 4: Commit**

```bash
git add tasks/progress.md
git commit -m "docs: save-progress — Nacre Ledger site-wide migration complete"
```

---

## Self-Review

**Spec coverage:** theme tokens ✓(T1) · de-hardcode ✓(T1) · charset ✓(T1) · App.css ✓(T3) · App.jsx masthead/mint/status ✓(T4) · MyNotes table ✓(T5) · normalize fix ✓(T5) · logo 3 variants+backup ✓(T2) · out-of-scope waitForTransaction note ✓(T6) · build verification ✓(every task).

**Placeholder scan:** none — all CSS/JSX/commands are concrete.

**Type consistency:** class names defined in T3 `App.css` (`.nl-btn`, `.nl-status--ok/err`, `.nl-statuspip--settled/claimable/pending`, `.nl-pill`, `.nl-masthead`, `.nl-section`) match their use in T4/T5. Leaderboard-owned classes (`.nl-board`, `.nl-table`, `.nl-th`, `.nl-td`, `.nl-row`, `.nl-refresh`, `.nl-empty`) reused, not redefined. `statusKind`/`msgKind` state added consistently in both JSX files. Logo default `/logo-mark.svg` matches T2 output path.
