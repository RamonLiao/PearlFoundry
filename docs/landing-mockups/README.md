# Landing-page mockups (art reference)

Brainstorming mockups for the PearlFoundry landing page (2026-06-25). Self-contained
(mascot images base64-embedded), open directly in a browser.

- **`landing-layout-AB.html`** — first pass: two layout directions side by side
  (A = asymmetric hero + banded flow, B = centered hero + symmetric cards). Fixed-width,
  no RWD — superseded by the RWD version below.
- **`landing-rwd.html`** — the chosen direction shown responsive: one page + one set of
  `@container` rules, rendered at desktop (760px) and mobile (330px) frames side by side
  so the reflow is visible (hero collapses & mascot floats to top, 3-col→1-col,
  mint→settle→claim flow goes vertical, nav links hide / Launch-App CTA stays).

Note: these were authored as the visual-companion's content *fragments*, so the outer
`h2`/`.subtitle` text relies on the companion frame's base CSS — standalone they render
slightly unstyled at the very top, but the mockup panels themselves (the actual art) are
fully self-styled via their inline `<style>`. Palette = Nacre Light theme
(`frontend/src/theme.css`). Keep as reference for future landing / marketing surfaces.
