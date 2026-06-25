// Pure mapping helpers for the Mascot component. Kept separate so the
// variant→asset and treatment→class logic is unit-testable without a DOM.

const VARIANTS = new Set([1, 2, 3]);
const TREATMENTS = {
  duotone: 'nl-mascot-img--duotone', // empty states — nacre duotone, always on
  reveal: 'nl-mascot-img--reveal',   // masthead — grayscale at rest, colour on hover/focus
  full: 'nl-mascot-img--full',       // mint success — full colour peak
};

export function mascotSrc(variant) {
  if (!VARIANTS.has(variant)) throw new Error(`mascot: bad variant ${variant} (expected 1|2|3)`);
  return `/logo_${variant}-clear.png`;
}

export function treatmentClass(treatment) {
  const cls = TREATMENTS[treatment];
  if (!cls) throw new Error(`mascot: unknown treatment ${treatment}`);
  return cls;
}
