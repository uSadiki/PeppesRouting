import type { DispatchOptions, DispatchOrderTiming } from "@/lib/dispatch";

/** Deterministic PRNG (mulberry32) so "random" property tests are reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Travel matrix for points on a 1-D road. Index 0 is the depot at position 0;
 * `positions[i]` is order i's offset in seconds of driving. Travel time between
 * two nodes is simply the distance between their positions — easy to reason
 * about by hand in assertions.
 */
export function lineMatrix(positions: number[]): number[][] {
  const all = [0, ...positions];
  return all.map((a) => all.map((b) => Math.abs(a - b)));
}

/** Random 2-D Euclidean instance: depot + n orders in a `size`×`size` square. */
export function randomEuclideanMatrix(
  n: number,
  rand: () => number,
  size = 1200,
): number[][] {
  const pts = Array.from({ length: n + 1 }, () => [rand() * size, rand() * size]);
  return pts.map(([ax, ay]) =>
    pts.map(([bx, by]) => Math.hypot(ax - bx, ay - by)),
  );
}

/** ASAP timing with no effective deadline — isolates travel/freshness behaviour. */
export function relaxedTiming(n: number): DispatchOrderTiming[] {
  return Array.from({ length: n }, () => ({
    earliestArrivalEpochMs: 0,
    latestArrivalEpochMs: Number.MAX_SAFE_INTEGER,
  }));
}

export const NOW = Date.UTC(2026, 0, 15, 17, 0, 0);

/** Production-like dispatch options (mirrors app/api/optimize/route.ts). */
export function dispatchOptions(
  n: number,
  overrides: Partial<DispatchOptions> = {},
): DispatchOptions {
  return {
    serviceSeconds: 120,
    freshnessWeight: 1,
    schedulePreferenceWeight: 0.03,
    timeWindowPenaltyWeight: 1,
    maxTripSize: 3,
    maxInBagSeconds: 20 * 60,
    nowEpochMs: NOW,
    orderTiming: relaxedTiming(n),
    ...overrides,
  };
}

/** Total cost of an open path depot(0) → stops (1-based matrix indices). */
export function pathCost(cost: number[][], orderIndices: number[]): number {
  let prev = 0;
  let sum = 0;
  for (const i of orderIndices) {
    sum += cost[prev][i + 1];
    prev = i + 1;
  }
  return sum;
}

export function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr.slice()];
  return arr.flatMap((x, i) =>
    permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]),
  );
}
