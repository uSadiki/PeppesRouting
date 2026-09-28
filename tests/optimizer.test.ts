import { describe, expect, it } from "vitest";
import { clusterPoints, haversineMeters, solveTSP } from "@/lib/optimizer";
import type { LatLng } from "@/lib/types";
import {
  lineMatrix,
  pathCost,
  permutations,
  randomEuclideanMatrix,
  seededRandom,
} from "./helpers";

const OSLO: LatLng = { lat: 59.9139, lng: 10.7522 };
const BERGEN: LatLng = { lat: 60.3913, lng: 5.3221 };

describe("haversineMeters", () => {
  it("is zero for identical points", () => {
    expect(haversineMeters(OSLO, OSLO)).toBe(0);
  });

  it("matches the known great-circle length of 1° longitude at the equator", () => {
    // 2πR / 360 with R = 6 371 km ≈ 111 195 m
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(
      111_195,
      -1,
    );
  });

  it("gives a realistic Oslo → Bergen distance (~305 km)", () => {
    const d = haversineMeters(OSLO, BERGEN);
    expect(d).toBeGreaterThan(300_000);
    expect(d).toBeLessThan(310_000);
  });

  it("is symmetric", () => {
    expect(haversineMeters(OSLO, BERGEN)).toBeCloseTo(haversineMeters(BERGEN, OSLO), 6);
  });
});

describe("clusterPoints", () => {
  // Two tight neighbourhoods ~10 km apart around Oslo.
  const west: LatLng[] = [
    { lat: 59.93, lng: 10.6 },
    { lat: 59.931, lng: 10.602 },
    { lat: 59.929, lng: 10.599 },
  ];
  const east: LatLng[] = [
    { lat: 59.92, lng: 10.82 },
    { lat: 59.921, lng: 10.821 },
    { lat: 59.919, lng: 10.818 },
  ];

  it("gives every point its own cluster when k ≥ n", () => {
    expect(clusterPoints(west, 3)).toEqual([0, 1, 2]);
    expect(clusterPoints(west, 10)).toEqual([0, 1, 2]);
  });

  it("puts everything in one cluster when k ≤ 1", () => {
    expect(clusterPoints([...west, ...east], 1)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("separates two geographically distinct neighbourhoods", () => {
    const a = clusterPoints([...west, ...east], 2);
    expect(new Set(a.slice(0, 3)).size).toBe(1);
    expect(new Set(a.slice(3)).size).toBe(1);
    expect(a[0]).not.toBe(a[3]);
  });

  it("is deterministic across calls", () => {
    const pts = [...east, ...west, { lat: 59.95, lng: 10.7 }];
    expect(clusterPoints(pts, 3)).toEqual(clusterPoints(pts, 3));
  });

  it("never leaves a driver with an empty cluster, even for duplicate points", () => {
    const same = Array.from({ length: 5 }, () => ({ lat: 59.9, lng: 10.7 }));
    const a = clusterPoints(same, 3);
    for (let c = 0; c < 3; c++) expect(a).toContain(c);
  });
});

describe("solveTSP", () => {
  it("handles trivial inputs", () => {
    expect(solveTSP(0, [[0]])).toEqual([]);
    expect(solveTSP(1, lineMatrix([500]))).toEqual([0]);
  });

  it("visits stops on a straight road in order of distance from the depot", () => {
    // Orders at 5, 1 and 3 km along one road → visit 1, 3, 5.
    expect(solveTSP(3, lineMatrix([5, 1, 3]))).toEqual([1, 2, 0]);
  });

  it("untangles a route that nearest-neighbour gets wrong", () => {
    // Nearest-neighbour greedily goes to +1 first, then has to backtrack past
    // the depot to -2 and out again to +10. Visiting -2 first is cheaper.
    const cost = lineMatrix([1, -2, 10]);
    const nn = [0, 1, 2]; // greedy order
    const tour = solveTSP(3, cost);
    expect(pathCost(cost, tour)).toBeLessThan(pathCost(cost, nn));
    expect(tour).toEqual([1, 0, 2]);
  });

  it("always returns a permutation of all stops and is never worse than nearest-neighbour", () => {
    const rand = seededRandom(42);
    for (let trial = 0; trial < 200; trial++) {
      const n = 2 + Math.floor(rand() * 9); // 2..10 stops
      const cost = randomEuclideanMatrix(n, rand);
      const tour = solveTSP(n, cost);

      expect(tour.slice().sort((a, b) => a - b)).toEqual(
        Array.from({ length: n }, (_, i) => i),
      );

      // Reference nearest-neighbour tour.
      const left = new Set(Array.from({ length: n }, (_, i) => i));
      const nn: number[] = [];
      let at = 0;
      while (left.size) {
        const next = [...left].reduce((b, i) => (cost[at][i + 1] < cost[at][b + 1] ? i : b));
        nn.push(next);
        left.delete(next);
        at = next + 1;
      }
      expect(pathCost(cost, tour)).toBeLessThanOrEqual(pathCost(cost, nn) + 1e-9);
    }
  });

  it("stays close to the brute-force optimum on random instances", () => {
    const rand = seededRandom(7);
    let worst = 1;
    let optimalHits = 0;
    const trials = 300;
    for (let trial = 0; trial < trials; trial++) {
      const n = 2 + Math.floor(rand() * 6); // 2..7 stops (≤ 5040 perms)
      const cost = randomEuclideanMatrix(n, rand);
      const heuristic = pathCost(cost, solveTSP(n, cost));
      const optimum = Math.min(
        ...permutations(Array.from({ length: n }, (_, i) => i)).map((p) => pathCost(cost, p)),
      );
      const ratio = heuristic / optimum;
      worst = Math.max(worst, ratio);
      if (ratio < 1 + 1e-9) optimalHits++;
    }
    // Observed with this seed: optimal on 271/300, worst ratio ≈ 1.167.
    expect(optimalHits / trials).toBeGreaterThanOrEqual(0.85);
    expect(worst).toBeLessThan(1.25);
  });
});
