// Pure mapping helpers for the Mascot component. Kept separate so the
// variant→asset and treatment→class logic is unit-testable without a DOM.

const VARIANTS = new Set([1, 2, 3]);
const TREATMENTS = {
  duotone: 'nl-mascot-img--duotone', // empty states — nacre duotone, always on
  full: 'nl-mascot-img--full',       // mint success — full colour peak
};
// note: the masthead grayscale→colour reveal is done with bespoke
// .nl-mast-logo-btn CSS (it's a bobbing 80px logo, not a pearl-well), so there
// is intentionally no 'reveal' treatment on the <Mascot> component.

export function mascotSrc(variant) {
  if (!VARIANTS.has(variant)) throw new Error(`mascot: bad variant ${variant} (expected 1|2|3)`);
  return `/logo_${variant}-clear.png`;
}

export function treatmentClass(treatment) {
  const cls = TREATMENTS[treatment];
  if (!cls) throw new Error(`mascot: unknown treatment ${treatment}`);
  return cls;
}
