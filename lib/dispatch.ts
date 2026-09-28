/**
 * Pizza-aware dispatch optimizer with soft ASAP / scheduled time preferences.
 *
 * Model:
 *   - Each trip is depot → 1..K stops → depot.
 *   - Trip cost = duration + Wf * Σ(in-bag) + Ws * schedule skew + Ww * window violations.
 *   - Multi-stop trips are rejected only if any pizza would exceed `maxInBagSeconds`.
 *   - Time windows (ASAP deadline, scheduled ±window) are **soft**: violations add
 *     penalty but never drop a candidate — every order always gets a route.
 */

export interface DispatchTrip {
  /** order indices (0-based into the input orders array) in the visit order */
  orderIndices: number[];
  /** Round-trip seconds from leaving depot until return (travel, service, no artificial depot hold). */
  durationSeconds: number;
  distanceMeters: number;
  /** longest in-bag time across pizzas in this trip (the "coldest pizza") */
  maxInBagSeconds: number;
  /** sum of in-bag times across pizzas in this trip (used in objective) */
  totalInBagSeconds: number;
  /** in-bag seconds at each delivery, same order as `orderIndices` */
  cumulativeBagAtStop: number[];
}

/** Per-order timing from the API (absolute epoch ms). Windows are encouraged, not hard gates. */
export interface DispatchOrderTiming {
  /** Earliest acceptable arrival (epoch ms). 0 = no lower bound (ASAP). */
  earliestArrivalEpochMs: number;
  /** Latest acceptable arrival (epoch ms). */
  latestArrivalEpochMs: number;
  /** If set, objective penalizes |arrival − preferred| (ideal scheduled time). */
  preferredArrivalEpochMs?: number;
}

export interface DispatchOptions {
  serviceSeconds: number;
  freshnessWeight: number;
  /** penalty weight on |arrival − preferred| for scheduled orders (seconds of error) */
  schedulePreferenceWeight: number;
  /** penalty weight on seconds outside [earliest, latest] (still delivers, but costly) */
  timeWindowPenaltyWeight: number;
  maxTripSize: number;
  maxInBagSeconds: number;
  nowEpochMs: number;
  orderTiming: DispatchOrderTiming[];
}

export interface DispatchResult {
  driverTrips: DispatchTrip[][];
  strategy: "one-per-driver" | "multi-trip";
}

// ---------------- internals ----------------

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr.slice()];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) out.push([arr[i], ...p]);
  }
  return out;
}

interface EvaluatedTrip {
  duration: number;
  distance: number;
  totalInBag: number;
  maxInBag: number;
  visitOrder: number[];
  objective: number;
  cumulativeAtStops: number[];
}

function scorePerm(
  perm: number[],
  travel: number[][],
  distance: number[][],
  serviceSeconds: number,
  freshnessWeight: number,
  scheduleWeight: number,
  windowPenaltyWeight: number,
  timing: DispatchOrderTiming[],
  nowEpochMs: number,
): EvaluatedTrip {
  const k = perm.length;
  if (k === 0) {
    return {
      duration: 0,
      distance: 0,
      totalInBag: 0,
      maxInBag: 0,
      visitOrder: [],
      objective: 0,
      cumulativeAtStops: [],
    };
  }

  const departureWallMs = nowEpochMs;
  let bagClock = 0;
  let totalInBag = 0;
  let maxInBag = 0;
  let dist = 0;
  let prev = 0;
  let schedPrefPenalty = 0;
  let windowPenalty = 0;
  const cumulativeAtStops: number[] = [];

  for (let i = 0; i < perm.length; i++) {
    const oi = perm[i];
    const cur = oi + 1;
    bagClock += travel[prev][cur];
    dist += distance[prev][cur];

    const arrivalMs = departureWallMs + bagClock * 1000;
    const early = timing[oi].earliestArrivalEpochMs;
    const late = timing[oi].latestArrivalEpochMs;
    if (early > 0 && arrivalMs < early) {
      windowPenalty += (early - arrivalMs) / 1000;
    }
    if (arrivalMs > late) {
      windowPenalty += (arrivalMs - late) / 1000;
    }

    const tgt = timing[oi].preferredArrivalEpochMs;
    if (tgt !== undefined) {
      schedPrefPenalty += Math.abs(arrivalMs - tgt) / 1000;
    }

    cumulativeAtStops.push(bagClock);
    totalInBag += bagClock;
    if (bagClock > maxInBag) maxInBag = bagClock;
    bagClock += serviceSeconds;
    prev = cur;
  }
  bagClock += travel[prev][0];
  dist += distance[prev][0];

  const duration = bagClock;
  const objective =
    duration +
    freshnessWeight * totalInBag +
    scheduleWeight * schedPrefPenalty +
    windowPenaltyWeight * windowPenalty;

  return {
    duration,
    distance: dist,
    totalInBag,
    maxInBag,
    visitOrder: perm.slice(),
    objective,
    cumulativeAtStops,
  };
}

function evaluateTrip(
  orderIndices: number[],
  travel: number[][],
  distance: number[][],
  serviceSeconds: number,
  freshnessWeight: number,
  scheduleWeight: number,
  windowPenaltyWeight: number,
  timing: DispatchOrderTiming[],
  nowEpochMs: number,
): EvaluatedTrip {
  const k = orderIndices.length;
  if (k === 0) {
    return {
      duration: 0,
      distance: 0,
      totalInBag: 0,
      maxInBag: 0,
      visitOrder: [],
      objective: 0,
      cumulativeAtStops: [],
    };
  }

  const score = (perm: number[]): EvaluatedTrip =>
    scorePerm(
      perm,
      travel,
      distance,
      serviceSeconds,
      freshnessWeight,
      scheduleWeight,
      windowPenaltyWeight,
      timing,
      nowEpochMs,
    );

  if (k <= 4) {
    let best = score(orderIndices);
    for (const perm of permutations(orderIndices)) {
      const s = score(perm);
      if (s.objective < best.objective) best = s;
    }
    return best;
  }

  const remaining = new Set(orderIndices);
  let prev = 0;
  let nn: number[] = [];
  while (remaining.size > 0) {
    let bestIdx = -1;
    let bestT = Infinity;
    for (const i of remaining) {
      const t = travel[prev][i + 1];
      if (t < bestT) {
        bestT = t;
        bestIdx = i;
      }
    }
    nn.push(bestIdx);
    remaining.delete(bestIdx);
    prev = bestIdx + 1;
  }
  let bestEval = score(nn);
  let improved = true;
  let safety = 0;
  while (improved && safety++ < 30) {
    improved = false;
    for (let i = 0; i < nn.length - 1; i++) {
      for (let j = i + 1; j < nn.length; j++) {
        const candidate = [
          ...nn.slice(0, i),
          ...nn.slice(i, j + 1).reverse(),
          ...nn.slice(j + 1),
        ];
        const c = score(candidate);
        if (c.objective + 1e-9 < bestEval.objective) {
          bestEval = c;
          nn = candidate;
          improved = true;
        }
      }
    }
  }
  return bestEval;
}

// ---------------- public API ----------------

export function dispatch(
  orderCount: number,
  travel: number[][],
  distance: number[][],
  driverCount: number,
  options: DispatchOptions,
): DispatchResult {
  const {
    serviceSeconds,
    freshnessWeight,
    schedulePreferenceWeight,
    timeWindowPenaltyWeight,
    maxTripSize,
    maxInBagSeconds,
    nowEpochMs,
    orderTiming,
  } = options;

  if (orderTiming.length !== orderCount) {
    throw new Error("dispatch: orderTiming length must match orderCount");
  }

  if (driverCount >= orderCount) {
    const driverTrips: DispatchTrip[][] = Array.from(
      { length: driverCount },
      () => [],
    );
    for (let i = 0; i < orderCount; i++) {
      const e = evaluateTrip(
        [i],
        travel,
        distance,
        serviceSeconds,
        freshnessWeight,
        schedulePreferenceWeight,
        timeWindowPenaltyWeight,
        orderTiming,
        nowEpochMs,
      );
      driverTrips[i].push({
        orderIndices: e.visitOrder,
        durationSeconds: e.duration,
        distanceMeters: e.distance,
        maxInBagSeconds: e.maxInBag,
        totalInBagSeconds: e.totalInBag,
        cumulativeBagAtStop: e.cumulativeAtStops,
      });
    }
    return { driverTrips, strategy: "one-per-driver" };
  }

  const candidates: { trip: DispatchTrip; obj: number; mask: number }[] = [];

  function combos(start: number, size: number, current: number[]) {
    if (current.length === size) {
      const e = evaluateTrip(
        current,
        travel,
        distance,
        serviceSeconds,
        freshnessWeight,
        schedulePreferenceWeight,
        timeWindowPenaltyWeight,
        orderTiming,
        nowEpochMs,
      );
      if (current.length > 1 && e.maxInBag > maxInBagSeconds) return;
      const mask = current.reduce((m, i) => m | (1 << i), 0);
      candidates.push({
        trip: {
          orderIndices: e.visitOrder,
          durationSeconds: e.duration,
          distanceMeters: e.distance,
          maxInBagSeconds: e.maxInBag,
          totalInBagSeconds: e.totalInBag,
          cumulativeBagAtStop: e.cumulativeAtStops,
        },
        obj: e.objective,
        mask,
      });
      return;
    }
    for (let i = start; i < orderCount; i++) {
      current.push(i);
      combos(i + 1, size, current);
      current.pop();
    }
  }

  for (let size = 1; size <= Math.min(maxTripSize, orderCount); size++) {
    combos(0, size, []);
  }

  const FULL = (1 << orderCount) - 1;
  const dp = new Float64Array(FULL + 1);
  const choice = new Int32Array(FULL + 1);
  for (let i = 1; i <= FULL; i++) {
    dp[i] = Infinity;
    choice[i] = -1;
  }
  dp[0] = 0;

  for (let S = 1; S <= FULL; S++) {
    for (let c = 0; c < candidates.length; c++) {
      const m = candidates[c].mask;
      if ((m & S) !== m) continue;
      const prev = S ^ m;
      const cand = dp[prev] + candidates[c].obj;
      if (cand < dp[S]) {
        dp[S] = cand;
        choice[S] = c;
      }
    }
  }

  const chosen: DispatchTrip[] = [];
  let cur = FULL;
  while (cur > 0) {
    const c = choice[cur];
    if (c < 0) break;
    chosen.push(candidates[c].trip);
    cur ^= candidates[c].mask;
  }

  if (cur !== 0) {
    for (let i = 0; i < orderCount; i++) {
      if (cur & (1 << i)) {
        const e = evaluateTrip(
          [i],
          travel,
          distance,
          serviceSeconds,
          freshnessWeight,
          schedulePreferenceWeight,
          timeWindowPenaltyWeight,
          orderTiming,
          nowEpochMs,
        );
        chosen.push({
          orderIndices: e.visitOrder,
          durationSeconds: e.duration,
          distanceMeters: e.distance,
          maxInBagSeconds: e.maxInBag,
          totalInBagSeconds: e.totalInBag,
          cumulativeBagAtStop: e.cumulativeAtStops,
        });
      }
    }
  }

  const sorted = chosen
    .slice()
    .sort((a, b) => b.durationSeconds - a.durationSeconds);
  const load = new Array(driverCount).fill(0);
  const driverTrips: DispatchTrip[][] = Array.from(
    { length: driverCount },
    () => [],
  );
  for (const t of sorted) {
    let best = 0;
    for (let i = 1; i < driverCount; i++) {
      if (load[i] < load[best]) best = i;
    }
    driverTrips[best].push(t);
    load[best] += t.durationSeconds;
  }

  for (const d of driverTrips) {
    d.sort((a, b) => b.durationSeconds - a.durationSeconds);
  }

  return { driverTrips, strategy: "multi-trip" };
}
