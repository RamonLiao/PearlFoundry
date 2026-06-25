import { mascotSrc, treatmentClass } from './mascot.js';
import './Mascot.css';

/**
 * Pearl-well-framed kawaii mascot. The well tones the raster toward the brand;
 * `treatment` selects the filter (duotone / full). Decorative by default
 * (alt=''): meaning is carried by adjacent copy.
 */
export default function Mascot({ variant, treatment, size = 72, glow = false, alt = '' }) {
  return (
    <span className={`nl-pearl-well${glow ? ' nl-pearl-well--glow' : ''}`}
      style={{ '--mascot-size': `${size}px` }}>
      <img
        className={`nl-mascot-img ${treatmentClass(treatment)}`}
        src={mascotSrc(variant)}
        width={size} height={size}
        loading="eager" decoding="async" alt={alt}
      />
    </span>
  );
}
