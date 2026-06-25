# Mascot Accents — kawaii pearl-shell variants into the frontend

Date: 2026-06-25
Status: design (awaiting user review)

## Goal

Bring the three kawaii pearl-shell logo variants (`docs/logo-clear/logo_{1,2,3}-clear.png`)
into the live frontend as small, tasteful accents — without breaking the refined "Nacre Light"
brand or competing with the chart hero.

## Core tension & decision

The variants are **detailed, full-colour kawaii cartoon rasters**. The current brand is
**refined hand-drawn single-colour SVG + pearl/molten palette**. Dropping a raw cartoon in
reads childish / AI-slop.

**Decision: small-and-precise, nacre-framed.** Every mascot appears only at low-frequency,
high-emotion moments, at a constrained size, inside a shared "pearl-well" frame that tones the
raster down so it blends into the brand. Variants are mapped to emotional context (flexible per
insertion point), not locked to a single image.

## Variant → context mapping

| Variant | Expression | Used at |
|---------|-----------|---------|
| `logo_1` open eyes, big smile, in-shell sparkle | most joyful | **Mint success celebration** |
| `logo_2` biggest brightest pearl, vine flourish | showy / inviting | **Leaderboard empty state** ("be the first on the Ledger") |
| `logo_3` closed-eye serene smile, strongest molten glow | calm / inviting | **MyNotes empty state** + masthead default |

## Components & insertion points

### 1. Shared `<Mascot>` component (new — `frontend/src/Mascot.jsx`)

Single source of truth for the nacre framing so all uses stay consistent (change once → change
everywhere). Props:

- `variant` (1 | 2 | 3) → maps to `/logo_{n}-clear.png`
- `size` (number, px; default per use-site)
- `className` (optional extra)
- `alt` (string; default `''` decorative — empty-state copy carries meaning, so the image is
  decorative there)

Renders an `<img loading="lazy">` inside a circular "pearl well":
- circular `radial-gradient` nacre background + soft inner shadow (pearl seated in shell)
- `filter: saturate(0.92)` to pull the raster toward the brand palette
- molten `drop-shadow` halo ring (reuse existing `--molten`/glow tokens)

Styles live in `App.css` (imported by both App and MyNotes) under a `.nl-mascot-img` /
`.nl-pearl-well` block. **Grep `@keyframes` / class names across App.css + Leaderboard.css before
adding any animation keyframe** (lesson 2026-06-24: keyframe name collisions when one component
imports two stylesheets).

### 2. Empty-state illustrations (highest-value gap)

- **MyNotes** `No notes found.` (MyNotes.jsx:190) → `<Mascot variant={3} size={96}/>` above
  revised copy: e.g. "No notes yet — issue your first Range Note above." Keep the text node so
  screen-reader / no-image fallback still works; image is decorative (`alt=''`).
- **Leaderboard** `No settled notes yet.` (Leaderboard.jsx:59) → `<Mascot variant={2} size={96}/>`
  above copy "Be the first on the Ledger."
- Both render only in the existing `!loading && !msg && empty` gates — no new state machine.

### 3. Mint success celebration

- In App.jsx where `mintPhase === 'done'`, show `<Mascot variant={1}/>` with a one-shot
  "clam opens + sparkles rise" entrance animation.
- Reuse existing `.nl-bubble` / sparkle vocabulary; **no new dependency**.
- **Reduced-motion gate**: under `prefers-reduced-motion` the mascot renders statically (no
  entrance animation) — extend the existing `@media (prefers-reduced-motion)` block in App.css,
  do not add a new one.

### 4. Masthead easter-egg (also covers "pre-connect presence")

- Convert the masthead logo (App.jsx:105 `<img className="nl-mast-logo">`) into a `<button>` that
  cycles variant on click: 3 → 1 → 2 → 3…
- `useState` index only; no rotation timer, no autoplay.
- Accessibility: real `<button>`, `aria-label` (e.g. "PearlFoundry — tap to change mascot"),
  keyboard-activatable, focus-visible ring consistent with site. Keep the existing bob animation
  (already reduced-motion gated at App.css:215).
- This replaces the rejected standalone "Connect-front hero" — it gives a playful pre-connect
  touch without stealing the chart hero's first-glance role.

## Assets

Copy `docs/logo-clear/logo_{1,2,3}-clear.png` → `frontend/public/logo_{1,2,3}-clear.png`
(~390 KB total, all off critical path, lazy-loaded). `logo_3-clear` is already shipped as
`public/logo-mark.png`; copy it under the uniform `logo_3-clear.png` name too so the `<Mascot>`
variant array is regular. Leave `logo-mark.png` in place (masthead initial src can stay or move to
the array — implementer's call, keep one popup-free path).

## Scope guardrails (YAGNI)

- No autoplay/timed rotation, no carousel library, no new animation framework.
- No backend / API / business-logic changes — pure presentation layer. Branch-wide `git diff`
  must show `move/`, indexer, api.js, mint.js, config byte-unchanged.
- Variants beyond the mapping above are not added speculatively.

## Testing & verification

- This is CSS + small JSX. Verification gate:
  1. `vite build` green.
  2. Branch-wide `git diff` zero-logic invariant (presentation-only).
  3. Existing `node --test` frontend suite still green (format/payoff/etc — no logic touched).
- **Human-deferred (sandbox has no browser-with-wallet)**: actual render of the nacre-well framing,
  celebration animation, masthead cycle, and empty-state layouts. `cd frontend && npm run dev`.
- Reduced-motion: verify the celebration anim is gated (extend existing media block).

## Out of scope

- Redesigning the masthead, chart hero, or any existing component.
- Replacing the existing hand-drawn SVG icons.
