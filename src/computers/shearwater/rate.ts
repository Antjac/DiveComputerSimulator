// RATE display of the Shearwater Perdix 2 and Peregrine: colour of the value, after the firmware release
// notes (Petrel 2 / Perdix / Perdix AI / NERD 2 / Peregrine, version 78 of 2020-07-23, p. 12; Perdix 2
// release notes v102, p. 29; Perdix 2 Technical manual, Info Screen Descriptions: "Same colour rules as
// ascent indicator"). Not in the Peregrine owner's manual.

/**
 * "Color coding is applied only during ascents and follows the same rules as the existing ascent rate
 * bar graph: Default 0 to 35 ft/min, 0 to 10.5 m/min; Yellow 36 to 65, 10.6 to 19.5; Red 65+, 19.6+."
 * The release notes' figure shows the yellow case: black digits on a yellow background around the
 * number only (the arrow and the label keep their colours); red is drawn the same way (deduced).
 */
export function rateColour(rate: number): '' | 'yellow' | 'red' {
  if (rate <= 0) return '';
  return rate > 19.5 ? 'red' : rate > 10.5 ? 'yellow' : '';
}
