import type { OptimizeResponse, Order, Trip } from "./types";

export interface TourPlanGroup {
  tourIndex: number;
  color: string;
  /** Order ids in delivery sequence for this tour (only orders still in the queue). */
  orderIds: string[];
}

/**
 * Derives tour groupings from the last optimize result for sidebar display.
 * Stale order ids (removed from the queue) are dropped from each group.
 * Any current order not in the plan needs a fresh Optimize.
 */
export function buildTourPlan(
  result: OptimizeResponse | null | undefined,
  orders: Order[],
): { groups: TourPlanGroup[]; unassignedIds: string[] } | null {
  if (!result?.routes?.length) return null;

  const orderIdSet = new Set(orders.map((o) => o.id));
  const groups: TourPlanGroup[] = [];

  for (const r of result.routes) {
    for (const t of r.trips) {
      const ids = t.legs
        .filter((l) => l.orderId !== null)
        .map((l) => l.orderId as string);
      const present = ids.filter((id) => orderIdSet.has(id));
      if (present.length === 0) continue;
      groups.push({
        tourIndex: t.tourIndex,
        color: t.color,
        orderIds: present,
      });
    }
  }

  groups.sort((a, b) => a.tourIndex - b.tourIndex);

  const inPlan = new Set(groups.flatMap((g) => g.orderIds));
  const unassignedIds = orders.filter((o) => !inPlan.has(o.id)).map((o) => o.id);

  return { groups, unassignedIds };
}

/** The trip block for a global tour index (unique per optimize result). */
export function findTripByTourIndex(
  result: OptimizeResponse,
  tourIndex: number,
): Trip | null {
  for (const r of result.routes) {
    for (const t of r.trips) {
      if (t.tourIndex === tourIndex) return t;
    }
  }
  return null;
}

/**
 * Latest depot departure time (local clock) that still hits the **tightest**
 * scheduled promise in this tour, given planned travel cumulatives.
 * ASAP-only tours → null (caller hides the hint).
 */
export function suggestedDriveOutLabel(
  result: OptimizeResponse,
  tourIndex: number,
  orders: Order[],
): string | null {
  const trip = findTripByTourIndex(result, tourIndex);
  if (!trip) return null;

  const orderMap = new Map(orders.map((o) => [o.id, o]));
  let minDepartMs = Infinity;
  let hasScheduled = false;

  for (const leg of trip.legs) {
    if (leg.orderId === null) continue;
    const o = orderMap.get(leg.orderId);
    if (!o || o.type !== "Scheduled" || !o.scheduledFor?.trim()) continue;
    const targetMs = Date.parse(o.scheduledFor);
    if (!Number.isFinite(targetMs)) continue;
    const departMs = targetMs - leg.cumulativeSeconds * 1000;
    if (departMs < minDepartMs) minDepartMs = departMs;
    hasScheduled = true;
  }

  if (!hasScheduled) return null;

  return new Date(minDepartMs).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
