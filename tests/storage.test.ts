// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadDrivers,
  loadMaxDeliveryMinutes,
  loadOrders,
  saveDrivers,
  saveMaxDeliveryMinutes,
  saveOrders,
} from "@/lib/storage";
import type { Order } from "@/lib/types";

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

describe("server-side rendering", () => {
  it("returns safe defaults and never touches storage when window is undefined", () => {
    vi.stubGlobal("window", undefined);
    expect(loadOrders()).toEqual([]);
    expect(loadDrivers()).toBe(1);
    expect(loadMaxDeliveryMinutes()).toBe(40);
    expect(() => saveOrders([])).not.toThrow();
    expect(() => saveDrivers(3)).not.toThrow();
  });
});
