import { describe, expect, it } from "vitest";
import { dispatch, type DispatchTrip } from "@/lib/dispatch";
import {
  NOW,
  dispatchOptions,
  lineMatrix,
  permutations,
  randomEuclideanMatrix,
  seededRandom,
} from "./helpers";

const flatten = (trips: DispatchTrip[][]) => trips.flat();
const deliveredOrders = (trips: DispatchTrip[][]) =>
  flatten(trips)
    .flatMap((t) => t.orderIndices)
    .sort((a, b) => a - b);

/**
 * Independent brute-force oracle: enumerate every set partition of the orders
 * into trips of size ≤ maxTripSize, score each trip with its best visit order,
 * and return the minimum total objective (driver seconds + in-bag seconds).
 */
function bruteForceOptimum(
  n: number,
  travel: number[][],
  serviceSeconds: number,
  freshnessWeight: number,
  maxTripSize: number,
): number {
  const tripCost = (stops: number[]) =>
    Math.min(
      ...permutations(stops).map((perm) => {
        let clock = 0;
        let inBag = 0;
        let at = 0;
        for (const o of perm) {
          clock += travel[at][o + 1];
          inBag += clock;
          clock += serviceSeconds;
          at = o + 1;
        }
        clock += travel[at][0];
        return clock + freshnessWeight * inBag;
      }),
    );

  let best = Infinity;
  const blocks: number[][] = [];
  const recurse = (i: number, acc: number) => {
    if (acc >= best) return;
    if (i === n) {
      best = acc;
      return;
    }
    for (const b of blocks) {
      if (b.length >= maxTripSize) continue;
      const before = tripCost(b);
      b.push(i);
      recurse(i + 1, acc - before + tripCost(b));
      b.pop();
    }
    blocks.push([i]);
    recurse(i + 1, acc + tripCost([i]));
    blocks.pop();
  };
  recurse(0, 0);
  return best;
}

describe("dispatch — input validation", () => {
  it("rejects timing arrays that don't match the order count", () => {
    const opts = dispatchOptions(1);
    expect(() => dispatch(2, lineMatrix([100, 200]), lineMatrix([100, 200]), 1, opts)).toThrow(
      /orderTiming length/,
    );
  });
});

describe("dispatch — one order per driver (drivers ≥ orders)", () => {
  const travel = lineMatrix([300, 500]);
  const result = dispatch(2, travel, travel, 3, dispatchOptions(2));

  it("uses the one-per-driver strategy and leaves surplus drivers idle", () => {
    expect(result.strategy).toBe("one-per-driver");
    expect(result.driverTrips).toHaveLength(3);
    expect(result.driverTrips[0]).toHaveLength(1);
    expect(result.driverTrips[1]).toHaveLength(1);
    expect(result.driverTrips[2]).toHaveLength(0);
  });

  it("computes round-trip duration as out + service + back", () => {
    const [a] = result.driverTrips[0];
    expect(a.orderIndices).toEqual([0]);
    expect(a.durationSeconds).toBe(300 + 120 + 300);
    expect(a.maxInBagSeconds).toBe(300);
    expect(a.cumulativeBagAtStop).toEqual([300]);
    expect(result.driverTrips[1][0].durationSeconds).toBe(500 + 120 + 500);
  });
});

describe("dispatch — multi-trip batching", () => {
  it("batches two neighbouring addresses into one trip, nearest first", () => {
    // Order 0 is 11 min out, order 1 is 10 min out on the same road.
    const travel = lineMatrix([660, 600]);
    const r = dispatch(2, travel, travel, 1, dispatchOptions(2));

    expect(r.strategy).toBe("multi-trip");
    const trips = flatten(r.driverTrips);
    expect(trips).toHaveLength(1);
    expect(trips[0].orderIndices).toEqual([1, 0]);
    // 600 drive + 120 service + 60 drive → 2nd pizza has been in the bag 780 s.
    expect(trips[0].cumulativeBagAtStop).toEqual([600, 780]);
    expect(trips[0].maxInBagSeconds).toBe(780);
    expect(trips[0].durationSeconds).toBe(600 + 120 + 60 + 120 + 660);
  });

  it("sends orders in opposite directions as separate trips (freshness beats batching)", () => {
    const travel = lineMatrix([600, -600]);
    const r = dispatch(2, travel, travel, 1, dispatchOptions(2, { maxInBagSeconds: Infinity }));
    const trips = flatten(r.driverTrips);
    expect(trips).toHaveLength(2);
    expect(trips.every((t) => t.orderIndices.length === 1)).toBe(true);
  });

  it("never serves a pizza colder than maxInBagSeconds on a multi-stop trip", () => {
    // Batching would be cheaper, but the 2nd stop would be 780 s in the bag.
    const travel = lineMatrix([660, 600]);
    const r = dispatch(2, travel, travel, 1, dispatchOptions(2, { maxInBagSeconds: 700 }));
    const trips = flatten(r.driverTrips);
    expect(trips).toHaveLength(2);
  });

  it("respects maxTripSize", () => {
    // Five houses on the same street — would all fit in one bag if allowed.
    const travel = lineMatrix([300, 310, 320, 330, 340]);
    const r = dispatch(5, travel, travel, 1, dispatchOptions(5, { maxTripSize: 2 }));
    for (const t of flatten(r.driverTrips)) expect(t.orderIndices.length).toBeLessThanOrEqual(2);
    expect(deliveredOrders(r.driverTrips)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("dispatch — soft time windows", () => {
  const travel = lineMatrix([300, 360]);

  it("visits the closer stop first when nobody is in a hurry", () => {
    const r = dispatch(2, travel, travel, 1, dispatchOptions(2, { timeWindowPenaltyWeight: 2 }));
    expect(flatten(r.driverTrips)[0].orderIndices).toEqual([0, 1]);
  });

  it("re-orders the trip so an order about to breach its promise goes first", () => {
    const timing = [
      { earliestArrivalEpochMs: 0, latestArrivalEpochMs: Number.MAX_SAFE_INTEGER },
      { earliestArrivalEpochMs: 0, latestArrivalEpochMs: NOW + 300_000 }, // due in 5 min
    ];
    const r = dispatch(
      2,
      travel,
      travel,
      1,
      dispatchOptions(2, { orderTiming: timing, timeWindowPenaltyWeight: 2 }),
    );
    expect(flatten(r.driverTrips)[0].orderIndices).toEqual([1, 0]);
  });

  it("aims a scheduled order at its promised time rather than as early as possible", () => {
    // Order 0 was promised for 8 min from now (window opens at 7 min) —
    // arriving at 5 min would be too early.
    const timing = [
      {
        earliestArrivalEpochMs: NOW + 420_000,
        latestArrivalEpochMs: Number.MAX_SAFE_INTEGER,
        preferredArrivalEpochMs: NOW + 480_000,
      },
      { earliestArrivalEpochMs: 0, latestArrivalEpochMs: Number.MAX_SAFE_INTEGER },
    ];
    const r = dispatch(
      2,
      travel,
      travel,
      1,
      dispatchOptions(2, { orderTiming: timing, schedulePreferenceWeight: 5 }),
    );
    const [trip] = flatten(r.driverTrips);
    expect(trip.orderIndices).toEqual([1, 0]);
    expect(trip.cumulativeBagAtStop[1]).toBe(540); // 9 min — 1 min off target vs 3 min
  });

  it("still routes orders whose deadline has already passed (windows are soft)", () => {
    const timing = [
      { earliestArrivalEpochMs: 0, latestArrivalEpochMs: NOW - 3_600_000 },
      { earliestArrivalEpochMs: 0, latestArrivalEpochMs: NOW - 3_600_000 },
    ];
    const r = dispatch(2, travel, travel, 1, dispatchOptions(2, { orderTiming: timing }));
    expect(deliveredOrders(r.driverTrips)).toEqual([0, 1]);
  });
});

describe("dispatch — large trips (nearest-neighbour + 2-opt path)", () => {
  // Beyond 4 stops, exhaustive permutation search is replaced by a heuristic.
  // With freshnessWeight = 0 and the triangle inequality, one big trip is optimal.
  const bigTrip = (n: number) =>
    dispatchOptions(n, { maxTripSize: n, freshnessWeight: 0, maxInBagSeconds: Infinity });

  it("sweeps a street in order when a whole bag fits in one trip", () => {
    const travel = lineMatrix([340, 300, 320, 310, 330, 350]);
    const r = dispatch(6, travel, travel, 1, bigTrip(6));
    const trips = flatten(r.driverTrips);
    expect(trips).toHaveLength(1);
    expect(trips[0].orderIndices).toEqual([1, 3, 2, 4, 0, 5]);
    expect(trips[0].durationSeconds).toBe(350 + 6 * 120 + 350);
  });

  it("produces valid visit orders on random large trips", () => {
    const rand = seededRandom(5);
    for (let trial = 0; trial < 30; trial++) {
      const n = 5 + Math.floor(rand() * 4); // 5..8 stops
      const travel = randomEuclideanMatrix(n, rand);
      const r = dispatch(n, travel, travel, 1, bigTrip(n));
      expect(deliveredOrders(r.driverTrips)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });
});

describe("dispatch — driver load balancing (LPT)", () => {
  it("spreads single-stop trips so drivers finish at about the same time", () => {
    // maxInBagSeconds = 0 forbids batching → four solo trips of 320/520/720/920 s.
    const travel = lineMatrix([100, 200, 300, 400]);
    const r = dispatch(4, travel, travel, 2, dispatchOptions(4, { maxInBagSeconds: 0 }));
    const loads = r.driverTrips.map((d) => d.reduce((s, t) => s + t.durationSeconds, 0));
    expect(loads).toEqual([1240, 1240]);
  });

  it("orders each driver's trips longest-first", () => {
    const travel = lineMatrix([100, 200, 300, 400, 500]);
    const r = dispatch(5, travel, travel, 2, dispatchOptions(5, { maxInBagSeconds: 0 }));
    for (const trips of r.driverTrips) {
      const d = trips.map((t) => t.durationSeconds);
      expect(d).toEqual(d.slice().sort((a, b) => b - a));
    }
  });
});

describe("dispatch — property tests on random instances", () => {
  it("finds the exact optimal set partition (matches brute force)", () => {
    const rand = seededRandom(2026);
    for (let trial = 0; trial < 60; trial++) {
      const n = 2 + Math.floor(rand() * 5); // 2..6 orders
      const travel = randomEuclideanMatrix(n, rand);
      const opts = dispatchOptions(n, { maxInBagSeconds: Infinity });
      const r = dispatch(n, travel, travel, 1, opts);

      const achieved = flatten(r.driverTrips).reduce(
        (s, t) => s + t.durationSeconds + opts.freshnessWeight * t.totalInBagSeconds,
        0,
      );
      const optimum = bruteForceOptimum(
        n,
        travel,
        opts.serviceSeconds,
        opts.freshnessWeight,
        opts.maxTripSize,
      );
      expect(achieved).toBeCloseTo(optimum, 6);
    }
  });

  it("always delivers every order exactly once and honours all constraints", () => {
    const rand = seededRandom(99);
    for (let trial = 0; trial < 150; trial++) {
      const n = 1 + Math.floor(rand() * 10); // 1..10 orders
      const drivers = 1 + Math.floor(rand() * 4);
      const travel = randomEuclideanMatrix(n, rand, 1500);
      const opts = dispatchOptions(n);
      const r = dispatch(n, travel, travel, drivers, opts);

      expect(r.driverTrips).toHaveLength(drivers);
      expect(deliveredOrders(r.driverTrips)).toEqual(Array.from({ length: n }, (_, i) => i));

      for (const t of flatten(r.driverTrips)) {
        expect(t.orderIndices.length).toBeLessThanOrEqual(opts.maxTripSize);
        if (t.orderIndices.length > 1) {
          expect(t.maxInBagSeconds).toBeLessThanOrEqual(opts.maxInBagSeconds);
        }
        // In-bag time only grows along a trip; the last stop is the coldest.
        expect(t.cumulativeBagAtStop.at(-1)).toBe(t.maxInBagSeconds);
        expect(t.totalInBagSeconds).toBeCloseTo(
          t.cumulativeBagAtStop.reduce((a, b) => a + b, 0),
          6,
        );
      }
    }
  });
});
