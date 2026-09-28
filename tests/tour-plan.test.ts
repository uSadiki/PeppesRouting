import { describe, expect, it } from "vitest";
import {
  buildTourPlan,
  findTripByTourIndex,
  suggestedDriveOutLabel,
} from "@/lib/tour-plan";
import type { OptimizeResponse, Order, RouteLeg, Trip } from "@/lib/types";

const DEPOT = { lat: 59.91, lng: 10.75 };

function leg(orderId: string | null, cumulativeSeconds: number): RouteLeg {
  return {
    orderId,
    address: orderId ?? "Depot",
    location: DEPOT,
    travelSeconds: 0,
    travelMeters: 0,
    cumulativeSeconds,
  };
}

function trip(tourIndex: number, stops: Array<[string, number]>): Trip {
  return {
    tourIndex,
    tripIndex: 0,
    color: `#00000${tourIndex}`,
    legs: [leg(null, 0), ...stops.map(([id, s]) => leg(id, s))],
    durationSeconds: 0,
    distanceMeters: 0,
    polyline: "",
    maxInBagSeconds: 0,
  };
}

function order(id: string, extra: Partial<Order> = {}): Order {
  return { id, address: `${id} street`, type: "ASAP", createdAt: 0, ...extra };
}

function response(trips: Trip[][]): OptimizeResponse {
  return {
    base: { address: "Depot", location: DEPOT },
    routes: trips.map((t, i) => ({
      driverIndex: i,
      trips: t,
      totalSeconds: 0,
      totalMeters: 0,
      totalStops: 0,
    })),
    strategy: "multi-trip",
    serviceTimePerStopSeconds: 120,
    config: {
      freshnessWeight: 1,
      maxTripSize: 3,
      maxInBagSeconds: 1200,
      maxDeliveryMinutes: 40,
      scheduleWindowMinutes: 15,
      schedulePreferenceWeight: 0.03,
      timeWindowPenaltyWeight: 1,
    },
  };
}

describe("buildTourPlan", () => {
  it("returns null when there is no plan yet", () => {
    expect(buildTourPlan(null, [])).toBeNull();
    expect(buildTourPlan(undefined, [order("a")])).toBeNull();
    expect(buildTourPlan(response([]), [order("a")])).toBeNull();
  });

  it("groups orders by tour, sorted by tour index across drivers", () => {
    const res = response([
      [trip(2, [["c", 300]])],
      [trip(0, [["a", 100], ["b", 200]]), trip(1, [["d", 50]])],
    ]);
    const plan = buildTourPlan(res, ["a", "b", "c", "d"].map((id) => order(id)));
    expect(plan?.groups.map((g) => [g.tourIndex, g.orderIds])).toEqual([
      [0, ["a", "b"]],
      [1, ["d"]],
      [2, ["c"]],
    ]);
    expect(plan?.unassignedIds).toEqual([]);
  });

  it("drops orders that were removed after optimizing, and hides emptied tours", () => {
    const res = response([[trip(0, [["a", 100], ["b", 200]]), trip(1, [["gone", 50]])]]);
    const plan = buildTourPlan(res, [order("b")]);
    expect(plan?.groups).toEqual([{ tourIndex: 0, color: "#000000", orderIds: ["b"] }]);
  });

  it("flags orders added after the last optimize as unassigned", () => {
    const res = response([[trip(0, [["a", 100]])]]);
    const plan = buildTourPlan(res, [order("a"), order("new-1"), order("new-2")]);
    expect(plan?.unassignedIds).toEqual(["new-1", "new-2"]);
  });
});

describe("findTripByTourIndex", () => {
  const res = response([[trip(0, [["a", 1]])], [trip(1, [["b", 1]]), trip(2, [["c", 1]])]]);

  it("finds a trip regardless of which driver owns it", () => {
    expect(findTripByTourIndex(res, 2)?.legs[1].orderId).toBe("c");
  });

  it("returns null for unknown tours", () => {
    expect(findTripByTourIndex(res, 99)).toBeNull();
  });
});

describe("suggestedDriveOutLabel", () => {
  const fmt = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  it("returns null for ASAP-only tours", () => {
    const res = response([[trip(0, [["a", 600]])]]);
    expect(suggestedDriveOutLabel(res, 0, [order("a")])).toBeNull();
  });

  it("returns null for an unknown tour", () => {
    expect(suggestedDriveOutLabel(response([]), 0, [])).toBeNull();
  });

  it("works back from the tightest scheduled promise in the tour", () => {
    // a: promised 18:30, reached 10 min after leaving → leave by 18:20
    // b: promised 18:35, reached 20 min after leaving → leave by 18:15 ← tighter
    const a = "2026-01-15T18:30:00";
    const b = "2026-01-15T18:35:00";
    const res = response([[trip(0, [["a", 600], ["b", 1200]])]]);
    const orders = [
      order("a", { type: "Scheduled", scheduledFor: a }),
      order("b", { type: "Scheduled", scheduledFor: b }),
    ];
    expect(suggestedDriveOutLabel(res, 0, orders)).toBe(fmt(Date.parse(b) - 1200_000));
  });

  it("ignores scheduled orders with unparseable times", () => {
    const res = response([[trip(0, [["a", 600]])]]);
    const orders = [order("a", { type: "Scheduled", scheduledFor: "not a date" })];
    expect(suggestedDriveOutLabel(res, 0, orders)).toBeNull();
  });
});
