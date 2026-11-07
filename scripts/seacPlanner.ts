// NDL read on the planner of a real SEAC Screen (issue #53, November 2026), used by scripts/dsl.ts.
// SET > PLAN (§Planner: "NDL only", "descent performed at 18 meters/minute", depths up to 45 m), SCUBA
// mode, salt water, no dive for a long time (fresh tissues). For each depth (m): NDL (min) for the
// protection levels 0 to 5 (nitrox 30 %, PPO2 1.60: levels 0 to 2 only). Firmware not given.
export interface PlannerReadings { o2: number; levels: number[]; rows: [number, number[]][] }

export const SEAC_SCREEN_PLANNER: PlannerReadings[] = [
  { o2: 0.21, levels: [0, 1, 2, 3, 4, 5], rows: [
    [18, [43, 38, 33, 28, 25, 20]], [21, [28, 25, 21, 18, 16, 14]], [24, [19, 17, 15, 13, 12, 10]],
    [27, [14, 13, 11, 10, 8, 7]], [30, [11, 10, 9, 7, 6, 5]], [33, [9, 8, 7, 6, 5, 4]],
    [36, [7, 6, 5, 5, 4, 3]], [39, [6, 5, 4, 4, 3, 3]], [42, [5, 4, 4, 3, 3, 2]], [45, [4, 3, 3, 3, 2, 2]],
  ] },
  { o2: 0.30, levels: [0, 1, 2], rows: [
    [18, [71, 63, 57]], [21, [46, 41, 36]], [24, [31, 27, 24]], [27, [23, 19, 17]], [30, [16, 14, 13]],
    [33, [13, 12, 10]], [36, [11, 10, 8]], [39, [9, 7, 6]], [42, [7, 6, 5]], [45, [6, 5, 4]],
  ] },
];
