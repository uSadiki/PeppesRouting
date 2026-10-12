import type { ManualTrip, Order, PlanningMode, TripLeg } from "./types";

const ORDERS_KEY = "peppes:orders";
const DRIVERS_KEY = "peppes:drivers";
const MAX_DELIVERY_KEY = "peppes:maxDeliveryMinutes";
const MODE_KEY = "peppes:mode";
const MANUAL_TRIPS_KEY = "peppes:manualTrips";

export function loadOrders(): Order[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ORDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((o) => o && typeof o.id === "string" && typeof o.address === "string")
      .map((o) => {
        const createdAt =
          typeof o.createdAt === "number" ? o.createdAt : Date.now();
        const rest = { ...(o as Record<string, unknown>) };
        delete rest.kitchenStatus;
        delete rest.inOvenAt;
        return { ...rest, createdAt } as Order;
      });
  } catch {
    return [];
  }
}

export function saveOrders(orders: Order[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
  } catch {
    // Ignore quota / serialization errors — persistence is best-effort.
  }
}

export function loadDrivers(): number {
  if (typeof window === "undefined") return 1;
  try {
    const raw = window.localStorage.getItem(DRIVERS_KEY);
    if (!raw) return 1;
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n) || n < 1) return 1;
    return Math.min(n, 99);
  } catch {
    return 1;
  }
}

export function saveDrivers(n: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRIVERS_KEY, String(n));
  } catch {
    // best-effort
  }
}

export function loadMaxDeliveryMinutes(): number {
  if (typeof window === "undefined") return 40;
  try {
    const raw = window.localStorage.getItem(MAX_DELIVERY_KEY);
    if (!raw) return 40;
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) return 40;
    return [40, 50, 60].includes(n) ? n : 40;
  } catch {
    return 40;
  }
}

export function saveMaxDeliveryMinutes(n: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MAX_DELIVERY_KEY, String(n));
  } catch {
    // best-effort
  }
}

export function loadPlanningMode(): PlanningMode {
  if (typeof window === "undefined") return "auto";
  try {
    return window.localStorage.getItem(MODE_KEY) === "manual" ? "manual" : "auto";
  } catch {
    return "auto";
  }
}

export function savePlanningMode(mode: PlanningMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // best-effort
  }
}

function isTripLeg(v: unknown): v is TripLeg {
  const l = v as TripLeg;
  return (
    !!l &&
    Number.isFinite(l.durationSeconds) &&
    Number.isFinite(l.distanceMeters) &&
    typeof l.polyline === "string"
  );
}

export function loadManualTrips(): ManualTrip[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MANUAL_TRIPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seenColors = new Set<number>();
    const trips: ManualTrip[] = [];
    for (const t of parsed) {
      if (
        !t ||
        typeof t.id !== "string" ||
        !Array.isArray(t.orderIds) ||
        t.orderIds.length === 0 ||
        !t.orderIds.every((id: unknown) => typeof id === "string") ||
        !Number.isInteger(t.colorIndex) ||
        t.colorIndex < 0 ||
        seenColors.has(t.colorIndex)
      ) {
        continue;
      }
      seenColors.add(t.colorIndex);
      const legs =
        Array.isArray(t.legs) &&
        t.legs.length === t.orderIds.length + 1 &&
        t.legs.every(isTripLeg)
          ? (t.legs as TripLeg[])
          : null; // recomputed by the app
      trips.push({ id: t.id, orderIds: t.orderIds, colorIndex: t.colorIndex, legs });
    }
    return trips;
  } catch {
    return [];
  }
}

export function saveManualTrips(trips: ManualTrip[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MANUAL_TRIPS_KEY, JSON.stringify(trips));
  } catch {
    // best-effort
  }
}
