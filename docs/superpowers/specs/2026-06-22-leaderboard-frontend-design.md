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
- **Frontend: 3 touch points** — one fetch helper, one new component, one mount.

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
- **Highlight self**: when `account?.address === row.issuer`, give the row a
  background color and append `(you)`. Before wallet connect, `account` is
  `null` → no highlight, table still renders.
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
- Inline styles throughout (consistent with the rest of the frontend; no CSS
  framework introduced).

## Non-goals / YAGNI

- No client-side sorting/filtering/pagination.
- No new test runner — frontend currently has zero tests; keep that status quo
  (surgical). Formatting helpers stay inline.
- No backend query changes, no new endpoints.

## Testing / verification

- Manual: `npm run dev` in `frontend/`, point at a running indexer with settled
  notes; verify ranking order, self-highlight, dUSDC formatting, empty state,
  and error state (stop the indexer → fail-loud message).
