# Mascot Accents — kawaii pearl-shell variants into the frontend

Date: 2026-06-25
Status: design (review-integrated; awaiting user spec review)

## Goal

Bring the three kawaii pearl-shell logo variants (`docs/logo-clear/logo_{1,2,3}-clear.png`)
into the live frontend as small, tasteful accents — without breaking the refined "Nacre Light"
brand or competing with the chart hero.

## Core tension & decision

The variants are **detailed, full-colour kawaii cartoon rasters** (thick dark outlines tuned for
dark bg, baked-in drop shadows, anime sparkles). The current brand is **refined hand-drawn
single-colour SVG + pearl/molten palette on a light cream surface**. Dropping a raw cartoon in
reads childish / AI-slop. A token desaturation (`saturate(0.92)`) is a no-op — both plan-stage
reviews flagged this as the central risk.

**Decision — hybrid treatment (saturation = emotion / interaction), validated against a live
visual comparison (`docs/logo-clear/treatment-compare.html`):**

| Placement | Treatment | Why |
|-----------|-----------|-----|
| Empty states ×2 | **B — nacre duotone (always-on)** | persistent, no hover dependence (mobile-safe), calm mood |
| Masthead easter-egg | **A — grayscale-at-rest → colour on click/focus** | the click IS the reveal trigger; interaction earns colour |
| Mint success | **Full colour + molten glow** | the single high-saturation peak of the app |

Consistent logic across the site: at rest = restrained (duotone), user pokes it = it blooms
(reveal), the trade closes = full colour.

### Treatment A — grayscale → colour (masthead)

- At rest: `filter: grayscale(1) opacity(.85)`.
- On `:hover` / `:focus-visible` / click-cycle: transition to `filter: grayscale(0) opacity(1)`.
- `transition: filter .45s ease` — **must be added to the reduced-motion block** (filter
  transition is motion-adjacent; under `prefers-reduced-motion` show the resting grayscale with no
  transition, and let click still swap instantly).

### Treatment B — nacre duotone (empty states)

- `filter: saturate(.5) contrast(.97) brightness(1.02) sepia(.14)` on the `<img>`.
- A nacre `mix-blend-mode: color` overlay stains the shell into the palette: an `aria-hidden`
  `::after`/overlay on the well, `radial-gradient` of `--nacre-accent`/nacre stops at ~22% opacity.
- Final values to be tuned by eye against the live render; the comparison page values are the
  starting point.

### Shared treatment rules (both)

- **Kill the baked-in clam drop-shadow.** The rasters carry their own bottom drop-shadow; combined
  with the well's shadow that double-shadow is the #1 slop tell. Mask the lower ~14% of the image
  into the well floor: `mask-image: linear-gradient(to bottom, #000 84%, transparent 100%)`
  (+ `-webkit-` prefix). Do NOT add a molten halo ring on the at-rest well.
- **`filter` goes on the `<img>`, not the `.nl-pearl-well` wrapper** — otherwise the blend overlay
  composites against the filtered result, not the source (sui-frontend M4).
- **Keep the well quiet** — soft inner shadow + faint nacre radial only. Reserve any molten glow
  for the mint celebration (do not reintroduce the loud molten the masthead deliberately dropped).

## Variant → context mapping

| Variant | Expression | Used at |
|---------|-----------|---------|
| `logo_3` closed-eye serene smile | calm / inviting | **both empty states** + masthead initial |
| `logo_1` open eyes, big smile | most joyful | **mint success celebration** + masthead cycle |
| `logo_2` biggest pearl, vine flourish | showy | **masthead cycle only** |

Note (review I1): the showy `logo_2` is NOT used for the Leaderboard empty state — an empty board is
a low-key "nobody here yet" moment that the celebrating mascot fights. Serene `logo_3` invites
better for both empty states. The exuberant variants live in the masthead easter-egg.

## Components & insertion points

### 1. Shared `<Mascot>` component (new — `frontend/src/Mascot.jsx`)

Single source of truth for the pearl-well framing. Props:

- `variant` (1 | 2 | 3) → `/logo_{n}-clear.png`
- `treatment` (`'duotone'` | `'reveal'` | `'full'`) → selects the filter class (B / A / peak)
- `size` (number px; default 72)
- `alt` (string; default `''` — decorative; meaning is carried by adjacent copy)

Renders `<img loading="eager">` inside a circular pearl-well:
- circular `radial-gradient` nacre background + soft inner shadow
- treatment-specific filter class on the `<img>`
- shadow-mask (above) on the `<img>`

Root element class is **`.nl-pearl-well`** (container) + **`.nl-mascot-img`** (img).
**Do NOT use `.nl-mascot`** as the component root — `.nl-mascot` is already taken by the masthead
tagline row (App.jsx:118) and would cross-contaminate styles (sui-frontend M3).

Styles live in `App.css` (imported by both App and MyNotes). The mix-blend overlay sits above the
`<img>` in DOM order so the `filter` stacking context doesn't swallow it (sui-frontend M4).

### Keyframe naming contract (sui-frontend C2 — collision-proofing)

`@keyframes nl-reveal` is **already defined twice** (App.css ~159 AND Leaderboard.css ~32), both
imported by MyNotes — works only because the bodies are identical. Any new animation MUST use a
fresh name. Reserved names not to reuse: `nl-reveal`, `nl-pulse`, `nl-bob`, `nl-draw`, `nl-fillin`,
`nl-shimmer`, `nl-drift`, `nl-rise`, `nl-pearl`, `nl-skel-sweep`. The mint celebration uses
**`nl-clam-open`** (new). Implementer must `grep @keyframes` across App.css + Leaderboard.css before
adding.

### 2. Empty-state illustrations (highest-value gap) — Treatment B

- **MyNotes** `No notes found.` (MyNotes.jsx:190) and **Leaderboard** `No settled notes yet.`
  (Leaderboard.jsx:59) are currently `<p className="nl-empty">`. **A `<div>`/`<img>` inside a `<p>`
  is invalid HTML** (block-in-inline; browser auto-closes the `<p>`) — sui-frontend I1. Change each
  to a `<figure className="nl-empty nl-empty--illustrated">` (or a flex `<div>`), with a `<figcaption>`
  or child `<p>` carrying the copy.
- Composition (frontend-design I2): `display:flex; flex-direction:column; align-items:center;
  text-align:center; padding: clamp(40px,8vh,72px) 24px`.
  - Mascot well: **72px image** (~104px well incl. nacre ring), `margin-bottom:20px`.
  - Headline: Fraunces, `18px`, `var(--pearl)`, `letter-spacing:-0.01em`, `margin:0`. Give the empty
    state a real headline, not resized body text.
  - Subcopy: `13px`, `var(--pearl-dim)`, `max-width:34ch`, `margin-top:6px`, `line-height:1.5`.
  - Keep spacing on the existing 4px rhythm.
- Copy: MyNotes → headline "No notes yet" + subcopy "Issue your first Range Note above to see it
  appear here." Leaderboard → headline "Be the first on the Ledger" + subcopy "No settled notes yet
  — issuers appear here once their notes settle." (final wording flexible).
- Both render only inside the existing `!loading && !msg && empty` gates — no new state.
- **Keep the copy as a real text node**; image is decorative (`alt=''`). Headline carries 100% of
  meaning for SR (frontend-design I3).
- Use `loading="eager"` (the empty-state mascot appears synchronously with content; lazy would flash
  a blank slot) — sui-frontend M1.
- **Leaderboard `.nl-board` has `overflow:hidden`** (Leaderboard.css:6) — give the mascot enough
  top padding so the well's inner shadow / any glow clears the `border-radius:22px` edge
  (sui-frontend M5).

### 3. Mint success celebration — Full colour + molten glow

- **There is no `mintPhase === 'done'` render site today** (sui-frontend I3): App.jsx renders a
  `{status && <pre className="nl-status nl-status--ok">}` block, gated by `status`, not `mintPhase`.
  Add an explicit block: `{mintPhase === 'done' && statusKind === 'ok' && <div className="nl-mint-celebration">…</div>}`
  positioned between the minting-spinner block and the `{status && <pre>}` block, so the mascot
  never appears on error/cancelled states.
- `<Mascot variant={1} treatment="full" />` with the molten-glow well
  (`box-shadow: …, 0 0 0 1px rgba(224,160,60,.35), 0 6px 22px rgba(224,160,60,.45)`).
- One-shot entrance `@keyframes nl-clam-open`: ≤600ms, single play, `ease-out`, **no bounce/spring/
  overshoot**: `scale(.94→1)` + `opacity(0→1)` + short `translateY(6px→0)` settle
  (frontend-design M1).
- Sparkles: reuse existing `.nl-bubble` / `nl-rise` vocabulary, 3–4 max, staggered, fading at apex.
  **No confetti / particle burst** (the gimmick line). No new dependency.
- **Reduced-motion gate**: render static, full-colour, no entrance — extend the existing
  `@media (prefers-reduced-motion)` block in App.css (~lines 211–222), do not add a new one.
- `loading="eager"` for the celebration variant so it doesn't pop in after the animation fires
  (frontend-design M4).

### 4. Masthead easter-egg — Treatment A (also the pre-connect presence)

- Convert the masthead logo (App.jsx:105 `<img className="nl-mast-logo">`) into a `<button>` that
  cycles variant on **click only** (no hover-swap — hover-swap feels like a broken toggle;
  frontend-design M2): 3 → 1 → 2 → 3…
- Treatment A reveal: grayscale at rest, colour on hover/focus/click.
- `useState` index only; no rotation timer, no autoplay.
- Layout-shift guard (sui-frontend I2): keep `width:80px; height:80px; object-fit:contain` on the
  inner `<img>`; confirm all three PNG canvases are the same dimensions (they are — 341²).
- Keep the existing `nl-bob` animation on the `<img>` (already reduced-motion gated at App.css:215).
  Put the `focus-visible` outline on the `<button>` with `outline-offset:4px`, and freeze the bob
  while keyboard-focused (`button:focus-visible > img { animation: none }`) so the focus ring
  doesn't bob (sui-frontend I2).
- a11y (frontend-design M2): the button does not navigate and the mascot change is meaningless to
  SR users — use a plain `aria-label="PearlFoundry"`. Do NOT advertise the decorative cycle as a
  feature; no "click me" hint (kills the easter-egg). `cursor:pointer`.
- This replaces the rejected standalone "Connect-front hero" — playful pre-connect touch without
  stealing the chart hero's first-glance role.

## Assets

Copy `docs/logo-clear/logo_{1,2,3}-clear.png` → `frontend/public/logo_{1,2,3}-clear.png`
(~390 KB total, all off critical path). `logo_3-clear` already ships as `public/logo-mark.png`;
copy it under the uniform `logo_3-clear.png` name so the `<Mascot>` variant array is regular.
**Masthead initial `src` stays `/logo-mark.png`** (already in cache from current render); the cycle
swaps to `/logo_{n}-clear.png` on first click (sui-frontend I4 — avoids a duplicate fetch / flash).
Canonical filenames are the `-clear.png` (transparent) set; `-ondark.png` are dark-bg previews only,
not shipped.

## Scope guardrails (YAGNI)

- No autoplay/timed rotation, no carousel library, no animation framework, no confetti.
- No backend / API / business-logic changes — pure presentation. Branch-wide `git diff` must show
  `move/`, indexer, api.js, mint.js, config byte-unchanged.
- No variants added beyond the mapping above.

## Testing & verification

1. `vite build` green.
2. Branch-wide `git diff` zero-logic invariant (presentation-only).
3. Existing `node --test` frontend suite still green (no logic touched).
- **Human-deferred (sandbox has no browser-with-wallet)**: actual render of duotone/reveal/peak
  treatments, shadow-mask, celebration animation, masthead cycle, empty-state layouts.
  `cd frontend && npm run dev`. The treatment values in §Core are starting points to tune by eye.
- Reduced-motion: verify celebration + filter-transition are gated (extend existing media block).

## Out of scope

- Redesigning the masthead, chart hero, or any existing component.
- Replacing the existing hand-drawn SVG icons.
