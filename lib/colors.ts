/**
 * Distinct, high-contrast palette for map polylines and stop markers.
 * Used per **tour** (round trip), not per driver.
 */
export const ROUTE_COLORS = [
  "#FF3B30", // red
  "#34C759", // green
  "#0A84FF", // blue
  "#FFD60A", // yellow
  "#BF5AF2", // purple
  "#FF9F0A", // orange
  "#64D2FF", // cyan
  "#FF2D92", // pink
  "#30D158", // mint
  "#5E5CE6", // indigo
  "#AC8E68", // tan
  "#A8A8A8", // gray
];

/** @deprecated Prefer colorForTour; kept for any legacy call sites. */
export const DRIVER_COLORS = ROUTE_COLORS;

export function colorForTour(tourIndex: number): string {
  return ROUTE_COLORS[tourIndex % ROUTE_COLORS.length];
}

export function colorForDriver(index: number): string {
  return colorForTour(index);
}

/** Readable text colour (near-black or white) on top of a `#RRGGBB` fill. */
export function inkFor(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#0E0E10" : "#FFFFFF";
}
