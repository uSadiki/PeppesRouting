export type OrderType = "ASAP" | "Scheduled";

/** Values from the top bar when adding an order. */
export interface AddOrderPayload {
  address: string;
  type: OrderType;
  /** Required when type === "Scheduled" (ISO-ish datetime-local string). */
  scheduledFor?: string;
}

export interface Order {
  id: string;
  address: string;
  type: OrderType;
  /** ISO timestamp; only meaningful when type === "Scheduled". */
  scheduledFor?: string;
  /** Resolved by /api/geocode after entry. */
  lat?: number;
  lng?: number;
  formattedAddress?: string;
  /** "ok" once geocoded, "error" if geocoding failed, "pending" while in flight. */
  geocodeStatus?: "pending" | "ok" | "error";
  geocodeError?: string;
  createdAt: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteLeg {
  /** null for the depot leg at index 0; otherwise the order id. */
  orderId: string | null;
  address: string;
  location: LatLng;
  /** Travel duration to reach this stop from the previous one (seconds). */
  travelSeconds: number;
  /** Travel distance to reach this stop from the previous one (meters). */
  travelMeters: number;
  /** Cumulative seconds since this trip started (= "minutes in bag" at delivery). */
  cumulativeSeconds: number;
}

export interface Trip {
  /** Global 0-based tour id (one color on the map per tour). */
  tourIndex: number;
  /** 0-based index of this trip within its driver's day. */
  tripIndex: number;
  /** Line + stops for this tour on the map. */
  color: string;
  /** [depot, stop1, stop2, ...] — the return-to-depot leg is implied. */
  legs: RouteLeg[];
  /** Total round-trip duration including service & return, in seconds. */
  durationSeconds: number;
  /** Total round-trip distance including return, in meters. */
  distanceMeters: number;
  /** Encoded polyline (depot → stops, outbound only) from Routes API computeRoutes, if available. */
  polyline: string;
  /** Worst pizza in this trip — seconds it spent in the bag before delivery. */
  maxInBagSeconds: number;
}

export interface DriverRoute {
  driverIndex: number;
  trips: Trip[];
  totalSeconds: number;
  totalMeters: number;
  totalStops: number;
}

export interface OptimizeRequestBody {
  drivers: number;
  /** Wall-clock "now" for the plan (epoch ms). Defaults to server time if omitted. */
  optimizeAtEpochMs?: number;
  /**
   * Max minutes from order placement to delivery for ASAP orders (promised SLA).
   * Typical 40; raise to 50–60 when the queue is heavy.
   */
  maxDeliveryMinutes?: number;
  orders: Array<{
    id: string;
    address: string;
    type: OrderType;
    lat?: number;
    lng?: number;
    createdAt?: number;
    scheduledFor?: string;
  }>;
}

export interface OptimizeResponse {
  base: {
    address: string;
    location: LatLng;
  };
  /** Wall time when this plan was produced (same as request `optimizeAtEpochMs`). */
  plannedAtEpochMs?: number;
  routes: DriverRoute[];
  /** Strategy actually used by the optimizer. */
  strategy: "one-per-driver" | "multi-trip";
  /** Service time per stop, in seconds. */
  serviceTimePerStopSeconds: number;
  /** Parameters used by the dispatch algorithm (so the UI can show & explain them). */
  config: {
    freshnessWeight: number;
    maxTripSize: number;
    maxInBagSeconds: number;
    maxDeliveryMinutes: number;
    scheduleWindowMinutes: number;
    schedulePreferenceWeight: number;
    timeWindowPenaltyWeight: number;
  };
  /** Non-fatal warnings (e.g. a Google API was disabled and we fell back). */
  warnings?: string[];
}
