import { describe, expect, it } from "vitest";
import { colorForTour, inkFor } from "@/lib/colors";
import { decodePolyline } from "@/lib/map-utils";
import {
  assignedOrderIds,
  formatMinutes,
  manualTourPlan,
  nextColorIndex,
  pruneTrips,
  summarizeTrip,
  toggleStop,
} from "@/lib/manual-trips";
import type { ManualTrip, Order, TripLeg } from "@/lib/types";

const leg = (durationSeconds: number, distanceMeters = durationSeconds * 10): TripLeg => ({
  durationSeconds,
  distanceMeters,
  polyline: "",
});

const trip = (colorIndex: number, orderIds: string[], legs: TripLeg[] | null = null): ManualTrip => ({
  id: `t${colorIndex}`,
  orderIds,
  colorIndex,
  legs,
});

const order = (id: string): Order => ({ id, address: `${id} gate 1`, type: "ASAP", createdAt: 0 });

describe("summarizeTrip", () => {
  it("adds handover time at each door and the drive back", () => {
    // depot →(5 min) A →(3 min) B →(4 min) C →(10 min) depot, 2 min per handover
    const s = summarizeTrip([leg(300), leg(180), leg(240), leg(600)]);
    expect(s.arrivalSeconds).toEqual([300, 300 + 120 + 180, 300 + 120 + 180 + 120 + 240]);
    expect(s.roundTripSeconds).toBe(300 + 180 + 240 + 600 + 3 * 120);
    expect(s.coldestSeconds).toBe(960);
    expect(s.distanceMeters).toBe(13_200);
  });

  it("handles a single drop and an empty trip", () => {
    expect(summarizeTrip([leg(400), leg(420)])).toMatchObject({
      arrivalSeconds: [400],
      roundTripSeconds: 400 + 120 + 420,
      coldestSeconds: 400,
    });
    expect(summarizeTrip([])).toEqual({
      arrivalSeconds: [],
      roundTripSeconds: 0,
      distanceMeters: 0,
      coldestSeconds: 0,
    });
  });
});

describe("toggleStop", () => {
  it("appends stops in tap order", () => {
    expect(toggleStop(toggleStop(toggleStop([], "a"), "c"), "b")).toEqual(["a", "c", "b"]);
  });

  it("removes a stop that is tapped again, keeping the rest in order", () => {
    expect(toggleStop(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});

describe("nextColorIndex", () => {
  it("numbers trips from 1 and fills gaps left by sent-out trips", () => {
    expect(nextColorIndex([])).toBe(0);
    expect(nextColorIndex([trip(0, ["a"]), trip(1, ["b"])])).toBe(2);
    expect(nextColorIndex([trip(0, ["a"]), trip(2, ["b"])])).toBe(1);
  });
});

describe("pruneTrips", () => {
  const legs = [leg(1), leg(1), leg(1)];
  const trips = [trip(0, ["a", "b"], legs), trip(1, ["c"], [leg(1), leg(1)])];

  it("returns the same array when every order is still queued", () => {
    expect(pruneTrips(trips, new Set(["a", "b", "c"]))).toBe(trips);
  });

  it("drops trips whose orders all left the queue", () => {
    expect(pruneTrips(trips, new Set(["a", "b"])).map((t) => t.colorIndex)).toEqual([0]);
  });

  it("keeps a partly delivered trip but asks for a fresh route", () => {
    const [t0] = pruneTrips(trips, new Set(["b", "c"]));
    expect(t0).toMatchObject({ colorIndex: 0, orderIds: ["b"], legs: null });
  });
});

describe("manualTourPlan", () => {
  it("lists trips by number with their colours, and the rest as unassigned", () => {
    const plan = manualTourPlan(
      [trip(2, ["d"]), trip(0, ["b", "a"])],
      ["a", "b", "c", "d", "e"].map(order),
    );
    expect(plan.groups).toEqual([
      { tourIndex: 0, color: colorForTour(0), orderIds: ["b", "a"] },
      { tourIndex: 2, color: colorForTour(2), orderIds: ["d"] },
    ]);
    expect(plan.unassignedIds).toEqual(["c", "e"]);
  });

  it("reports every assigned order", () => {
    expect([...assignedOrderIds([trip(0, ["a", "b"]), trip(1, ["c"])])].sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("display helpers", () => {
  it.each([
    [59, "1 min"],
    [25 * 60, "25 min"],
    [75 * 60, "1h 15m"],
  ])("formats %i s as %s", (s, text) => {
    expect(formatMinutes(s)).toBe(text);
  });

  it("picks dark text on light trip colours and white on dark ones", () => {
    expect(inkFor("#FFD60A")).toBe("#0E0E10"); // yellow
    expect(inkFor("#64D2FF")).toBe("#0E0E10"); // cyan
    expect(inkFor("#5E5CE6")).toBe("#FFFFFF"); // indigo
    expect(inkFor("#FF3B30")).toBe("#FFFFFF"); // red
  });

  it("decodes Google's reference polyline", () => {
    // Example from https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts).toHaveLength(3);
    expect(pts[0].lat).toBeCloseTo(38.5, 5);
    expect(pts[0].lng).toBeCloseTo(-120.2, 5);
    expect(pts[1].lat).toBeCloseTo(40.7, 5);
    expect(pts[1].lng).toBeCloseTo(-120.95, 5);
    expect(pts[2].lat).toBeCloseTo(43.252, 5);
    expect(pts[2].lng).toBeCloseTo(-126.453, 5);
    expect(decodePolyline("")).toEqual([]);
  });
});
