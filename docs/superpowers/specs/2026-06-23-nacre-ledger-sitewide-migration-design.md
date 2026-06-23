# Design — Site-wide Nacre Ledger Migration

Date: 2026-06-23
Status: APPROVED (pending user spec review)

## Goal

Unify the whole frontend (`App.jsx`, `MyNotes.jsx`, ConnectButton chrome, `index.html`)
into the established **Nacre Ledger** aesthetic already shipped in `Leaderboard.jsx` /
`Leaderboard.css`. Plus 3 deferred cleanups.

This is a **presentation-layer only** migration. No business logic, no API/backend, no
new dependencies. Verified via `sui-frontend` skill review: SDK wiring (ConnectButton in
`/ui`, `dAppKit.signAndExecuteTransaction`, result discriminated union, account null-gate)
is already correct — nothing to change there.

## Aesthetic Direction (frontend-design skill)

"Nacre Ledger" — refined obsidian ledger with mother-of-pearl iridescence. Editorial /
luxury finance. Metaphor: structured notes catalogued in a black-velvet jeweller's ledger.
**Extend** the existing gold-standard (`Leaderboard.css`), do not diverge.

- Type: Fraunces (display) × Martian Mono (data). Already loaded in `index.html`.
- Color: obsidian base, nacre gradient iridescence, molten gold as the single bold CTA accent,
  jade/rust for pos/neg state. All via `theme.css` tokens.
- Motion: one orchestrated page-load staggered reveal; `prefers-reduced-motion` guard.
- Layout: centered single-column ledger, max-width 760 (aligns with `.nl-board`). Restraint, not grid-breaking.

## Approaches Chosen

- **Styling**: dedicated `App.css` reusing the `nl-` class convention + theme tokens (NOT inline styles, NOT CSS modules). Consistency with `Leaderboard.css`.
- **ConnectButton**: wrap in a `.nl-connect` chrome container; do NOT CSS-override its internals (fragile across `@mysten/dapp-kit-react` versions — see lessons 2026-06-21 SDK drift).
- **MyNotes**: table, same structure as Leaderboard (cohesion).
- **Logo**: produce 3 variants of `logo_3`, back them up, user picks final later.

## Changes

### 1. `theme.css` — 2 new tokens (cleanup)
- Add `--brass: #9c8045;` and `--nacre-accent: #c9c1e8;`.
- (The `#c9c1e8` inside the `--nacre` gradient definition stays — it is part of the token, not a stray literal.)

### 2. `Leaderboard.css` — de-hardcode (cleanup)
- `.nl-pip--brass { background: #9c8045; }` → `var(--brass)`.
- `.nl-row--you { box-shadow: inset 2px 0 0 0 #c9c1e8; }` → `var(--nacre-accent)`.

### 3. `index.html` — `<meta charset>` first child of `<head>` (cleanup)

### 4. New `frontend/src/App.css`
Component classes (all token-driven, mirror Leaderboard idiom):
- `.nl-app` — page wrapper (max-width 760, centered, vertical rhythm).
- `.nl-masthead` — header bar: logo mark (left) + Fraunces title + mono eyebrow `STRUCTURED NOTE FACTORY · TESTNET`; nacre `border-image` hairline rule beneath; `.nl-connect` right-aligned.
- `.nl-card` — obsidian-raised panel (reuse `.nl-board` surface tokens) for the Mint section.
- `.nl-btn` / `.nl-btn--primary` — primary = molten gradient CTA (the one bold accent); hover/disabled/`aria-busy` states.
- `.nl-pill` — mono connected-address chip + small nacre dot.
- `.nl-status` — typed feedback: jade `✓` success / rust failure, mono, slide-in.
- MyNotes table classes: reuse `.nl-table`/`.nl-th`/`.nl-td`/`.nl-row` (+ `nl-reveal` stagger) from Leaderboard; add status-pip classes (`settled` = jade, `claimable` = molten micro-pulse, `pending` = dim) and an action cell.
- Page-load section reveal + `@media (prefers-reduced-motion: reduce)` guard.

### 5. `App.jsx`
- Replace `system-ui` inline wrapper with `.nl-app`; import `./App.css`.
- Masthead block (logo + title + eyebrow + `.nl-connect` ConnectButton).
- Mint inside `.nl-card`: `.nl-btn--primary`, connected address as `.nl-pill`, status as `.nl-status`.
- Keep all logic: `onMint`, `signExec`, sender-assert, fail-loud status, `busy`/`aria-busy`.

### 6. `MyNotes.jsx`
- Container → `.nl-card`/`.nl-board` surface with nacre-rule header.
- List → table: columns `Note / Expiry / Status / Action`. Status pip per state. Claim/Refresh → `.nl-btn`. Rows use `nl-reveal` stagger (`--i`).
- **address-normalization fix**: `import { normalizeSuiAddress } from '@mysten/sui/utils';`
  then `getNotes(normalizeSuiAddress(account.address))`.
  Why: indexer stores the full padded on-chain address form; the wallet may hand back a
  non-padded form → without normalize the user fails to find their own notes (same bug
  class already fixed in Leaderboard's `me` comparison).
- Keep all logic: `load`, `claim`, oracle resolve, result-union handling, fail-loud.

### 7. Logo (3 variants, user picks later)
Create `frontend/public/` and a backup dir `docs/logo-variants/`. From `logo_3.png`:
- (a) `logo-mark.png` — white background removed → transparent, ~28px mark.
- (b) `logo-mark-tinted.png` — bg removed + nacre/pearl monochrome tint (blends into palette).
- (c) `logo-mark.svg` — hand-drawn refined pearl-in-shell glyph (nacre gradient shell + molten pearl), 100% cohesive with luxury direction.
- Wire one as default in the masthead; keep all three available so the user can swap and choose.
  Default proposal: (c) SVG glyph (best cohesion); (a)/(b) backed up for preview.

## Out of Scope (flagged, not done here)
- `MyNotes.claim()` lacks `client.waitForTransaction({digest})` before `load()` — `sui-frontend`
  skill flags re-query-before-wait. Business-logic concern, separate task. Recorded in `tasks/progress.md`.
- No mint/claim logic, `api.js`, `mint.js`, or backend changes.

## Verification
- `cd frontend && npm run build` (Vite) passes.
- Visual check: dev server / screenshot — masthead, mint card, leaderboard, notes table render
  cohesively; reduced-motion honored.
- Confirm normalize fix: notes list still loads for the connected address.
