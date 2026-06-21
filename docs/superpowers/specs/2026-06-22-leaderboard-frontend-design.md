# Leaderboard Frontend View — Design

Date: 2026-06-22
Status: Approved (design)

## Goal

Public issuer leaderboard in the dApp, ranked by realized PnL. Visible to any
visitor without a connected wallet; highlights the connected user's row once a
wallet is connected.

## Scope

- **Backend: zero changes.** `GET /leaderboard` already exists
  (`scripts/indexer/server.js` → `queries.js#leaderboard`) and returns, ordered
  by `realized_pnl DESC`:
  `{ issuer, realized_pnl, win_rate, total_perf_fee, note_count }`.
- **Frontend touch points:** one fetch helper (`api.js`), one new component
  (`Leaderboard.jsx` + `Leaderboard.css`), one mount (`App.jsx`), plus shared
  `theme.css` and font imports in `index.html` (see Aesthetic Direction).

## Components

### 1. `frontend/src/api.js` — add `getLeaderboard()`

Mirror existing `getNotes` pattern: `fetch(`${API}/leaderboard`)`, on non-ok
throw `Error` carrying `code`/`detail`.

### 2. `frontend/src/Leaderboard.jsx` — new component

Props: `{ account }` (may be `null` before wallet connect).

- Load once via `useEffect`; manual **Refresh** button (matches `MyNotes`).
- Table columns: `Rank | Issuer | Realized PnL | Win Rate | Notes | Perf Fee`.
  - **Rank**: row index + 1 (backend already sorts `realized_pnl DESC`; no
    client-side re-sort).
  - **Issuer**: `addr.slice(0, 8)…` with full address in `title` (matches
    `MyNotes`).
  - **Realized PnL**: `value / 1e6` → `+12.50 dUSDC` / `-3.20 dUSDC`; positive
    green, negative red (explicit signed, fail-loud style).
  - **Win Rate**: `(win_rate * 100).toFixed(1)%`.
  - **Notes**: `note_count` raw.
  - **Perf Fee**: `total_perf_fee / 1e6` → `… dUSDC`.
- **Highlight self**: when the connected address matches `row.issuer`, apply the
  Nacre self-row treatment (see Aesthetic Direction) + `YOU` tag. Before wallet
  connect, `account` is `null` → no highlight, table still renders.
  **Address normalization (sui-frontend review — Critical):** the indexer stores
  `issuer` verbatim from the on-chain event (full 32-byte zero-padded
  `0x`+64-hex), while `account.address` form is wallet-dependent. A raw `===`
  can silently never match → row never highlighted. Normalize BOTH sides:

  ```js
  import { normalizeSuiAddress } from '@mysten/sui/utils'; // already a peer dep — no new install
  const isYou = account &&
    normalizeSuiAddress(account.address) === normalizeSuiAddress(row.issuer);
  ```
- Empty data → `No settled notes yet.`
- Load failure → fail-loud `<pre>` showing `e.message [code]`.

### 3. `frontend/src/App.jsx` — mount

Render `<Leaderboard account={account} />` **outside** the `account &&` block so
it shows pre-connect. Place below `<ConnectButton/>`, above the connected-account
block. Pass `account` (null or object) for self-highlight.

## Formatting decisions

- `const DUSDC_DECIMALS = 6` module constant (1 dUSDC = 1e6 base units, per
  `scripts/integration/mint.js` `NOTIONAL='10000000' // 10 dUSDC`).
- PnL/fee displayed with `dUSDC` unit suffix.
- Values come back as JSON numbers (backend `SUM(CAST(... AS INTEGER))`).
  Assumption (flagged): per-issuer cumulative PnL stays < 2^53 base units
  (~9e9 dUSDC), so plain `number / 1e6` is precision-safe. No BigInt needed.
- Styling via a dedicated `Leaderboard.css` + shared `theme.css` (CSS vars),
  NOT inline styles — the aesthetic (hover, keyframes, ::before grain, nacre
  gradients) needs real CSS. See "Aesthetic Direction" below.

## Aesthetic Direction — "Nacre Ledger"

Professional, artist-led design that rejects generic AI aesthetics. Concept
derived from the brand **PearlFoundry**: *Pearl* (mother-of-pearl / nacre
iridescence, layered luster, organic luxury) × *Foundry* (forging, molten metal,
precision craft, stamped ledger). The leaderboard reads as a **luxury financial
ledger plate** — obsidian foundry surface with mother-of-pearl accents and
molten-gold rank markers. Bloomberg terminal meets haute jewelry.

**Hard bans (anti-AI-slop):** no Inter/Roboto/system-ui fonts; no purple-on-white
gradients; no generic `rounded-2xl shadow-lg` cards; no zebra striping.

### Theme scope decision (Rule 7 — conflict surfaced)

Current frontend is bare `system-ui` inline-style. Resolution:
- **This round:** introduce shared design tokens (`frontend/src/theme.css`) +
  font imports (`frontend/index.html`), but style ONLY the Leaderboard against
  them. `App.jsx` / `MyNotes.jsx` remain untouched — temporary style mismatch is
  accepted as the seed for migration.
- **Next round (out of scope here):** migrate the whole frontend (App, MyNotes,
  ConnectButton chrome) to the Nacre Ledger theme for a unified look.

### Design tokens (`theme.css`, CSS custom properties)

| Token | Value | Use |
|-------|-------|-----|
| `--obsidian` | `#0b0d12` | page base |
| `--obsidian-raised` | `#14171f` | ledger surface |
| `--pearl` | `#f2ede3` | primary text (warm off-white) |
| `--pearl-dim` | `#9aa0ad` | secondary text / labels |
| `--nacre` | `linear-gradient(110deg,#b8e0d2,#c9c1e8,#f3d9c9,#bfe3e0)` | self-row accent, header underline |
| `--jade` | `#5fb89a` | positive PnL (oxidized patina, not neon) |
| `--rust` | `#c8765a` | negative PnL (oxidized copper) |
| `--molten` | `linear-gradient(#f5c869,#d99a3c)` | rank #1 pip |
| `--hairline` | `rgba(242,237,227,0.08)` | column/row rules |

### Typography (Google Fonts, imported in `index.html`)

- **Display** (section title, brand): **Fraunces** — variable serif, high
  optical contrast, characterful. Weight 500–600, slight negative tracking.
- **Data / numbers / addresses / labels**: **Martian Mono** with
  `font-variant-numeric: tabular-nums` so digits column-align. Labels rendered
  uppercase + letter-spacing for a "stamped" foundry feel.

### Composition & detail

- Table = ledger plate on `--obsidian-raised`; hairline column rules; row
  height ~52px; NO zebra (separation via hairlines only).
- Header: mono uppercase micro-labels in `--pearl-dim`, with a thin `--nacre`
  gradient underline.
- Rank: #1 gets a small `--molten` pip; #2–3 muted brass; rest plain mono.
- **Self row (the memorable moment):** 2px `--nacre` left border + faint
  nacre-tinted background wash + a small uppercase `YOU` tag.
- Win rate: number + a 1px-tall `--nacre` micro-meter bar (chart-lib-free
  data-viz).
- PnL/Perf cells: signed mono numerals, `--jade` / `--rust`.

### Motion (CSS-only)

- Page load: staggered row reveal — fade + `translateY`,
  `animation-delay: calc(var(--i) * 40ms)`. One orchestrated reveal.
- Row hover: hairline brightens + subtle pearl text lift. No bounce.
- **`prefers-reduced-motion: reduce`** → disable stagger/hover transitions.

### Atmosphere

- `--obsidian` base carries a very-low-opacity SVG fractal-noise grain overlay
  + a soft radial `--nacre` glow behind the header. No flat solid background.

## Non-goals / YAGNI

- No client-side sorting/filtering/pagination.
- No new test runner — frontend currently has zero tests; keep that status quo
  (surgical). Formatting helpers stay inline.
- No backend query changes, no new endpoints.

## Follow-ups (out of scope, flagged by sui-frontend review)

- **MyNotes normalization gap (Minor):** `api.js#getNotes(account.address)` passes
  the raw wallet address to `WHERE n.issuer = @issuer`; same format-mismatch risk
  as the Critical above — could return zero rows for some wallets. Fix in the
  next-round full-frontend migration (or sooner if MyNotes shows empty in
  testing).
- **Full Nacre Ledger migration** of App/MyNotes/ConnectButton chrome.

## Testing / verification

- Manual: `npm run dev` in `frontend/`, point at a running indexer with settled
  notes; verify ranking order, self-highlight, dUSDC formatting, empty state,
  and error state (stop the indexer → fail-loud message).
