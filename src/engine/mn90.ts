// French Navy MN90 air tables, as published by the FFESSM ("Tables de plongée FFESSM établies à
// partir des tables MN 90 de la Marine Nationale", mode d'emploi J.-L. Blanchard & F. Imbert,
// July 2005 edition), and a reader that places the diver's dives in them. Like the computers, the
// tracker reads the session and never changes it.
//
// Sections quoted below are those of that booklet: « Généralités », « Plongées consécutives »,
// « Plongées successives », « Remontée lente », « Remontée rapide », « Plongée au mélange enrichi »,
// tables p. 4–5, Tableaux I, II (p. 6) and IV (p. 7).
import type { Gas } from './buhlmann';
import { DIVE_START_DEPTH, type DiveSession } from './session';

/** Successive dive group (GPS); '*': no successive dive allowed. */
export type Gps = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | '*';
export const GROUPS = 'ABCDEFGHIJKLMNOP'.split('') as Exclude<Gps, '*'>[];

/** One line of a depth's table: dive time (min), GPS, total ascent time DTR (min), then the stops
 *  in minutes from 3 m upward (3 m, 6 m, 9 m, 12 m, 15 m). */
export type Mn90Line = [minutes: number, gps: Gps, dtr: number, ...stops: number[]];

/** Tables p. 4–5, transcribed from the booklet (each line checked against Tableau IV: DTR = stops
 *  + ascent and inter-stop time). 62 and 65 m are emergency tables (« tables de secours »). */
export const MN90: Record<number, Mn90Line[]> = {
  6: [[15, 'A', 1], [30, 'B', 1], [45, 'C', 1], [75, 'D', 1], [105, 'E', 1], [135, 'F', 1], [180, 'G', 1], [240, 'H', 1], [315, 'I', 1], [360, 'J', 1]],
  8: [[15, 'B', 1], [30, 'C', 1], [45, 'D', 1], [60, 'E', 1], [90, 'F', 1], [105, 'G', 1], [135, 'H', 1], [165, 'I', 1], [195, 'J', 1], [255, 'K', 1], [300, 'L', 1], [360, 'M', 1]],
  10: [[15, 'B', 1], [30, 'C', 1], [45, 'D', 1], [60, 'F', 1], [75, 'G', 1], [105, 'H', 1], [120, 'I', 1], [135, 'J', 1], [165, 'K', 1], [180, 'L', 1], [240, 'M', 1], [255, 'N', 1], [315, 'O', 1], [330, 'P', 1], [360, 'P', 2, 1]],
  12: [[5, 'A', 1], [10, 'B', 1], [15, 'B', 1], [20, 'C', 1], [25, 'C', 1], [30, 'D', 1], [35, 'D', 1], [40, 'E', 1], [45, 'E', 1], [50, 'F', 1], [55, 'F', 1], [60, 'G', 1], [65, 'G', 1], [70, 'H', 1], [75, 'H', 1], [80, 'H', 1], [85, 'I', 1], [90, 'I', 1], [95, 'J', 1], [100, 'J', 1], [105, 'J', 1], [110, 'K', 1], [115, 'K', 1], [120, 'K', 1], [130, 'L', 1], [135, 'L', 1], [140, 'L', 4, 2], [150, 'M', 6, 4], [160, 'M', 8, 6], [170, 'N', 9, 7], [180, 'N', 11, 9], [190, 'N', 13, 11], [200, 'O', 15, 13], [210, 'O', 16, 14], [220, 'O', 17, 15], [230, 'O', 18, 16], [240, 'O', 19, 17], [250, 'P', 20, 18], [255, 'P', 21, 19], [270, 'P', 24, 22]],
  15: [[5, 'A', 1], [10, 'B', 1], [15, 'C', 1], [20, 'C', 1], [25, 'D', 1], [30, 'E', 1], [35, 'E', 1], [40, 'F', 1], [45, 'G', 1], [50, 'G', 1], [55, 'H', 1], [60, 'H', 1], [65, 'I', 1], [70, 'I', 1], [75, 'J', 1], [80, 'J', 4, 2], [85, 'K', 6, 4], [90, 'K', 8, 6], [95, 'L', 10, 8], [100, 'L', 13, 11], [105, 'L', 15, 13], [110, 'M', 17, 15], [115, 'M', 19, 17], [120, 'M', 20, 18]],
  18: [[5, 'B', 2], [10, 'B', 2], [15, 'C', 2], [20, 'D', 2], [25, 'E', 2], [30, 'F', 2], [35, 'F', 2], [40, 'G', 2], [45, 'H', 2], [50, 'H', 2], [55, 'I', 3, 1], [60, 'J', 7, 5], [65, 'J', 10, 8], [70, 'K', 13, 11], [75, 'K', 16, 14], [80, 'L', 19, 17], [85, 'L', 23, 21], [90, 'M', 25, 23], [95, 'M', 28, 26], [100, 'M', 30, 28], [105, 'N', 33, 31], [110, 'N', 36, 34], [115, 'N', 38, 36], [120, 'O', 40, 38]],
  20: [[5, 'B', 2], [10, 'B', 2], [15, 'D', 2], [20, 'D', 2], [25, 'E', 2], [30, 'F', 2], [35, 'G', 2], [40, 'H', 2], [45, 'I', 3, 1], [50, 'I', 6, 4], [55, 'J', 11, 9], [60, 'K', 15, 13], [65, 'K', 18, 16], [70, 'L', 22, 20], [75, 'L', 26, 24], [80, 'M', 29, 27], [85, 'M', 32, 30], [90, 'M', 36, 34]],
  22: [[5, 'B', 2], [10, 'C', 2], [15, 'D', 2], [20, 'E', 2], [25, 'F', 2], [30, 'G', 2], [35, 'H', 2], [40, 'I', 4, 2], [45, 'I', 9, 7], [50, 'J', 14, 12], [55, 'K', 18, 16], [60, 'K', 22, 20], [65, 'L', 27, 25], [70, 'L', 31, 29], [75, 'M', 35, 33], [80, 'M', 39, 37], [85, 'N', 43, 41], [90, 'N', 46, 44]],
  25: [[5, 'B', 2], [10, 'C', 2], [15, 'D', 2], [20, 'E', 2], [25, 'F', 3, 1], [30, 'H', 4, 2], [35, 'I', 7, 5], [40, 'J', 12, 10], [45, 'J', 18, 16], [50, 'K', 23, 21], [55, 'L', 29, 27], [60, 'L', 34, 32], [65, 'M', 39, 37], [70, 'M', 45, 41, 1], [75, 'N', 50, 43, 4], [80, 'N', 55, 45, 7], [85, 'O', 60, 48, 9], [90, 'O', 64, 50, 11]],
  28: [[5, 'B', 2], [10, 'D', 2], [15, 'E', 2], [20, 'F', 4, 1], [25, 'G', 5, 2], [30, 'H', 9, 6], [35, 'I', 15, 12], [40, 'J', 22, 19], [45, 'K', 28, 25], [50, 'L', 35, 32], [55, 'M', 41, 36, 2], [60, 'M', 47, 40, 4], [65, 'N', 54, 43, 8], [70, 'N', 60, 46, 11], [75, 'O', 65, 48, 14], [80, 'O', 70, 50, 17], [85, 'O', 76, 53, 20], [90, 'P', 82, 56, 23]],
  30: [[5, 'B', 2], [10, 'D', 2], [15, 'E', 4, 1], [20, 'F', 5, 2], [25, 'H', 7, 4], [30, 'I', 12, 9], [35, 'J', 20, 17], [40, 'K', 27, 24], [45, 'L', 35, 31, 1], [50, 'M', 42, 36, 3], [55, 'M', 48, 39, 6], [60, 'N', 56, 43, 10], [65, 'N', 63, 46, 14], [70, 'O', 68, 48, 17]],
  32: [[5, 'B', 3], [10, 'D', 3], [15, 'E', 4, 1], [20, 'G', 6, 3], [25, 'H', 9, 6], [30, 'I', 17, 14], [35, 'K', 25, 22], [40, 'K', 33, 29, 1], [45, 'L', 41, 34, 4], [50, 'M', 49, 39, 7], [55, 'N', 57, 43, 11], [60, 'N', 64, 46, 15], [65, 'O', 70, 48, 19], [70, 'O', 76, 50, 23]],
  35: [[5, 'C', 3], [10, 'D', 3], [15, 'F', 5, 2], [20, 'H', 8, 5], [25, 'I', 14, 11], [30, 'J', 24, 20, 1], [35, 'K', 32, 27, 2], [40, 'L', 42, 34, 5], [45, 'M', 51, 39, 9], [50, 'N', 60, 43, 14], [55, 'N', 68, 47, 18], [60, 'O', 75, 50, 22], [65, '*', 84, 52, 26, 2], [70, '*', 93, 57, 28, 4]],
  38: [[5, 'C', 3], [10, 'E', 4, 1], [15, 'F', 7, 4], [20, 'H', 11, 8], [25, 'J', 21, 16, 1], [30, 'K', 31, 24, 3], [35, 'L', 42, 33, 5], [40, 'M', 52, 38, 10], [45, 'N', 62, 43, 15], [50, 'N', 71, 47, 20], [55, 'O', 79, 50, 23, 2], [60, 'P', 89, 53, 27, 5], [65, '*', 99, 58, 29, 8], [70, '*', 108, 62, 31, 11]],
  40: [[5, 'C', 3], [10, 'E', 5, 2], [15, 'G', 7, 4], [20, 'H', 14, 9, 1], [25, 'J', 25, 19, 2], [30, 'K', 36, 28, 4], [35, 'L', 47, 35, 8], [40, 'M', 57, 40, 13], [45, 'N', 68, 45, 18, 1], [50, 'O', 77, 48, 23, 2], [55, 'O', 87, 52, 26, 5], [60, 'P', 98, 57, 29, 8], [65, '*', 108, 61, 31, 12], [70, '*', 118, 66, 33, 15]],
  42: [[5, 'C', 3], [10, 'E', 6, 2], [15, 'G', 9, 5], [20, 'I', 17, 12, 1], [25, 'J', 29, 22, 3], [30, 'L', 41, 31, 6], [35, 'M', 52, 37, 11], [40, 'N', 64, 43, 16, 1], [45, '*', 75, 47, 21, 3], [50, '*', 84, 50, 24, 6], [55, '*', 96, 55, 29, 8], [60, '*', 107, 60, 30, 13]],
  45: [[5, 'C', 3], [10, 'F', 7, 3], [15, 'H', 11, 6, 1], [20, 'I', 22, 15, 3], [25, 'K', 34, 25, 5], [30, 'L', 48, 35, 9], [35, 'M', 60, 40, 15, 1], [40, 'N', 73, 46, 20, 3], [45, '*', 84, 50, 24, 6], [50, '*', 96, 54, 28, 10], [55, '*', 108, 60, 30, 14], [60, '*', 121, 65, 32, 18, 1]],
  48: [[5, 'D', 4], [10, 'F', 8, 4], [15, 'H', 13, 7, 2], [20, 'J', 27, 19, 4], [25, 'K', 41, 30, 7], [30, 'M', 55, 37, 12, 1], [35, 'N', 70, 44, 18, 3], [40, 'O', 82, 48, 23, 6], [45, '*', 95, 53, 27, 10], [50, '*', 109, 59, 30, 14, 1], [55, '*', 121, 64, 32, 18, 2], [60, '*', 135, 70, 36, 19, 5]],
  50: [[5, 'D', 5, 1], [10, 'F', 8, 4], [15, 'H', 15, 9, 2], [20, 'J', 30, 22, 4], [25, 'L', 46, 32, 8, 1], [30, 'M', 60, 39, 14, 2], [35, 'N', 75, 45, 20, 5], [40, 'O', 88, 50, 24, 9], [45, '*', 102, 55, 29, 12, 1], [50, '*', 116, 62, 30, 17, 2], [55, '*', 130, 67, 34, 19, 5]],
  52: [[5, 'D', 5, 1], [10, 'F', 10, 4, 1], [15, 'I', 18, 10, 3], [20, 'K', 34, 23, 5, 1], [25, 'L', 50, 34, 9, 2], [30, 'M', 65, 41, 15, 4], [35, 'O', 80, 47, 22, 6], [40, 'O', 94, 52, 26, 10, 1], [45, '*', 110, 59, 29, 15, 2], [50, '*', 123, 64, 32, 17, 5], [55, '*', 139, 71, 36, 19, 8]],
  55: [[5, 'D', 5, 1], [10, 'G', 11, 5, 1], [15, 'I', 22, 13, 4], [20, 'K', 39, 27, 6, 1], [25, 'M', 56, 37, 11, 3], [30, 'N', 73, 44, 18, 6], [35, 'O', 88, 50, 23, 9, 1], [40, 'P', 104, 55, 29, 12, 3], [45, '*', 120, 62, 31, 17, 5], [50, '*', 136, 69, 35, 19, 8], [55, '*', 152, 76, 37, 22, 12]],
  58: [[5, 'D', 7, 2], [10, 'G', 12, 5, 2], [15, 'J', 26, 16, 4, 1], [20, 'K', 44, 30, 7, 2], [25, 'M', 62, 40, 13, 4], [30, 'N', 81, 46, 21, 7, 1], [35, 'O', 97, 52, 26, 11, 2], [40, 'P', 115, 59, 30, 15, 5], [45, '*', 131, 66, 33, 18, 8], [50, '*', 150, 74, 37, 21, 11, 1], [55, '*', 168, 83, 39, 23, 14, 3]],
  60: [[5, 'D', 7, 2], [10, 'G', 13, 6, 2], [15, 'J', 29, 19, 4, 1], [20, 'L', 48, 32, 8, 3], [25, 'M', 66, 41, 15, 5], [30, 'O', 85, 48, 22, 8, 1], [35, 'P', 103, 54, 28, 11, 4], [40, 'P', 121, 62, 30, 17, 6], [45, '*', 139, 69, 35, 19, 9, 1], [50, '*', 158, 78, 37, 22, 13, 2], [55, '*', 178, 88, 40, 24, 15, 5]],
  62: [[5, '*', 7, 2], [10, '*', 14, 7, 2], [15, '*', 33, 21, 5, 1]],
  65: [[5, '*', 8, 3], [10, '*', 16, 8, 3], [15, '*', 37, 24, 5, 2]],
};

export const MN90_DEPTHS = Object.keys(MN90).map(Number).sort((a, b) => a - b);
/** « La plongée au-delà de 60 mètres est interdite » : 62 and 65 m only for an accidental overrun,
 *  then no dive for 12 hours. */
export const MN90_MAX_DEPTH = 60;
/** Dive types: under 15 min apart, consecutive; up to 12 h, successive; beyond, single. */
export const CONSECUTIVE_MAX = 15; // min (strictly under)
export const SUCCESSIVE_MAX = 12 * 60; // min

/** Tableau I columns: surface intervals (min). */
export const TABLE_I_INTERVALS = [15, 30, 45, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 390, 420, 450, 480, 510, 540, 570, 600, 630, 660, 690, 720];
/** Tableau I : residual nitrogen by GPS and surface interval. A row stops where the booklet leaves
 *  the cells blank. */
export const TABLE_I: Record<Exclude<Gps, '*'>, number[]> = {
  A: [0.84, 0.83, 0.83, 0.83, 0.82, 0.82, 0.82, 0.81, 0.81, 0.81, 0.81, 0.81, 0.81, 0.81],
  B: [0.88, 0.88, 0.87, 0.86, 0.85, 0.85, 0.84, 0.83, 0.83, 0.82, 0.82, 0.82, 0.81, 0.81, 0.81, 0.81, 0.81, 0.81],
  C: [0.92, 0.91, 0.90, 0.89, 0.88, 0.87, 0.85, 0.85, 0.84, 0.83, 0.83, 0.82, 0.82, 0.82, 0.81, 0.81, 0.81, 0.81, 0.81, 0.81],
  D: [0.97, 0.95, 0.94, 0.93, 0.91, 0.89, 0.88, 0.86, 0.85, 0.85, 0.84, 0.83, 0.83, 0.82, 0.82, 0.82, 0.81, 0.81, 0.81, 0.81, 0.81, 0.81],
  E: [1.00, 0.98, 0.97, 0.96, 0.93, 0.91, 0.89, 0.88, 0.87, 0.86, 0.85, 0.84, 0.83, 0.83, 0.82, 0.82, 0.82, 0.81, 0.81, 0.81, 0.81, 0.81, 0.81],
  F: [1.05, 1.03, 1.01, 0.99, 0.96, 0.94, 0.91, 0.90, 0.88, 0.87, 0.86, 0.85, 0.84, 0.83, 0.83, 0.82, 0.82, 0.82, 0.81, 0.81, 0.81, 0.81, 0.81, 0.81, 0.81],
  G: [1.08, 1.06, 1.04, 1.02, 0.98, 0.96, 0.93, 0.91, 0.89, 0.88, 0.87, 0.85, 0.85, 0.84, 0.83, 0.83, 0.82, 0.82, 0.82, 0.81, 0.81, 0.81, 0.81, 0.81, 0.81],
  H: [1.13, 1.10, 1.08, 1.05, 1.01, 0.98, 0.95, 0.93, 0.91, 0.89, 0.88, 0.86, 0.85, 0.85, 0.84, 0.83, 0.83, 0.82, 0.82, 0.82, 0.81, 0.81, 0.81, 0.81, 0.81, 0.81],
  I: [1.17, 1.14, 1.11, 1.08, 1.04, 1.00, 0.97, 0.94, 0.92, 0.90, 0.88, 0.87, 0.86, 0.85, 0.84, 0.84, 0.83, 0.83, 0.82, 0.82, 0.81, 0.81, 0.81, 0.81, 0.81, 0.81],
  J: [1.20, 1.17, 1.14, 1.11, 1.06, 1.02, 0.98, 0.96, 0.93, 0.91, 0.89, 0.88, 0.87, 0.86, 0.85, 0.84, 0.83, 0.83, 0.82, 0.82, 0.82, 0.81, 0.81, 0.81, 0.81, 0.81],
  K: [1.25, 1.21, 1.18, 1.15, 1.09, 1.04, 1.01, 0.97, 0.95, 0.92, 0.90, 0.89, 0.87, 0.86, 0.85, 0.84, 0.84, 0.83, 0.83, 0.82, 0.82, 0.82, 0.81, 0.81, 0.81, 0.81],
  L: [1.29, 1.25, 1.21, 1.17, 1.12, 1.07, 1.02, 0.99, 0.96, 0.93, 0.91, 0.89, 0.88, 0.87, 0.86, 0.85, 0.84, 0.83, 0.83, 0.82, 0.82, 0.82, 0.81, 0.81, 0.81, 0.81],
  M: [1.33, 1.29, 1.25, 1.21, 1.14, 1.09, 1.04, 1.01, 0.97, 0.94, 0.92, 0.90, 0.89, 0.87, 0.86, 0.85, 0.84, 0.84, 0.83, 0.83, 0.82, 0.82, 0.82, 0.81, 0.81, 0.81],
  N: [1.37, 1.32, 1.28, 1.24, 1.17, 1.11, 1.06, 1.02, 0.98, 0.95, 0.93, 0.91, 0.89, 0.88, 0.87, 0.85, 0.85, 0.84, 0.83, 0.83, 0.82, 0.82, 0.82, 0.81, 0.81, 0.81],
  O: [1.41, 1.36, 1.32, 1.27, 1.20, 1.13, 1.08, 1.04, 1.00, 0.97, 0.94, 0.92, 0.90, 0.88, 0.87, 0.86, 0.85, 0.84, 0.84, 0.83, 0.82, 0.82, 0.82, 0.81, 0.81, 0.81],
  P: [1.45, 1.40, 1.35, 1.30, 1.22, 1.15, 1.10, 1.05, 1.01, 0.98, 0.95, 0.93, 0.91, 0.89, 0.87, 0.86, 0.85, 0.84, 0.84, 0.83, 0.83, 0.82, 0.82, 0.82, 0.81, 0.81],
};

/** Tableau II columns: depth of the second dive (m). */
export const TABLE_II_DEPTHS = [12, 15, 18, 20, 22, 25, 28, 30, 32, 35, 38, 40, 42, 45, 48, 50, 52, 55, 58, 60];
/** Tableau II : penalty time (majoration, min) by residual nitrogen and depth of the second dive. */
export const TABLE_II: [n: number, minutes: number[]][] = [
  [0.82, [4, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]],
  [0.84, [7, 6, 5, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1]],
  [0.86, [11, 9, 7, 7, 6, 5, 5, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2]],
  [0.89, [17, 13, 11, 10, 9, 8, 7, 7, 6, 6, 5, 5, 5, 4, 4, 4, 4, 4, 3, 3]],
  [0.92, [23, 18, 15, 13, 12, 11, 10, 9, 8, 8, 7, 7, 6, 6, 5, 5, 5, 5, 5, 4]],
  [0.95, [29, 23, 19, 17, 15, 13, 12, 11, 10, 10, 9, 8, 8, 7, 7, 7, 6, 6, 6, 5]],
  [0.99, [38, 30, 24, 22, 20, 17, 15, 14, 13, 12, 11, 11, 10, 9, 9, 8, 8, 8, 7, 7]],
  [1.03, [47, 37, 30, 27, 24, 21, 19, 17, 16, 15, 14, 13, 12, 11, 11, 10, 10, 9, 9, 9]],
  [1.07, [57, 44, 36, 32, 29, 25, 22, 21, 19, 18, 16, 15, 15, 13, 13, 12, 12, 11, 10, 10]],
  [1.11, [68, 52, 42, 37, 34, 29, 26, 24, 22, 20, 19, 18, 17, 16, 15, 14, 13, 13, 12, 12]],
  [1.16, [81, 62, 50, 44, 40, 34, 30, 28, 26, 24, 22, 21, 20, 18, 17, 16, 16, 15, 14, 13]],
  [1.20, [93, 70, 56, 50, 45, 39, 34, 32, 29, 27, 24, 23, 22, 20, 19, 18, 18, 17, 16, 15]],
  [1.24, [106, 79, 63, 56, 50, 43, 38, 35, 33, 30, 27, 26, 24, 23, 21, 20, 19, 18, 17, 17]],
  [1.29, [124, 91, 72, 63, 56, 49, 43, 40, 37, 33, 30, 29, 27, 25, 24, 23, 22, 20, 19, 19]],
  [1.33, [139, 101, 79, 70, 62, 53, 47, 43, 40, 36, 33, 31, 30, 28, 26, 25, 24, 22, 21, 20]],
  [1.38, [160, 114, 89, 78, 69, 59, 52, 48, 44, 40, 37, 35, 33, 30, 28, 27, 26, 24, 23, 22]],
  [1.42, [180, 126, 97, 85, 75, 64, 56, 52, 48, 43, 39, 37, 35, 33, 30, 29, 28, 26, 25, 24]],
  [1.45, [196, 135, 104, 90, 80, 68, 59, 55, 51, 46, 42, 39, 37, 34, 32, 31, 29, 28, 26, 25]],
];

// ---------------------------------------------------------------------------------------------
// Reading the tables.

/** « Si la valeur de la durée de plongée ou celle de la profondeur ne sont pas dans la table, prendre
 *  la valeur lue immédiatement supérieure » (Généralités). Depth in metres, read to 0.1 m like a
 *  depth gauge. Null beyond 65 m. */
export function tableDepth(depth: number): number | null {
  const d = Math.round(depth * 10) / 10;
  return MN90_DEPTHS.find((x) => x >= d) ?? null;
}

/** Dive time entering the table: « toute fraction de minute commencée est considérée comme une
 *  minute entière écoulée » (Généralités). */
export function tableMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60 - 1e-6));
}

/** Line of the table for that table depth and time (min), or null beyond its last line. */
export function tableLine(depth: number, minutes: number): number | null {
  const i = (MN90[depth] ?? []).findIndex((l) => l[0] >= minutes);
  return i < 0 ? null : i;
}

/** Stops of a line, deepest first: [depth m, minutes]. */
export function lineStops(l: Mn90Line): [number, number][] {
  const s = l.slice(3) as number[];
  return s.map((m, i) => [(i + 1) * 3, m] as [number, number]).filter(([, m]) => m > 0).reverse();
}

/** Tableau I : column of the surface interval (« si la durée exacte de l'intervalle ne se trouve pas
 *  dans le tableau I, prendre la valeur immédiatement inférieure »), null under 15 min or over 12 h. */
export function intervalColumn(minutes: number): number | null {
  if (minutes < CONSECUTIVE_MAX || minutes > SUCCESSIVE_MAX) return null;
  let c = 0;
  while (c + 1 < TABLE_I_INTERVALS.length && TABLE_I_INTERVALS[c + 1] <= minutes) c++;
  return c;
}

/** Residual nitrogen (Tableau I), or null where the booklet leaves the cell blank. A blank cell is
 *  read as « no residual nitrogen to account for » (deduction: the booklet does not say it). */
export function residualNitrogen(gps: Exclude<Gps, '*'>, column: number): number | null {
  return TABLE_I[gps][column] ?? null;
}

/** Tableau II : row of the residual nitrogen (« prendre la valeur immédiatement supérieure »), column
 *  of the second dive's depth (« prendre la profondeur immédiatement supérieure » ; under 12 m, the
 *  12 m column). Null over 1,45 or 60 m. */
export function majorationCell(n: number, depth: number): { row: number; col: number; minutes: number } | null {
  const row = TABLE_II.findIndex(([v]) => v >= n - 1e-9);
  const col = TABLE_II_DEPTHS.findIndex((x) => x >= Math.round(depth * 10) / 10);
  if (row < 0 || col < 0) return null;
  return { row, col, minutes: TABLE_II[row][1][col] };
}

/** Nitrox (« Plongée au mélange enrichi ») : the table is entered with the equivalent air depth
 *  PE = (P + 10) × x / 0,79 − 10, x the nitrogen fraction. Air: the depth itself. */
export function equivalentDepth(depth: number, gas: Gas): number {
  const n2 = 1 - gas.o2 - gas.he;
  return Math.abs(n2 - 0.79) < 0.005 ? depth : Math.max(0, ((depth + 10) * n2) / 0.79 - 10);
}

// ---------------------------------------------------------------------------------------------
// The diver's dives in the tables.

/** Before a dive: what the previous one leaves (successive dive), read when it starts. */
export interface Mn90Successive {
  gps: Gps | null; // null: previous dive out of the tables
  interval: number; // min
  column: number | null; // Tableau I
  n: number | null; // residual nitrogen (null: blank cell)
}

/** One dive in the tables' sense: consecutive immersions (under 15 min apart) are merged. */
export interface Mn90Dive {
  start: number; // session clock (s), first immersion
  end: number | null; // session clock (s) of the last surfacing; null while in the water
  immersions: number;
  maxDepth: number; // m, real
  eqDepth: number; // m, depth entering the table (equivalent air depth in nitrox)
  gas: Gas; // main tank
  nitrox: boolean;
  trimix: boolean;
  /** Dive time counted so far (s), without the penalty time. */
  seconds: number;
  successive: Mn90Successive | null;
  /** Dives (in the tables' sense) started in the 24 hours before this one. */
  divesBefore24h: number;
  /** Fastest final ascent to the first stop or the surface (m/min), when it was over 17 m/min. */
  rapid: number | null;
  /** Time counting stopped on reaching the first stop (or the surface): its depth. */
  frozenAt: number | null;
}

export type Mn90Kind = 'single' | 'successive' | 'consecutive';

/** Where a dive stands in the tables. */
export interface Mn90Result {
  depth: number | null; // table depth (null: over 65 m)
  realMinutes: number; // dive time of the immersions, rounded up
  majoration: { row: number; col: number; minutes: number } | null;
  minutes: number; // time entering the table
  line: number | null; // index in MN90[depth]; null: out of the tables
  /** Why there is no line, or why the dive breaks the rules (several can apply). */
  issues: ('deep' | 'time' | 'emergencyTable' | 'noGps' | 'prevOut' | 'twoPer24h' | 'trimix' | 'maxN')[];
}

export function assessDive(d: Mn90Dive, seconds = d.seconds): Mn90Result {
  const issues: Mn90Result['issues'] = [];
  if (d.trimix) issues.push('trimix');
  const depth = tableDepth(d.eqDepth);
  const realMinutes = tableMinutes(seconds);
  let majoration: Mn90Result['majoration'] = null;
  let extra = 0;
  const s = d.successive;
  if (s) {
    if (s.gps === null) issues.push('prevOut');
    else if (s.gps === '*') issues.push('noGps');
    else if (s.n !== null) {
      majoration = majorationCell(s.n, d.eqDepth);
      if (majoration) extra = majoration.minutes;
      else issues.push(s.n > 1.45 ? 'maxN' : 'deep');
    }
  }
  if (d.divesBefore24h >= 2) issues.push('twoPer24h');
  const minutes = realMinutes + extra;
  let line: number | null = null;
  if (depth === null) issues.push('deep');
  else {
    if (depth > MN90_MAX_DEPTH) issues.push('emergencyTable');
    line = tableLine(depth, minutes);
    if (line === null) issues.push('time');
  }
  // A successive dive without penalty time (previous dive out of the tables, or no GPS) has no line.
  if (issues.includes('prevOut') || issues.includes('noGps')) line = null;
  return { depth, realMinutes, majoration, minutes, line, issues: [...new Set(issues)] };
}

/** The line reached, or null. */
export function resultLine(r: Mn90Result): Mn90Line | null {
  return r.depth !== null && r.line !== null ? MN90[r.depth][r.line] : null;
}

/** Ascent speed limits (Généralités, Remontée rapide, Remontée lente): 15 to 17 m/min to the first stop. */
const ASCENT_MIN = 15; // m/min
const ASCENT_MAX = 17; // m/min
/** A hold this long at the same depth during an ascent ends it (stop not in the table, hesitation…). */
const HOLD_S = 30;
/** Depth window over the first stop where the diver is taken as on it (m). */
const STOP_WINDOW = 0.5;

/**
 * Places the diver's dives in the MN90 tables, from the session (read only). The dive time is
 * « depuis l'instant où le plongeur quitte la surface jusqu'à l'instant où il quitte le fond pour
 * remonter » at 15 to 17 m/min (Généralités); an ascent slower than 15 m/min adds its time up to the
 * first stop (Remontée lente). So the time keeps counting until the diver reaches the first stop of
 * the line (the surface without stops) and, when the ascent to it was at 15 m/min or faster, the
 * time of that ascent is taken back. Going down again past the stop resumes the count.
 */
export class Mn90Tracker {
  dives: Mn90Dive[] = [];
  private wasInDive = false;
  private lastClock = 0;
  /** Final ascent in progress: dive time (s) and depth when it started. */
  private rise: { seconds: number; depth: number } | null = null;
  private holdSince: number | null = null;
  private holdDepth = 0;
  /** Deepest point since the count (re)started: the first stop is only "reached" coming from below. */
  private deepestSinceResume = 0;

  reset(): void {
    this.dives = [];
    this.wasInDive = false;
    this.rise = null;
    this.holdSince = null;
    this.deepestSinceResume = 0;
  }

  /** The dive in progress, or the last one. */
  get last(): Mn90Dive | null {
    return this.dives[this.dives.length - 1] ?? null;
  }

  get inDive(): boolean {
    return this.wasInDive;
  }

  /** Type of a dive starting `atClock` (s) after the last one. */
  kindAt(atClock: number): { kind: Mn90Kind; interval: number | null } {
    const prev = this.last;
    if (!prev || prev.end === null) return { kind: 'single', interval: null };
    const interval = (atClock - prev.end) / 60;
    if (interval < CONSECUTIVE_MAX) return { kind: 'consecutive', interval };
    if (interval <= SUCCESSIVE_MAX) return { kind: 'successive', interval };
    return { kind: 'single', interval };
  }

  /** What the last dive leaves if a dive started `atClock` (successive dive), else null. */
  successiveAt(atClock: number): Mn90Successive | null {
    const prev = this.last;
    const { kind, interval } = this.kindAt(atClock);
    if (!prev || kind !== 'successive' || interval === null) return null;
    const line = resultLine(assessDive(prev));
    const gps = line ? line[1] : null;
    const column = intervalColumn(interval);
    const n = gps && gps !== '*' && column !== null ? residualNitrogen(gps, column) : null;
    return { gps, interval, column, n };
  }

  /** Result of the dive in progress if the diver started the ascent now (time not frozen yet). */
  current(): Mn90Result | null {
    const d = this.last;
    if (!d) return null;
    return assessDive(d, this.provisionalSeconds(d));
  }

  /** While ascending at 15 m/min or faster, the dive time is the one when the ascent started. */
  private provisionalSeconds(d: Mn90Dive): number {
    if (d.frozenAt !== null || !this.rise || !this.wasInDive) return d.seconds;
    const climbed = this.rise.depth - this.depthNow;
    const min = (d.seconds - this.rise.seconds) / 60;
    return min > 0 && climbed / min >= ASCENT_MIN ? this.rise.seconds : d.seconds;
  }

  private depthNow = 0;

  tick(s: DiveSession, dt: number): void {
    if (s.clock < this.lastClock) this.reset(); // the session was reset
    this.lastClock = s.clock;
    this.depthNow = s.depth;
    if (s.inDive && !this.wasInDive) this.startImmersion(s);
    if (!s.inDive && this.wasInDive) this.endImmersion(s);
    this.wasInDive = s.inDive;
    if (!s.inDive) return;
    const d = this.last!;
    const eq = equivalentDepth(s.depth, d.gas);
    d.maxDepth = Math.max(d.maxDepth, s.depth);
    d.eqDepth = Math.max(d.eqDepth, eq);
    if (d.frozenAt !== null) {
      // Back down past the stop: the dive goes on.
      if (s.depth > d.frozenAt + 3 * STOP_WINDOW) this.resume(d, s.depth);
      return;
    }
    d.seconds += dt;
    this.deepestSinceResume = Math.max(this.deepestSinceResume, s.depth);
    const rate = s.ascentRate;
    if (rate < -1) {
      this.rise = null;
      this.holdSince = null;
    } else if (rate > 1) {
      this.rise ??= { seconds: d.seconds - dt, depth: s.depth + (rate * dt) / 60 };
      this.holdSince = null;
    } else if (this.rise) {
      if (this.holdSince === null || Math.abs(s.depth - this.holdDepth) > 0.3) {
        this.holdSince = s.clock;
        this.holdDepth = s.depth;
      } else if (s.clock - this.holdSince >= HOLD_S) {
        this.rise = null;
        this.holdSince = null;
      }
    }
    // First stop of the line reached so far (the surface without stops).
    const line = resultLine(assessDive(d));
    const stop = line ? (lineStops(line)[0]?.[0] ?? 0) : 0;
    const arrived = stop > 0 ? s.depth <= stop + STOP_WINDOW : s.depth < DIVE_START_DEPTH;
    if (arrived && this.deepestSinceResume > Math.max(stop, DIVE_START_DEPTH) + 1) {
      if (this.rise) {
        const min = (d.seconds - this.rise.seconds) / 60;
        const speed = min > 0 ? (this.rise.depth - s.depth) / min : Infinity;
        if (speed >= ASCENT_MIN) d.seconds = this.rise.seconds;
        if (speed > ASCENT_MAX) d.rapid = Math.max(d.rapid ?? 0, speed);
      }
      d.frozenAt = stop;
      this.rise = null;
      this.holdSince = null;
    }
  }

  private resume(d: Mn90Dive, depth: number): void {
    d.frozenAt = null;
    this.rise = null;
    this.holdSince = null;
    this.deepestSinceResume = depth;
  }

  private startImmersion(s: DiveSession): void {
    const { kind } = this.kindAt(s.clock);
    const prev = this.last;
    if (kind === 'consecutive' && prev) {
      // « On entre dans la table avec comme durée de plongée la somme des durées des deux plongées,
      // et comme profondeur la profondeur maximale atteinte au cours des deux plongées. »
      prev.end = null;
      prev.immersions += 1;
      this.resume(prev, s.depth);
      return;
    }
    const n2 = 1 - s.backGas.o2 - s.backGas.he;
    this.dives.push({
      start: s.clock,
      end: null,
      immersions: 1,
      maxDepth: s.depth,
      eqDepth: 0,
      gas: { ...s.backGas },
      nitrox: s.backGas.he === 0 && n2 < 0.785,
      trimix: s.backGas.he > 0,
      seconds: 0,
      successive: kind === 'successive' ? this.successiveAt(s.clock) : null,
      divesBefore24h: this.dives.filter((x) => s.clock - x.start < 24 * 3600).length,
      rapid: null,
      frozenAt: null,
    });
    this.rise = null;
    this.holdSince = null;
    this.deepestSinceResume = s.depth;
  }

  private endImmersion(s: DiveSession): void {
    const d = this.last;
    if (!d) return;
    // The session closes a dive after some time at the surface; it ended on surfacing.
    d.end = s.lastDiveEnd ?? s.clock;
    // Surfaced without reaching a stop (missed stops): the count stops there all the same.
    if (d.frozenAt === null) d.frozenAt = 0;
  }
}
