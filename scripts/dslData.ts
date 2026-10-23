// Chamber measurements published by Deeply Safe Labs (https://fr.deeplysafelabs.com/, "Computer Lab"),
// used by scripts/dsl.ts. Real computers in a computer-driven pressure chamber, set to fresh water,
// descent 30 m/min, ascent 10 m/min (G2: its own depth-dependent ideal rate), following the stops
// shown by the computer, without safety stop. Two protocols:
//   2x30: 30 m for 30 min (descent included), 90 min at the surface, then the same dive again;
//   6x30: 30 m for 16 min (descent included), 75 min at the surface, six times.
// For each dive: `nst` = no-stop time read at the bottom (s; null when the computer never asked for a
// stop during the 16 min, "> 16 min" on the site), `stops` = [depth (m), time spent there (s)] in the
// order they were made. Garmin times are to the second, the others as displayed (whole minutes).
// Values taken from the site's data (computerData); only the computers and settings that match a model
// of the simulator, or its algorithm (i100 and i300C: Pelagic Z+, as the i770R), are kept.

export interface DslDive { nst: number | null; stops: [number, number][] }
export interface DslTest { computer: string; algo: string; gf?: string; test: '2x30' | '6x30'; dives: DslDive[] }

export const DSL_TESTS: DslTest[] = [
  { computer: 'Descent MK2', algo: 'ZH-L16 C GF', gf: '30/70', test: '2x30', dives: [
    { nst: 558, stops: [[12, 29], [9, 216], [6, 387], [3, 1014]] },
    { nst: 559, stops: [[12, 42], [9, 210], [6, 388], [3, 1590]] },
  ] },
  { computer: 'Descent MK2', algo: 'ZH-L16 C GF', gf: '35/75', test: '2x30', dives: [
    { nst: 634, stops: [[12, 49], [9, 180], [6, 323], [3, 792]] },
    { nst: 633, stops: [[12, 49], [9, 181], [6, 329], [3, 1259]] },
  ] },
  { computer: 'Descent MK2', algo: 'ZH-L16 C GF', gf: '40/85', test: '2x30', dives: [
    { nst: 813, stops: [[9, 86], [6, 230], [3, 497]] },
    { nst: 816, stops: [[9, 85], [6, 243], [3, 839]] },
  ] },
  { computer: 'Descent MK2', algo: 'ZH-L16 C GF', gf: '45/95', test: '2x30', dives: [
    { nst: 967, stops: [[6, 159], [3, 363]] },
    { nst: 963, stops: [[6, 162], [3, 625]] },
  ] },
  { computer: 'Descent MK2', algo: 'ZH-L16 C GF', gf: '90/90', test: '2x30', dives: [
    { nst: 883, stops: [[6, 69], [3, 551]] },
    { nst: 889, stops: [[6, 66], [3, 836]] },
  ] },
  { computer: 'Descent MK2', algo: 'ZH-L16 C GF', gf: '30/70', test: '6x30', dives: [
    { nst: 555, stops: [[6, 87], [3, 196]] },
    { nst: 559, stops: [[6, 84], [3, 199]] },
    { nst: 560, stops: [[6, 83], [3, 198]] },
    { nst: 560, stops: [[6, 83], [3, 198]] },
    { nst: 562, stops: [[6, 82], [3, 198]] },
    { nst: 562, stops: [[6, 81], [3, 197]] },
  ] },
  { computer: 'Descent MK2', algo: 'ZH-L16 C GF', gf: '35/75', test: '6x30', dives: [
    { nst: 625, stops: [[6, 79], [3, 136]] },
    { nst: 627, stops: [[6, 78], [3, 141]] },
    { nst: 629, stops: [[6, 78], [3, 141]] },
    { nst: 630, stops: [[6, 77], [3, 140]] },
    { nst: 633, stops: [[6, 75], [3, 138]] },
    { nst: 632, stops: [[6, 76], [3, 138]] },
  ] },
  { computer: 'Descent MK2', algo: 'ZH-L16 C GF', gf: '40/85', test: '6x30', dives: [
    { nst: 816, stops: [[3, 68]] },
    { nst: 815, stops: [[3, 69]] },
    { nst: 816, stops: [[3, 69]] },
    { nst: 816, stops: [[3, 68]] },
    { nst: 816, stops: [[3, 68]] },
    { nst: 816, stops: [[3, 68]] },
  ] },
  { computer: 'Descent MK2', algo: 'ZH-L16 C GF', gf: '45/95', test: '6x30', dives: [
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
  ] },
  { computer: 'Descent MK2', algo: 'ZH-L16 C GF', gf: '90/90', test: '6x30', dives: [
    { nst: 892, stops: [] },
    { nst: 892, stops: [] },
    { nst: 894, stops: [] },
    { nst: 893, stops: [] },
    { nst: 894, stops: [] },
    { nst: 897, stops: [] },
  ] },
  { computer: 'Perdix 2', algo: 'ZH-L16 C GF', gf: '30/70', test: '2x30', dives: [
    { nst: 600, stops: [[12, 60], [9, 240], [6, 420], [3, 1080]] },
    { nst: 600, stops: [[12, 60], [9, 240], [6, 420], [3, 1680]] },
  ] },
  { computer: 'Perdix 2', algo: 'ZH-L16 C GF', gf: '35/75', test: '2x30', dives: [
    { nst: 704, stops: [[12, 60], [9, 180], [6, 360], [3, 900]] },
    { nst: 710, stops: [[12, 60], [9, 180], [6, 360], [3, 1500]] },
  ] },
  { computer: 'Perdix 2', algo: 'ZH-L16 C GF', gf: '40/85', test: '2x30', dives: [
    { nst: 878, stops: [[9, 120], [6, 240], [3, 540]] },
    { nst: 879, stops: [[9, 120], [6, 300], [3, 1020]] },
  ] },
  { computer: 'Perdix 2', algo: 'ZH-L16 C GF', gf: '45/95', test: '2x30', dives: [
    { nst: 1114, stops: [[6, 120], [3, 420]] },
    { nst: 1101, stops: [[6, 180], [3, 660]] },
  ] },
  { computer: 'Perdix 2', algo: 'ZH-L16 C GF', gf: '90/90', test: '2x30', dives: [
    { nst: 960, stops: [[6, 60], [3, 600]] },
    { nst: 960, stops: [[6, 60], [3, 900]] },
  ] },
  { computer: 'Perdix 2', algo: 'ZH-L16 C GF', gf: '30/70', test: '6x30', dives: [
    { nst: 600, stops: [[6, 60], [3, 180]] },
    { nst: 600, stops: [[6, 60], [3, 180]] },
    { nst: 600, stops: [[9, 60], [6, 120], [3, 180]] },
    { nst: 600, stops: [[6, 60], [3, 240]] },
    { nst: 600, stops: [[6, 60], [3, 240]] },
    { nst: 600, stops: [[6, 60], [3, 240]] },
  ] },
  { computer: 'Perdix 2', algo: 'ZH-L16 C GF', gf: '35/75', test: '6x30', dives: [
    { nst: 733, stops: [[6, 60], [3, 180]] },
    { nst: 738, stops: [[6, 60], [3, 180]] },
    { nst: 738, stops: [[6, 60], [3, 180]] },
    { nst: 733, stops: [[6, 60], [3, 120]] },
    { nst: 730, stops: [[6, 60], [3, 180]] },
    { nst: 731, stops: [[6, 60], [3, 180]] },
  ] },
  { computer: 'Perdix 2', algo: 'ZH-L16 C GF', gf: '40/85', test: '6x30', dives: [
    { nst: 911, stops: [[3, 60]] },
    { nst: 905, stops: [[3, 60]] },
    { nst: 913, stops: [[3, 60]] },
    { nst: 910, stops: [[3, 60]] },
    { nst: 916, stops: [[3, 60]] },
    { nst: 915, stops: [[3, 60]] },
  ] },
  { computer: 'Perdix 2', algo: 'ZH-L16 C GF', gf: '45/95', test: '6x30', dives: [
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
  ] },
  { computer: 'Perdix 2', algo: 'ZH-L16 C GF', gf: '90/90', test: '6x30', dives: [
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
  ] },
  { computer: 'Perdix 2', algo: 'DCIEM', test: '2x30', dives: [
    { nst: 989, stops: [[6, 60], [3, 600]] },
    { nst: 635, stops: [[6, 360], [3, 1560]] },
  ] },
  { computer: 'Perdix 2', algo: 'DCIEM', test: '6x30', dives: [
    { nst: null, stops: [] },
    { nst: 672, stops: [[3, 360]] },
    { nst: 626, stops: [[3, 420]] },
    { nst: 586, stops: [[3, 540]] },
    { nst: 566, stops: [[3, 540]] },
    { nst: 549, stops: [[3, 600]] },
  ] },
  { computer: 'G2', algo: 'ZH-L16 ADT MB', test: '2x30', dives: [
    { nst: 1020, stops: [[4, 60], [3, 900]] },
    { nst: 480, stops: [[9, 60], [6, 120], [5, 180], [4, 240], [3, 1740]] },
  ] },
  { computer: 'G2', algo: 'ZH-L16 ADT MB', test: '6x30', dives: [
    { nst: null, stops: [] },
    { nst: 540, stops: [[3, 360]] },
    { nst: 480, stops: [[4, 60], [3, 480]] },
    { nst: 420, stops: [[4, 120], [3, 540]] },
    { nst: 420, stops: [[4, 120], [3, 540]] },
    { nst: 420, stops: [[5, 120], [4, 180], [3, 780]] },
  ] },
  { computer: 'Luna 2.0', algo: 'ZH-L16 ADT MB', test: '2x30', dives: [
    { nst: 1020, stops: [[3, 960]] },
    { nst: 540, stops: [[6, 120], [5, 180], [4, 240], [3, 1680]] },
  ] },
  { computer: 'Luna 2.0', algo: 'ZH-L16 ADT MB', test: '6x30', dives: [
    { nst: null, stops: [] },
    { nst: 540, stops: [[3, 360]] },
    { nst: 480, stops: [[4, 60], [3, 480]] },
    { nst: 480, stops: [[4, 120], [3, 540]] },
    { nst: 480, stops: [[4, 120], [3, 540]] },
    { nst: 420, stops: [[5, 60], [4, 120], [3, 960]] },
  ] },
  { computer: 'Luna 2.0', algo: 'ZH-L16 C GF', gf: '30/70', test: '2x30', dives: [
    { nst: 600, stops: [[15, 60], [12, 180], [9, 240], [6, 120], [5, 120], [4, 240], [3, 1200]] },
    { nst: 600, stops: [[15, 60], [12, 180], [9, 240], [6, 120], [5, 180], [4, 240], [3, 2520]] },
  ] },
  { computer: 'Luna 2.0', algo: 'ZH-L16 C GF', gf: '90/90', test: '2x30', dives: [
    { nst: 960, stops: [[4, 60], [3, 720]] },
    { nst: 960, stops: [[4, 60], [3, 1500]] },
  ] },
  { computer: 'Luna 2.0', algo: 'ZH-L16 C GF', gf: '30/70', test: '6x30', dives: [
    { nst: 600, stops: [[9, 120], [6, 60], [5, 60], [4, 60], [3, 240]] },
    { nst: 600, stops: [[9, 120], [6, 60], [5, 60], [4, 60], [3, 420]] },
    { nst: 600, stops: [[9, 120], [6, 60], [5, 60], [4, 60], [3, 780]] },
    { nst: 600, stops: [[9, 120], [6, 60], [5, 60], [4, 60], [3, 780]] },
    { nst: 600, stops: [[12, 60], [9, 120], [6, 60], [5, 60], [4, 60], [3, 1620]] },
    { nst: 600, stops: [[9, 120], [6, 60], [5, 60], [4, 60], [3, 2100]] },
  ] },
  { computer: 'Luna 2.0', algo: 'ZH-L16 C GF', gf: '90/90', test: '6x30', dives: [
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: 900, stops: [[3, 60]] },
  ] },
  { computer: 'Quad Air', algo: 'Mares RGBM', test: '2x30', dives: [
    { nst: 1020, stops: [[3, 840]] },
    { nst: 1020, stops: [[3, 1980]] },
  ] },
  { computer: 'Quad Air', algo: 'Mares RGBM', test: '6x30', dives: [
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
    { nst: null, stops: [] },
  ] },
  { computer: 'i100', algo: 'Pelagic Z+', test: '2x30', dives: [
    { nst: 960, stops: [[6, 60], [3, 1140]] },
    { nst: 900, stops: [[6, 180], [3, 2100]] },
  ] },
  { computer: 'i100', algo: 'Pelagic Z+', test: '6x30', dives: [
    { nst: null, stops: [] },
    { nst: 720, stops: [[3, 180]] },
    { nst: 720, stops: [[3, 240]] },
    { nst: 720, stops: [[3, 240]] },
    { nst: 720, stops: [[3, 240]] },
    { nst: 720, stops: [[3, 240]] },
  ] },
  { computer: 'i300C', algo: 'Pelagic Z+', test: '2x30', dives: [
    { nst: 900, stops: [[6, 120], [3, 1320]] },
    { nst: 840, stops: [[6, 240], [3, 2220]] },
  ] },
  { computer: 'i300C', algo: 'Pelagic Z+', test: '6x30', dives: [
    { nst: null, stops: [] },
    { nst: 720, stops: [[3, 180]] },
    { nst: 720, stops: [[3, 300]] },
    { nst: 720, stops: [[3, 300]] },
    { nst: 720, stops: [[3, 300]] },
    { nst: 720, stops: [[3, 300]] },
  ] },
];
