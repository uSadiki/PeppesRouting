// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadDrivers,
  loadManualTrips,
  loadMaxDeliveryMinutes,
  loadOrders,
  loadPlanningMode,
  saveDrivers,
  saveManualTrips,
  saveMaxDeliveryMinutes,
  saveOrders,
  savePlanningMode,
} from "@/lib/storage";
import type { ManualTrip, Order } from "@/lib/types";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("orders persistence", () => {
  const sample: Order[] = [
    { id: "1", address: "Karl Johans gate 1", type: "ASAP", createdAt: 1000 },
    {
      id: "2",
      address: "Storgata 5",
      type: "Scheduled",
      scheduledFor: "2026-01-15T18:30",
      lat: 59.9,
      lng: 10.7,
      geocodeStatus: "ok",
      createdAt: 2000,
    },
  ];

  it("round-trips orders through localStorage", () => {
    saveOrders(sample);
    expect(loadOrders()).toEqual(sample);
  });

  it("returns an empty queue when nothing is stored", () => {
    expect(loadOrders()).toEqual([]);
  });

  it("survives corrupted storage instead of crashing the terminal", () => {
    window.localStorage.setItem("peppes:orders", "{not json");
    expect(loadOrders()).toEqual([]);
    window.localStorage.setItem("peppes:orders", JSON.stringify({ not: "an array" }));
    expect(loadOrders()).toEqual([]);
  });

  it("filters out malformed entries", () => {
    window.localStorage.setItem(
      "peppes:orders",
      JSON.stringify([null, { id: 5, address: "x" }, { id: "ok", address: "Fine 1", createdAt: 1 }]),
    );
    expect(loadOrders().map((o) => o.id)).toEqual(["ok"]);
  });

  it("migrates legacy fields and back-fills createdAt", () => {
    vi.spyOn(Date, "now").mockReturnValue(42);
    window.localStorage.setItem(
      "peppes:orders",
      JSON.stringify([{ id: "a", address: "Old 1", kitchenStatus: "oven", inOvenAt: 5 }]),
    );
    const [o] = loadOrders();
    expect(o).toEqual({ id: "a", address: "Old 1", createdAt: 42 });
  });

  it("swallows quota errors when saving (persistence is best-effort)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => saveOrders(sample)).not.toThrow();
  });
});

describe("driver count persistence", () => {
  it("defaults to one driver", () => {
    expect(loadDrivers()).toBe(1);
  });

  it("round-trips the driver count", () => {
    saveDrivers(4);
    expect(loadDrivers()).toBe(4);
  });

  it.each([
    ["0", 1],
    ["-3", 1],
    ["abc", 1],
    ["250", 99],
  ])("sanitises stored value %s → %i", (raw, expected) => {
    window.localStorage.setItem("peppes:drivers", raw);
    expect(loadDrivers()).toBe(expected);
  });
});

describe("max delivery minutes persistence", () => {
  it("defaults to the 40-minute promise", () => {
    expect(loadMaxDeliveryMinutes()).toBe(40);
  });

  it.each([40, 50, 60])("accepts the supported SLA of %i minutes", (n) => {
    saveMaxDeliveryMinutes(n);
    expect(loadMaxDeliveryMinutes()).toBe(n);
  });

  it("falls back to 40 for unsupported values", () => {
    saveMaxDeliveryMinutes(45);
    expect(loadMaxDeliveryMinutes()).toBe(40);
  });
});

describe("planning mode persistence", () => {
  it("defaults to the optimizer", () => {
    expect(loadPlanningMode()).toBe("auto");
  });

  it("remembers manual mode", () => {
    savePlanningMode("manual");
    expect(loadPlanningMode()).toBe("manual");
  });

  it("treats unknown values as auto", () => {
    window.localStorage.setItem("peppes:mode", "chaos");
    expect(loadPlanningMode()).toBe("auto");
  });
});

describe("manual trips persistence", () => {
  const leg = { durationSeconds: 300, distanceMeters: 2500, polyline: "abc" };
  const trips: ManualTrip[] = [
    { id: "t1", orderIds: ["a", "b"], colorIndex: 0, legs: [leg, leg, leg] },
    { id: "t2", orderIds: ["c"], colorIndex: 3, legs: null },
  ];

  it("round-trips saved trips, including their routes", () => {
    saveManualTrips(trips);
    expect(loadManualTrips()).toEqual(trips);
  });

  it("returns no trips for empty or corrupted storage", () => {
    expect(loadManualTrips()).toEqual([]);
    window.localStorage.setItem("peppes:manualTrips", "{oops");
    expect(loadManualTrips()).toEqual([]);
  });

  it("skips malformed trips and duplicate trip numbers", () => {
    window.localStorage.setItem(
      "peppes:manualTrips",
      JSON.stringify([
        { id: "ok", orderIds: ["a"], colorIndex: 1, legs: null },
        { id: "dup", orderIds: ["b"], colorIndex: 1, legs: null },
        { id: "empty", orderIds: [], colorIndex: 2, legs: null },
        { id: "neg", orderIds: ["c"], colorIndex: -1, legs: null },
        { id: 7, orderIds: ["d"], colorIndex: 4, legs: null },
      ]),
    );
    expect(loadManualTrips().map((t) => t.id)).toEqual(["ok"]);
  });

  it("discards a stored route that doesn't match the trip so it gets recomputed", () => {
    window.localStorage.setItem(
      "peppes:manualTrips",
      JSON.stringify([{ id: "t", orderIds: ["a", "b"], colorIndex: 0, legs: [leg] }]),
    );
    expect(loadManualTrips()[0].legs).toBeNull();
  });
});

describe("server-side rendering", () => {
  it("returns safe defaults and never touches storage when window is undefined", () => {
    vi.stubGlobal("window", undefined);
    expect(loadOrders()).toEqual([]);
    expect(loadDrivers()).toBe(1);
    expect(loadMaxDeliveryMinutes()).toBe(40);
    expect(loadPlanningMode()).toBe("auto");
    expect(loadManualTrips()).toEqual([]);
    expect(() => saveOrders([])).not.toThrow();
    expect(() => saveManualTrips([])).not.toThrow();
    expect(() => saveDrivers(3)).not.toThrow();
  });
});
