import { colorForTour } from "./colors";
import type { TourPlanGroup } from "./tour-plan";
import type { ManualTrip, Order, TripLeg } from "./types";

/**
 * Pure helpers for manual mode, where the dispatcher builds each trip by
 * tapping stops on the map instead of running the optimizer.
 */

/** Same per-stop handover time the optimizer assumes. */
export const SERVICE_SECONDS = 120;

export interface TripSummary {
  /** Seconds after leaving the depot that each stop is reached (= time in bag). */
  arrivalSeconds: number[];
  /** Leave depot → all stops (incl. handovers) → back at depot. */
  roundTripSeconds: number;
  distanceMeters: number;
  /** In-bag time of the last pizza delivered — the coldest one. */
  coldestSeconds: number;
}

/** Timings for a trip from its legs (`stops + 1` legs, the last returning to the depot). */
export function summarizeTrip(legs: TripLeg[], serviceSeconds = SERVICE_SECONDS): TripSummary {
  const arrivalSeconds: number[] = [];
  let clock = 0;
  let distanceMeters = 0;
  legs.forEach((leg, i) => {
    clock += leg.durationSeconds;
    distanceMeters += leg.distanceMeters;
    if (i < legs.length - 1) {
      arrivalSeconds.push(clock);
      clock += serviceSeconds;
    }
  });
  return {
    arrivalSeconds,
    roundTripSeconds: clock,
    distanceMeters,
    coldestSeconds: arrivalSeconds.length ? Math.max(...arrivalSeconds) : 0,
  };
}

/** Tapping a stop adds it to the end of the trip being built; tapping it again removes it. */
export function toggleStop(draft: string[], orderId: string): string[] {
  return draft.includes(orderId) ? draft.filter((id) => id !== orderId) : [...draft, orderId];
}

/** Lowest trip number not in use, so numbers and colours stay stable as trips come and go. */
export function nextColorIndex(trips: ManualTrip[]): number {
  const used = new Set(trips.map((t) => t.colorIndex));
  let i = 0;
  while (used.has(i)) i++;
  return i;
}

export function tripColor(trip: Pick<ManualTrip, "colorIndex">): string {
  return colorForTour(trip.colorIndex);
}

/** Every order id that is already part of a saved trip. */
export function assignedOrderIds(trips: ManualTrip[]): Set<string> {
  return new Set(trips.flatMap((t) => t.orderIds));
}

/**
 * Drops orders that left the queue (delivered or deleted) from saved trips.
 * Emptied trips disappear; trips that lost a stop keep their order but need
 * a fresh route (`legs: null`). Returns the same array if nothing changed.
 */
export function pruneTrips(trips: ManualTrip[], liveOrderIds: Set<string>): ManualTrip[] {
  let changed = false;
  const next: ManualTrip[] = [];
  for (const t of trips) {
    const kept = t.orderIds.filter((id) => liveOrderIds.has(id));
    if (kept.length === t.orderIds.length) {
      next.push(t);
      continue;
    }
    changed = true;
    if (kept.length > 0) next.push({ ...t, orderIds: kept, legs: null });
  }
  return changed ? next : trips;
}

/** Sidebar grouping for manual mode — same shape as the optimizer's tour plan. */
export function manualTourPlan(
  trips: ManualTrip[],
  orders: Order[],
): { groups: TourPlanGroup[]; unassignedIds: string[] } {
  const groups = trips
    .filter((t) => t.orderIds.length > 0)
    .map((t) => ({ tourIndex: t.colorIndex, color: tripColor(t), orderIds: t.orderIds.slice() }))
    .sort((a, b) => a.tourIndex - b.tourIndex);
  const assigned = assignedOrderIds(trips);
  return { groups, unassignedIds: orders.filter((o) => !assigned.has(o.id)).map((o) => o.id) };
}

export function formatMinutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
