// Standard diving hand signals drawn as icons, for the vertical speed controls over the water column
// and the 3D view: thumb up (ascend), thumb down (descend), flat hand palm down rocked from side to side
// (hold this level).

/** Closed fist seen from the side, thumb up (rotated half a turn for "descend"). */
const FIST = `<rect x="6.6" y="2.5" width="4.2" height="10" rx="2.1"/>
  <rect x="7" y="10" width="5" height="10.6" rx="2"/>
  <rect x="9" y="10" width="9.5" height="2.3" rx="1.15"/><rect x="9" y="12.8" width="10" height="2.3" rx="1.15"/>
  <rect x="9" y="15.6" width="9.5" height="2.3" rx="1.15"/><rect x="9" y="18.4" width="8.5" height="2.3" rx="1.15"/>`;

/**
 * Open hand seen from above, palm down, fingers together and pointing sideways, rocked from side to side
 * (the double arrow under it).
 */
const FLAT = `<g transform="translate(1.6 -1) scale(0.86)"><rect x="2.5" y="8" width="9.5" height="10.6" rx="2.6"/>
  <rect x="9" y="8" width="11.5" height="2.3" rx="1.15"/><rect x="9" y="10.8" width="12.5" height="2.3" rx="1.15"/>
  <rect x="9" y="13.6" width="12" height="2.3" rx="1.15"/><rect x="9" y="16.4" width="10" height="2.3" rx="1.15"/>
  <rect x="4.8" y="3.6" width="3.6" height="7.4" rx="1.8" transform="rotate(-35 6.6 10)"/></g>
  <path d="M5 20.2H19M7.6 17.8 5 20.2l2.6 2.4M16.4 17.8l2.6 2.4-2.6 2.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`;

const svg = (body: string, cls: string, rotate = false) =>
  `<svg class="hand-sign ${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${rotate ? `<g transform="rotate(180 12 12)">${body}</g>` : body}</svg>`;

export const HAND_SIGNS = {
  up: svg(FIST, 'up'),
  down: svg(FIST, 'down', true),
  hold: svg(FLAT, 'hold'),
};

/** Replaces the ▲ ■ ▼ marks of a text (already escaped HTML) by the hand signals. */
export function withHandSigns(html: string): string {
  return html.replace(/▲/g, HAND_SIGNS.up).replace(/■/g, HAND_SIGNS.hold).replace(/▼/g, HAND_SIGNS.down);
}
