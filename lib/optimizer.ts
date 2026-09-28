import type { LatLng } from "./types";

/**
 * Haversine distance (meters) — used as a cheap proxy when we don't have
 * a Distance Matrix value for a given pair (and as the metric for k-means).
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Balanced k-means style clustering for geo coordinates. We use a deterministic
 * "farthest-first" seed so results are stable across requests, then iteratively
 * reassign points to nearest centroids. After convergence we redistribute
 * outliers so cluster sizes are roughly balanced — important because we want
 * each driver to actually have stops (not one driver with all orders and the
 * rest idle).
 */
export function clusterPoints(points: LatLng[], k: number): number[] {
  const n = points.length;
  if (k <= 1 || n <= k) {
    return points.map((_, i) => (n <= k ? i : 0));
  }

  // Farthest-first seeding for deterministic centroids.
  const seedIdx: number[] = [0];
  while (seedIdx.length < k) {
    let bestIdx = -1;
    let bestDist = -1;
    for (let i = 0; i < n; i++) {
      if (seedIdx.includes(i)) continue;
      let minToSeed = Infinity;
      for (const s of seedIdx) {
        const d = haversineMeters(points[i], points[s]);
        if (d < minToSeed) minToSeed = d;
      }
      if (minToSeed > bestDist) {
        bestDist = minToSeed;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    seedIdx.push(bestIdx);
  }

  let centroids: LatLng[] = seedIdx.map((i) => ({ ...points[i] }));
  let assignments = new Array(n).fill(0);

  for (let iter = 0; iter < 40; iter++) {
    let changed = false;

    // Assign each point to nearest centroid.
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = haversineMeters(points[i], centroids[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
    }

    // Recompute centroids (mean of assigned points). Empty clusters keep prev.
    const sums: { lat: number; lng: number; n: number }[] = Array.from(
      { length: k },
      () => ({ lat: 0, lng: 0, n: 0 }),
    );
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      sums[c].lat += points[i].lat;
      sums[c].lng += points[i].lng;
      sums[c].n += 1;
    }
    centroids = centroids.map((prev, c) =>
      sums[c].n === 0
        ? prev
        : { lat: sums[c].lat / sums[c].n, lng: sums[c].lng / sums[c].n },
    );

    if (!changed) break;
  }

  // Balance: ensure no cluster is empty. If a cluster is empty, steal the
  // farthest point from the largest cluster's centroid.
  const counts = new Array(k).fill(0);
  for (const a of assignments) counts[a]++;

  for (let c = 0; c < k; c++) {
    if (counts[c] > 0) continue;
    let donor = 0;
    for (let j = 1; j < k; j++) if (counts[j] > counts[donor]) donor = j;
    let stealIdx = -1;
    let stealDist = -1;
    for (let i = 0; i < n; i++) {
      if (assignments[i] !== donor) continue;
      const d = haversineMeters(points[i], centroids[donor]);
      if (d > stealDist) {
        stealDist = d;
        stealIdx = i;
      }
    }
    if (stealIdx !== -1) {
      assignments[stealIdx] = c;
      counts[donor]--;
      counts[c]++;
      centroids[c] = { ...points[stealIdx] };
    }
  }

  return assignments;
}

/**
 * Solve TSP for a single cluster, starting (but NOT ending) at the depot.
 *
 * Strategy:
 *   1. Nearest-neighbor heuristic to build an initial tour.
 *   2. 2-opt local search to remove crossings.
 *
 * `cost(i, j)` returns the cost of going from node i to node j, where index 0
 * is the depot and 1..n are the orders. The depot is fixed at position 0.
 *
 * Returns the visit order of *order* indices (1..n) as 0-based indices into
 * the original orders array (so the caller can map them back).
 *
 * @param orderCount number of orders in the cluster
 * @param cost       cost matrix indexed [from][to], size (orderCount + 1)^2
 *                   index 0 = depot, 1..orderCount = orders
 */
export function solveTSP(
  orderCount: number,
  cost: number[][],
): number[] {
  if (orderCount === 0) return [];
  if (orderCount === 1) return [0];

  const N = orderCount + 1; // including depot

  // 1) Nearest neighbor starting from depot (node 0).
  const visited = new Array(N).fill(false);
  visited[0] = true;
  let tour: number[] = [0];
  let current = 0;
  for (let step = 0; step < orderCount; step++) {
    let best = -1;
    let bestC = Infinity;
    for (let j = 1; j < N; j++) {
      if (visited[j]) continue;
      const c = cost[current][j];
      if (c < bestC) {
        bestC = c;
        best = j;
      }
    }
    if (best === -1) break;
    tour.push(best);
    visited[best] = true;
    current = best;
  }

  // 2) 2-opt — keep node 0 (depot) fixed at index 0.
  const tourCost = (t: number[]): number => {
    let s = 0;
    for (let i = 0; i < t.length - 1; i++) s += cost[t[i]][t[i + 1]];
    return s;
  };

  let improved = true;
  let bestCost = tourCost(tour);
  let safety = 0;
  while (improved && safety++ < 50) {
    improved = false;
    for (let i = 1; i < tour.length - 1; i++) {
      for (let j = i + 1; j < tour.length; j++) {
        const newTour = [
          ...tour.slice(0, i),
          ...tour.slice(i, j + 1).reverse(),
          ...tour.slice(j + 1),
        ];
        const newCost = tourCost(newTour);
        if (newCost + 1e-9 < bestCost) {
          tour = newTour;
          bestCost = newCost;
          improved = true;
        }
      }
    }
  }

  // Strip the depot (index 0) from the front; convert remaining 1..N to
  // 0-based order indices.
  return tour.slice(1).map((v) => v - 1);
}
