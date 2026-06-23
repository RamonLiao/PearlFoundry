# Nacre Light — site-wide UI redesign (design spec)

**Date:** 2026-06-23
**Status:** approved (visual direction locked = `docs/ui-redesign/v2d-hybrid.html`)
**Scope:** pure presentation-layer redesign of the React dApp. **Zero business-logic / SDK-wiring change.**

## 1. Goal

Replace the current **obsidian dark "fintech ledger"** look with a **light nacre / underwater-pearl** brand, derived from the `logo_3` mascot (open clam + glowing pearl). The new direction — internally called **A×B hybrid / "Nacre Light"** — keeps A's **data rigor** (tabular mono numbers, professional tables) and grafts on B's **playful underwater life** (bobbing pearl, rising bubbles, caustic light, pink-gold bouncy CTA, glowing claimable pip, hand-drawn SVG ocean icons).

Visual ground truth: **`docs/ui-redesign/v2d-hybrid.html`** (self-contained, open in browser). When this spec and the mockup disagree, the mockup wins for *look*; this spec wins for *which real columns/behaviors must survive*.

## 2. Non-goals / invariants (fail-loud if violated)

- **No business logic touched.** `onMint`, `claim`, `load`, `signExec`, `runMint`, `api.js`, `mint.js`, `config.js`, `dapp-kit.js` stay byte-identical. This is the same discipline as the 2026-06-23 Nacre-Ledger migration.
- **No columns dropped.** Real tables carry more than the simplified mockup:
  - **Leaderboard:** Rank, Issuer, Realized PnL, **Win Rate (with meter bar)**, Notes, **Perf Fee** — all kept, restyled.
  - **MyNotes:** Note (id), Expiry, Status, **Action (Claim button)** — all kept, restyled.
- **No new runtime deps.** Bubbles/caustic/icons are pure CSS + inline SVG. Fonts already loaded (Fraunces + Martian Mono).
- **Accessibility preserved:** `prefers-reduced-motion` disables *all* motion (bob, bubbles, caustic drift, reveal, pip pulse, CTA transform). `aria-busy` on buttons unchanged. Decorative SVG icons get `aria-hidden="true"`; logo keeps `alt=""` (decorative, title is adjacent text).

## 3. Palette migration (`theme.css` — the keystone change)

Flip the token values; **keep token *names*** so component CSS that references `var(--pearl)` etc. mostly keeps working, but several names invert meaning (e.g. `--obsidian` was the page bg, now we want a light bg). Decision: **rename the structural tokens** rather than leave misleading names.

| New token | Value | Old equivalent |
|---|---|---|
| `--bg` | `#faf6f0` (pearl base) | `--obsidian #0b0d12` |
| `--surface` | `#ffffff` (raised card) | `--obsidian-raised #14171f` |
| `--surface-sunk` | `#f3ecf3` | — |
| `--ink` | `#3a3340` (primary text) | `--pearl #f2ede3` |
| `--ink-dim` | `#8a7f88` | `--pearl-dim #9aa0ad` |
| `--ink-faint` | `#b6acb4` | — |
| `--hairline` | `rgba(58,51,64,.09)` | `rgba(242,237,227,.08)` |
| `--nacre` | `linear-gradient(115deg,#cdeadf,#d7cef2,#f8ddc9,#cfeae6)` | (same idea, lighter) |
| `--molten` | `linear-gradient(135deg,#f8d27e,#e0a03c)` | (kept) |
| `--pinkgold` | `linear-gradient(120deg,#f9d27c,#f0b56a,#ec8aa6)` | **new** (primary CTA) |
| `--jade` (pos) | `#2c9b6f` | `#5fb89a` (retune for light bg) |
| `--rust` (neg) | `#cc6a4f` | `#c8765a` |
| `--gold-ink` | `#9a6a1e` | — (eyebrow / rank numerals) |
| accent swatches | `--pink #f4c2cd`, `--purple #cdc4ee`, `--peach #f8d6bd`, `--mint #bfe4d7` | new |

`body` background: pearl base + 3 corner radial washes (purple TL, pink TR, sea-blue/mint bottom) + keep a faint grain. Drop `background-attachment` heavy obsidian look.

> Because token **names change** (`--obsidian`→`--bg`, `--pearl`→`--ink`, …), every component CSS file that references the old names must be updated in the same change. That's `App.css`, `Leaderboard.css`. This is mechanical find-replace + per-rule contrast retune, **not** a logic change.

## 4. Background layer — underwater `<Sea/>` (new, App-level)

A new presentational, `pointer-events:none`, `z-index:0` fixed layer rendered once at the top of `App` (behind `.nl-app`, which becomes `position:relative; z-index:1`):

- `.nl-sea` container, fixed inset 0, overflow hidden.
- `.nl-caustic` — 3 soft radial blobs (sea-blue/purple/mint), slow `drift` translate+scale, 12s alternate.
- `.nl-bubble` ×10 — varied `left`/size(6–24px)/`animation-duration`(11–18s)/`animation-delay`; each rises `translateY(-112vh)` with slight x-drift, fades in/out. Soft blue-tinted border (`rgba(150,200,222,.30)`), inner highlight via `::after` white dot. (Tuned exactly per v2d — bubbles visible but not harsh.)

Implemented as a tiny `Sea.jsx` (markup only) + rules in `App.css`. No props, no state.

## 5. Component-level changes (JSX: additive/markup only)

### `index.html`
- `<title>` → `PearlFoundry`.
- Add Fraunces **italic** axis to the Google Fonts URL (masthead wordmark `<em>` uses italic): `opsz,ital,wght@...,0,500;0,600;1,600`.

### `App.jsx` (masthead + mint card)
- Render `<Sea/>` first; wrap app content `z-index:1`.
- Masthead: logo gets bob animation (CSS class only). Eyebrow gets **shell SVG** + text `Testnet · DeepBook Predict`. **h1 → `Pearl<em>Foundry</em>`** (wordmark; molten-gradient `<em>`). Keep `<ConnectButton/>` inside `.nl-connect` (don't touch its internals).
- Optional one-line `.nl-mascot` hint under masthead (shell/bubble SVG + "pearl bobs · bubbles rise · claimable notes glow"). **Open question → §8.**
- Mint card: title `Issue a Note` → keep wording OR `Mint a Range Accrual note` (§8); prepend **wave SVG** icon. Primary button restyled `--pinkgold` + hover bounce (`translateY(-3px) scale(1.05)`), prepend **sparkle SVG**. `.nl-pill` and `.nl-status` restyled for light bg.

### `MyNotes.jsx`
- Section title `My Notes` + **open-clam-with-pearl SVG** icon.
- Table restyled (light). Status pip classes reused; `claimable` pip keeps gold pulse glow (now on light bg). Claim button = secondary style (ghost on light), **not** the pink-gold primary (primary is reserved for Mint). Keep `Refresh`, `note_id` cell, Action column.

### `Leaderboard.jsx`
- Title `Leaderboard` → `Nacre Ledger` (already the brand name used in copy) + **trophy SVG** icon.
- Restyle table for light bg; **keep** Win Rate meter (`--nacre` fill on light track), Perf Fee column. Rank numerals → Fraunces, `--gold-ink`; `nl-pip--gold` keeps glow.
- **`nl-row--you` fix (carried from mockup):** the gold inset highlight bar must not overlap the rank numeral — add left padding to the rank cell so the `inset 4px` bar clears the digit. (This was a real bug found in mockup review.)

### SVG icon set (new, inline, `stroke=currentColor`, `aria-hidden`)
Six hand-drawn line icons, lifted verbatim from v2d: **shell** (eyebrow), **wave** (mint), **open-clam+pearl** (my notes), **trophy** (ledger), **bubbles** (mascot), **sparkle** (CTA). Inline in JSX (small, one-off) — no icon library.

## 6. Files touched

| File | Change |
|---|---|
| `frontend/index.html` | title, Fraunces italic axis |
| `frontend/src/theme.css` | **token flip** (dark→light), new accent tokens, body bg |
| `frontend/src/App.css` | token-name updates + restyle masthead/card/btn/pill/status/pip + bob + `.nl-sea/.nl-caustic/.nl-bubble` rules + reduced-motion |
| `frontend/src/Leaderboard.css` | token-name updates + light retune + `nl-row--you` rank-padding fix |
| `frontend/src/App.jsx` | render `<Sea/>`, masthead wordmark + eyebrow SVG, card icon, CTA SVG |
| `frontend/src/MyNotes.jsx` | title SVG icon (markup only) |
| `frontend/src/Leaderboard.jsx` | title rename + trophy SVG (markup only) |
| `frontend/src/Sea.jsx` | **new** — bubble/caustic markup |
| `frontend/public/` | logo already `logo-mark.png` (clear logo_3) — no change |

## 7. Verification (success criteria)

- `vite build` green.
- Business logic untouched: `git diff` on `api.js`/`mint.js`/`config.js`/`dapp-kit.js`/`main.jsx` = empty; diffs in `*.jsx` are markup/className-only (no changes to handlers, state, fetch calls, signExec).
- Live `npm run dev` visual check vs `v2d-hybrid.html`: light pearl bg, bobbing logo, visible-but-soft bubbles, pink-gold bouncy Mint CTA, glowing claimable pip, SVG icons render, `nl-row--you` highlight doesn't cover rank.
- `prefers-reduced-motion: reduce` → all motion stops.
- Tables keep ALL real columns (Win Rate meter + Perf Fee in Ledger; Action/Claim in MyNotes).
- Per project rule: visual gate is live-browser (playwright/dev server), **not** ImageMagick (lesson 2026-06-23). Screenshot via dev server for the record.

## 8. Copy decisions (resolved 2026-06-23)

1. **Wordmark:** masthead h1 = **`Pearl<em>Foundry</em>`**.
2. **Section titles:** Mint card keeps **`Issue a Note`** (terse, short real-card title); Leaderboard → **`Nacre Ledger`**.
3. **Mascot hint line:** **keep** the "pearl bobs · bubbles rise · claimable notes glow" line, small + dim.
