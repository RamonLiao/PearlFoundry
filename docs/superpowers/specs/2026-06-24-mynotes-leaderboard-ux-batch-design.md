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
- Uses the `…` (U+2026) glyph, matching existing call sites.

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

### ② Expanded-row close button

In the MyNotes detail row (`nl-detail`), add a small close control at the top-right:

- `<button class="nl-detail-close" aria-label="Close payoff">` with an inline `✕` SVG glyph.
- `onClick` → `e.stopPropagation()` then `setExpanded(null)`.
- The whole-row click-to-toggle stays as-is; the close button is an explicit, discoverable
  affordance (the row-click toggle is not obvious once expanded).

### ③ id truncation → head…tail

Replace `slice(0, N)…` truncations of on-chain ids with `shortId(...)`:

- `MyNotes.jsx` Note link: `n.note_id.slice(0, 12)…` → `shortId(n.note_id)`
- `App.jsx` pending manager note: `pending.mgr.slice(0, 12)…` → `shortId(pending.mgr)`
- `App.jsx` cancelled-manager note: `preview?.mgr?.slice(0, 12)…` → `shortId(preview?.mgr)`
- `Leaderboard.jsx` issuer: `(r.issuer ?? '').slice(0,8)…(r.issuer ?? '').slice(-4)` →
  `shortId(r.issuer, 8, 4)` (output byte-identical; single source of truth)

The literal `…` already in JSX after these slices is removed (now inside `shortId`).

### ④ Shimmer skeleton on initial load

CSS `@keyframes nl-shimmer` + `.nl-skel` (a nacre gradient bar) and `.nl-skel-row`. Under
`prefers-reduced-motion: reduce`, the animation is disabled and the bar shows a static faint
fill.

- **Leaderboard.jsx:** when `loading && rows.length === 0`, render a skeleton table body
  (4 `.nl-skel-row` rows) instead of the empty-state line. Existing `loading` state is reused.
- **MyNotes.jsx:** currently has **no** loading state. Add `const [loading, setLoading] = useState(true)`;
  set `true` at the start of `load()`, `false` in a `finally`. While `loading && notes.length === 0`,
  render the skeleton; the existing "No notes found." empty-state only shows once `!loading`.

Skeleton rows are purely decorative (`aria-hidden="true"`).

### ⑤ Mint spinner

CSS `.nl-spinner` — a small rotating ring (`@keyframes nl-spin`), reduced-motion gated to a
static ring. Placed where the mint flow currently shows text-only progress:

- `App.jsx` Mint button: a `.nl-spinner` before "Preparing…" (button already sets `aria-busy`).
- `App.jsx` "Minting…" note: a `.nl-spinner` before the text.

Spinner is `aria-hidden="true"`; the textual "Preparing…/Minting…" remains the accessible status.

## Files

| File | Change |
|------|--------|
| `frontend/src/format.js` | **new** — `shortId` helper |
| `frontend/src/format.test.js` | **new** — unit + monkey tests |
| `frontend/src/MyNotes.jsx` | ① Claim primary, ② close button, ③ shortId, ④ loading state + skeleton |
| `frontend/src/App.jsx` | ③ shortId (mgr), ⑤ spinner |
| `frontend/src/Leaderboard.jsx` | ③ shortId issuer, ④ skeleton |
| `frontend/src/App.css` | ② close button, ⑤ spinner, reduced-motion |
| `frontend/src/Leaderboard.css` | ④ skeleton + shimmer, reduced-motion |

**CSS placement rule:** skeleton styling goes in `Leaderboard.css` — it is the shared
board/table stylesheet, imported by both `Leaderboard.jsx` and `MyNotes.jsx` (so both get the
skeleton classes from one source). The close button and spinner go in `App.css` — imported by
both `App.jsx` and `MyNotes.jsx`, which is where those two affordances live.

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
