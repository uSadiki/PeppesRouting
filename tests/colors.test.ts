import { describe, expect, it } from "vitest";
import { ROUTE_COLORS, colorForDriver, colorForTour } from "@/lib/colors";

describe("route colors", () => {
  it("is a palette of distinct hex colours", () => {
    for (const c of ROUTE_COLORS) expect(c).toMatch(/^#[0-9A-F]{6}$/i);
    expect(new Set(ROUTE_COLORS).size).toBe(ROUTE_COLORS.length);
  });

  it("gives consecutive tours different colours", () => {
    for (let i = 0; i < ROUTE_COLORS.length - 1; i++) {
      expect(colorForTour(i)).not.toBe(colorForTour(i + 1));
    }
  });

  it("wraps around when there are more tours than colours", () => {
    expect(colorForTour(ROUTE_COLORS.length)).toBe(colorForTour(0));
    expect(colorForTour(ROUTE_COLORS.length * 3 + 2)).toBe(colorForTour(2));
  });

  it("keeps the legacy per-driver helper in sync", () => {
    expect(colorForDriver(5)).toBe(colorForTour(5));
  });
});
