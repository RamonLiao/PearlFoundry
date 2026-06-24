# MyNotes / Leaderboard UX Batch — Design

**Date:** 2026-06-24
**Type:** Presentation-layer UX polish (zero business logic, zero contract/schema change)
**Scope:** Five independent UI fixes across the front-end, bundled as one batch.

## Goal

Tighten the post-quote / list UX surfaces (MyNotes, Leaderboard, mint flow) so the
primary action is obvious, truncated on-chain ids stay informative, expanded rows are
dismissable, and async states (initial load, minting) read as deliberate rather than
blank/janky.

This is a presentation-only batch. No API, mint, payoff, config, or dapp-kit wiring
changes. The branch-wide `git diff` MUST show `api.js`, `mint.js`, `config.js`,
`payoff.js`, `pendingMint.js`, `dapp-kit.js`, and everything under `scripts/` byte-unchanged.

## Items

### Shared helper — `frontend/src/format.js` (new)

```
shortId(id, head = 6, tail = 4) -> "0x1a2b…cd34"
```

- Returns `id` unchanged when it is too short to truncate (`length <= head + tail + 1`),
  null/undefined-safe (returns `''`), and never throws on non-string input.
- **Why it exists:** Sui object ids normalize to `0x` + 64 hex. Numerically small ids are
  left-zero-padded, so `slice(0, 12)` renders `0x0000000000…` — all zeros, no signal. The
  tail end is always the meaningful bytes, so `head…tail` is the only truncation that stays
  informative for padded ids.
- Uses the `…` (U+2026) glyph, matching existing call sites. The `…` MUST render in the same
  color/weight as the hex (it is part of the address, not a loading affordance) — do not dim it.

Companion `frontend/src/format.test.js` (node:test):
- normal id → `0x` + first 4 hex … last 4 hex
- **monkey:** all-zero-padded id (`0x` + 64 zeros) → tail still shown (the bug this fixes)
- **monkey:** empty string / null / undefined → `''`, no throw
- **monkey:** id shorter than `head+tail+1` → returned unchanged (no negative-index slice surprise)
- custom `head`/`tail` (the `shortId(issuer, 8, 4)` Leaderboard call) → byte-identical to the
  current `slice(0,8)…slice(-4)` output

### ① Claim → primary button

`MyNotes.jsx` Claim button className `nl-btn` → `nl-btn nl-btn--primary`. The Claim action is
the one meaningful CTA on a claimable row; it should carry the molten primary weight, not sit
at the same level as Refresh/Cancel. No logic change (disabled / aria-busy / handler unchanged).

**Table-scoped size override (review M1):** `.nl-btn--primary` is a *hero*-sized CTA
(`padding:14px 27px; font-size:13px`, `translateY(-3px)` hover lift, large molten drop-shadow,
App.css:88-98) — dropping it verbatim into a 52px-tall `.nl-td` action cell overflows the row
rhythm and the hover lift jumps the row. Add a table-scoped damping rule (App.css):
`.nl-td .nl-btn--primary { padding: 8px 16px; font-size: 12px; }` and damp the hover lift to
`translateY(-1px)` with a smaller shadow. Keep the molten fill + weight (that is the hierarchy
win); only the hero padding/lift is reduced. Contrast is unchanged — same `--molten`/#3d1a28
text pairing = **6.73:1** (WCAG AA pass), verified.

### ② Expanded-row close button

In the MyNotes detail row (`nl-detail`), add a small close control at the top-right.

- `<button class="nl-detail-close" aria-label="Close payoff">` containing a **thin line-SVG X**
  matching the app's icon system — NOT a bare text `✕` (the bare X reads off-brand against the
  hand-drawn ocean icons). Two crossing paths,
  `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"`,
  icon ~12px, same `.nl-li` family as masthead/board icons.
- Styled as a **26×26 pearl chip**: `background: var(--surface-sunk)`, `1px solid var(--hairline)`
  (the hairline is needed because `.nl-detail` sits on a near-white `rgba(58,51,64,0.02)` tint —
  without a border the chip reads as a smudge), icon color `--pearl-dim` → `--pearl` on hover.
  Reuse the established small-control hover transition from `.nl-refresh`
  (`transition: color 120ms ease, border-color 120ms ease`).
- **Placement:** `.nl-detail { position: relative }`; `.nl-detail-close { position: absolute; top: 8px; right: 10px }`
  (the detail already has `padding: 8px 12px 14px`, so this clears the chart's top-right axis
  labels). Hit target 26×26 (≥ the codebase's existing small-control size).
- **Keyboard/a11y:** must be tab-reachable (it is the first focusable control inside the detail
  region). Add `:focus-visible { outline: 2px solid var(--gold-ink); outline-offset: 2px }`.
  `onClick` → `e.stopPropagation()` then `setExpanded(null)`. Confirm Enter/Space activation does
  NOT bubble to the row's `onClick` toggle (which would re-open immediately).
- The whole-row click-to-toggle stays as-is; the chip is the explicit, discoverable affordance.

### ③ id truncation → head…tail

Replace `slice(0, N)…` truncations of on-chain ids with `shortId(...)`:

- `MyNotes.jsx` Note link: `n.note_id.slice(0, 12)…` → `shortId(n.note_id)`
- `App.jsx` pending manager note: `pending.mgr.slice(0, 12)…` → `shortId(pending.mgr)`
- `App.jsx` cancelled-manager note: `preview?.mgr?.slice(0, 12)…` → `shortId(preview?.mgr)`
- `Leaderboard.jsx` issuer: `(r.issuer ?? '').slice(0,8)…(r.issuer ?? '').slice(-4)` →
  `shortId(r.issuer, 8, 4)`

The literal `…` already in JSX after these slices is removed (now inside `shortId`).

**Byte-identity caveat (review M1):** `shortId(issuer, 8, 4)` is byte-identical to the current
output *only for normalized 66-char on-chain addresses*. For null/empty issuer it now renders
`''` instead of a bare `…` — a strict improvement (the existing `(r.issuer ?? '')` guard exists
precisely because issuer can be null). The diff reviewer should treat this as intended, not a
regression. Verify `nl-you` ("YOU") pill baseline still aligns next to the mono id in the visual pass.

### ④ Shimmer skeleton on initial load

**Keyframe name (review C2 — blocking, verified):** the skeleton keyframe MUST be named
`nl-skel-sweep`, NOT `nl-shimmer`. `@keyframes nl-shimmer` already exists (App.css:187, the
chart's saturate shimmer) and MyNotes imports BOTH App.css and Leaderboard.css, so a second
`nl-shimmer` would clobber the chart animation. This is a real collision, not taste.

**Bar appearance (nacre sweep, not grey pulse):** `.nl-skel` is a moving iridescent sweep using
the brand `--nacre` stop colors, so it reads as pearl, not a generic placeholder:
```
.nl-skel {
  background: linear-gradient(100deg,
    var(--surface-sunk) 30%, rgba(215,206,242,.55) 45%,
    rgba(248,221,201,.55) 55%, var(--surface-sunk) 70%);
  background-size: 200% 100%;
  animation: nl-skel-sweep 1.4s ease-in-out infinite;
  border-radius: 4px; height: 11px;
}
@keyframes nl-skel-sweep { to { background-position: -200% 0; } }
```
Sweep is left→right (matches the chart's `nl-draw` reveal + reading direction); 1.4s is
deliberately calmer than a snappy 1s pulse — the water/pearl brand reads slow.

**Same-table structure (review I1 — prevents load→loaded reflow):** the skeleton MUST render
inside the *same* `<table>` with the real `<thead>`/`<th>` headers intact, as `<tr><td>` rows —
not a separate `<div>` stack. Otherwise column widths (`.nl-th--rank` is fixed `width:64px`,
Leaderboard.css; all others auto via `border-collapse`) and the `.nl-td { height: 52px }` row
height won't match, and the layout jumps when real rows arrive. Each skeleton `<td>` keeps the
52px height and holds one `.nl-skel` bar.

**Per-column bar widths (review I2 — avoid uniform-bar placeholder tell):** bars track the real
column rhythm, not uniform full-width:
- MyNotes (4 cols): Note ~60%, Expiry ~40%, Status ~30%, Action ~50% (right-aligned, matching `.nl-td--num`).
- Leaderboard (6 cols): Rank ~24px, Issuer ~60%, PnL ~50%, WinRate ~45%, Notes ~30%, PerfFee ~50% (num cols right-aligned).

**Row counts (review I2):** MyNotes = **3** skeleton rows (a normal user holds 1–3 notes; 4
over-promises), Leaderboard = **4** rows.

**Wiring:**
- **Leaderboard.jsx:** when `loading && rows.length === 0`, render the skeleton `<tbody>` instead
  of the empty-state line. Existing `loading` state is reused. (Empty-state already gated
  `!msg && !loading`, Leaderboard.jsx:58 — leave as-is.)
- **MyNotes.jsx:** currently has **no** loading state. Add `const [loading, setLoading] = useState(true)`;
  set `true` at the start of `load()`, `false` in a `finally`. Render the skeleton while
  `loading && notes.length === 0 && !msg`. **Gate the empty-state as `!loading && !msg`** (review
  I2 — mirror Leaderboard's pattern; otherwise a *failed* load flashes "No notes found." under the
  error `<pre>`, which is misleading).

**reduced-motion (review M4 — extend, don't duplicate):** Leaderboard.css already has a
`@media (prefers-reduced-motion: reduce)` block (Leaderboard.css:58). EXTEND it with
`.nl-skel { animation: none; background: var(--surface-sunk); }` (static faint fill) — do not add
a second media block.

Skeleton rows are decorative (`aria-hidden="true"`). Add a visually-hidden
`<span class="sr-only" role="status">Loading…</span>` (or reuse an existing sr-only utility)
while loading so screen-reader users get a status — MyNotes has no loading text today
(review N2). Optionally set `aria-busy="true"` on the `<section>` while loading (review N1).

### ⑤ Mint progress indicator — rising-pearl dots (NOT a rotating ring)

**Review C1 — do not ship a rotating ring.** A generic spinning ring is the single most
recognizable AI-slop motif and clashes with the app's hand-built pearl/bubble vocabulary
(`.nl-bubble`, `nl-rise` already exist). Use a **3 rising-pearl loader** instead.

Markup: `<span class="nl-spinner" aria-hidden="true"><i/><i/><i/></span>`. Each `<i>` is a 6px
pearl that bobs and fades on a staggered delay:
```
.nl-spinner { display: inline-flex; gap: 3px; align-items: center; }
.nl-spinner i {
  width: 6px; height: 6px; border-radius: 50%;
  /* pearl gradient lifted from .nl-bubble */
  background: radial-gradient(circle at 34% 30%, #fff 0%, rgba(255,255,255,.6) 22%,
              rgba(150,205,225,.28) 60%, rgba(120,180,215,.10) 82%);
  animation: nl-pearl 1.2s ease-in-out infinite;
}
.nl-spinner i:nth-child(2) { animation-delay: .15s; }
.nl-spinner i:nth-child(3) { animation-delay: .30s; }
@keyframes nl-pearl { 0%,100% { transform: translateY(0); opacity: .45 } 50% { transform: translateY(-4px); opacity: 1 } }
```
**Two context fills (review C1 + sui N2):** on the molten Mint button the pearl gradient is
invisible on gold — there, render the dots as solid `#3d1a28` (the button's own text color).
Provide a `.nl-btn--primary .nl-spinner i { background: #3d1a28 }` override. In the on-surface
"Minting…" note, keep the pearl gradient.

**No layout shift (review M3):** the `.nl-spinner` slot is fixed-width inline (3×6px + 2×3px gap
≈ 24px) so its appearance swaps glyph-for-space, not adds width. Also the Mint button label
changes "Mint Range Note"→"Preparing…"; pin `.nl-btn--primary` a `min-width` sufficient for the
longest state so the `.nl-issue-row` (flex-wrap, App.css) does not reflow. Dot size stays in px
(6px) but the slot sits inline with the 13px button text.

Placement:
- `App.jsx` Mint button: `.nl-spinner` before "Preparing…" (button already sets `aria-busy`).
- `App.jsx` "Minting…" note: `.nl-spinner` before the text.

reduced-motion (review M4 — extend App.css:191's existing block, don't duplicate): add
`.nl-spinner i { animation: none; opacity: .6 }` (static dots, no bob).

Spinner is `aria-hidden="true"`; the textual "Preparing…/Minting…" remains the accessible status.

## Files

| File | Change |
|------|--------|
| `frontend/src/format.js` | **new** — `shortId` helper |
| `frontend/src/format.test.js` | **new** — unit + monkey tests |
| `frontend/src/MyNotes.jsx` | ① Claim primary, ② close button, ③ shortId, ④ loading state + skeleton |
| `frontend/src/App.jsx` | ③ shortId (mgr), ⑤ spinner |
| `frontend/src/Leaderboard.jsx` | ③ shortId issuer, ④ skeleton |
| `frontend/src/App.css` | ② close-button chip, ① table-scoped `.nl-btn--primary`, ⑤ pearl-dot loader, `.sr-only` util, extend reduced-motion block (line 191) |
| `frontend/src/Leaderboard.css` | ④ skeleton bar + `nl-skel-sweep`, extend reduced-motion block (line 58) |

**CSS placement rule:** skeleton styling goes in `Leaderboard.css` — it is the shared
board/table stylesheet, imported by both `Leaderboard.jsx` and `MyNotes.jsx` (so both get the
skeleton classes from one source). The close button, table-scoped primary override, pearl-dot
loader, and a new `.sr-only` utility (none exists today — verified) go in `App.css` — imported by
both `App.jsx` and `MyNotes.jsx`, which is where those affordances live. The close button's hover
mirrors `.nl-refresh` (Leaderboard.css:14-20) by *copying* its transition values, not by selector
sharing (Rule 3 surgical).

## Testing

- `node --test frontend/src/format.test.js` (or project test runner) — green, including monkey cases.
- `cd frontend && npx vite build` — green.
- **Presentation-gate (Rule 9):** branch-wide `git diff --stat` confirms no business-logic file
  (`api.js`, `mint.js`, `config.js`, `payoff.js`, `pendingMint.js`, `dapp-kit.js`, `scripts/**`)
  changed — encodes "this is a pure presentation batch".

## Human-deferred (non-blocking)

Browser + real-wallet visual pass: skeleton→loaded transition, mint spinner, close button,
truncated-id readability. The sandbox has no wallet; all data paths are verifiable headless.
Matches the deferral pattern of prior front-end batches.

## Non-goals

- No new dependencies.
- No change to which data is fetched or how (only how ids/loading/actions are rendered).
- No responsive/mobile rework, no animation beyond the two small additions above.
