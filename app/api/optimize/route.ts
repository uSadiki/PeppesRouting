import { NextRequest, NextResponse } from "next/server";
import { haversineMeters } from "@/lib/optimizer";
import { dispatch, type DispatchOrderTiming } from "@/lib/dispatch";
import { colorForTour } from "@/lib/colors";
import type {
  DriverRoute,
  LatLng,
  OptimizeRequestBody,
  OptimizeResponse,
  OrderType,
  RouteLeg,
  Trip,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- Tunable dispatch parameters ----
//
// The optimizer minimizes:
//   total_driver_seconds + FRESHNESS_WEIGHT * Σ(per_pizza_in_bag_seconds)
//
// and rejects any multi-stop trip whose worst pizza would exceed
// MAX_IN_BAG_SECONDS. Service time is added per stop. With these defaults a
// pair of close-by stops will be batched, but a 3rd far-away stop will spawn
// its own trip rather than serve a cold pizza.
const SERVICE_TIME_SECONDS = 2 * 60; // 2 min per stop
const FRESHNESS_WEIGHT = 1.0; // 1 in-bag minute weighted = 1 driver minute
const SCHEDULE_PREFERENCE_WEIGHT = 0.03; // soft preference to hit promised time
/** Per second outside the ASAP / scheduled window — still routed, but discouraged. */
const TIME_WINDOW_PENALTY_WEIGHT = 1.0;
const MAX_TRIP_SIZE = 3; // pizza-bag-realistic
const MAX_IN_BAG_SECONDS = 20 * 60; // thermal bag — pizzas stay warm ~20 min
const SCHEDULE_WINDOW_MINUTES = 15;

function buildDispatchOrderTiming(
  geoOrders: Array<{
    type: OrderType;
    scheduledFor?: string;
    createdAt?: number;
  }>,
  maxDeliveryMinutes: number,
  nowMs: number,
): DispatchOrderTiming[] {
  const winMs = SCHEDULE_WINDOW_MINUTES * 60 * 1000;
  const maxDelMs = maxDeliveryMinutes * 60 * 1000;

  return geoOrders.map((o) => {
    const placed = typeof o.createdAt === "number" ? o.createdAt : nowMs;

    let earliest = 0;
    let latest: number;
    let preferred: number | undefined;

    if (o.type === "Scheduled" && o.scheduledFor) {
      const target = Date.parse(o.scheduledFor);
      if (Number.isFinite(target)) {
        earliest = target - winMs;
        latest = target + winMs;
        preferred = target;
      } else {
        latest = placed + maxDelMs;
      }
    } else {
      latest = placed + maxDelMs;
    }

    return {
      earliestArrivalEpochMs: earliest,
      latestArrivalEpochMs: latest,
      preferredArrivalEpochMs: preferred,
    };
  });
}

// ---------- Google API helpers ----------

async function geocodeAddress(
  address: string,
  apiKey: string,
  region?: string,
): Promise<{ location: LatLng; formattedAddress: string }> {
  const params = new URLSearchParams({ address, key: apiKey });
  if (region) params.set("region", region.toLowerCase());
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
  const r = await fetch(url, { cache: "no-store" });
  const data = (await r.json()) as {
    status: string;
    error_message?: string;
    results: Array<{
      formatted_address: string;
      geometry: { location: { lat: number; lng: number } };
    }>;
  };
  if (data.status !== "OK" || !data.results.length) {
    throw new Error(
      data.error_message || `Geocoding failed for "${address}" (${data.status}).`,
    );
  }
  return {
    location: data.results[0].geometry.location,
    formattedAddress: data.results[0].formatted_address,
  };
}

interface MatrixCell {
  durationSeconds: number;
  distanceMeters: number;
}

/**
 * Custom error class so the caller can detect "the API isn't enabled in your
 * Google Cloud project" and fall back gracefully without surfacing a 1000-char
 * raw JSON response to the user.
 */
class GoogleApiError extends Error {
  status: number;
  reason?: string;
  enableUrl?: string;
  apiTitle?: string;
  constructor(opts: {
    status: number;
    message: string;
    reason?: string;
    enableUrl?: string;
    apiTitle?: string;
  }) {
    super(opts.message);
    this.status = opts.status;
    this.reason = opts.reason;
    this.enableUrl = opts.enableUrl;
    this.apiTitle = opts.apiTitle;
  }
}

/** Best-effort extractor for Google API JSON error envelopes. */
function parseGoogleError(status: number, raw: string): GoogleApiError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new GoogleApiError({ status, message: raw.slice(0, 200) });
  }
  // Routes API returns a single object or an array containing { error: {...} }.
  const node = Array.isArray(parsed) ? parsed[0] : parsed;
  const err = (node as { error?: { message?: string; details?: unknown[] } })
    ?.error;
  const message = err?.message || `Google API error ${status}`;
  let reason: string | undefined;
  let apiTitle: string | undefined;
  let enableUrl: string | undefined;
  for (const detail of err?.details ?? []) {
    const d = detail as {
      "@type"?: string;
      reason?: string;
      metadata?: { service?: string };
      links?: Array<{ description?: string; url?: string }>;
    };
    if (d.reason) reason = d.reason;
    if (d.metadata?.service) apiTitle = d.metadata.service;
    if (d.links) {
      for (const l of d.links) {
        if (l.url) enableUrl = l.url;
      }
    }
  }
  return new GoogleApiError({ status, message, reason, enableUrl, apiTitle });
}

/**
 * Calls the Routes API computeRouteMatrix with TRAFFIC_AWARE preference, which
 * is the modern (v2) replacement for the legacy Distance Matrix API. This
 * gives us real-time, traffic-aware travel times.
 */
async function computeRouteMatrix(
  origins: LatLng[],
  destinations: LatLng[],
  apiKey: string,
): Promise<MatrixCell[][]> {
  const url = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
  const body = {
    origins: origins.map((o) => ({
      waypoint: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
    })),
    destinations: destinations.map((d) => ({
      waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
    })),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "originIndex,destinationIndex,duration,distanceMeters,condition",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!r.ok) {
    const text = await r.text();
    throw parseGoogleError(r.status, text);
  }

  const items = (await r.json()) as Array<{
    originIndex: number;
    destinationIndex: number;
    duration?: string; // e.g. "423s"
    distanceMeters?: number;
    condition?: string;
  }>;

  const matrix: MatrixCell[][] = Array.from({ length: origins.length }, () =>
    Array.from({ length: destinations.length }, () => ({
      durationSeconds: Number.POSITIVE_INFINITY,
      distanceMeters: Number.POSITIVE_INFINITY,
    })),
  );

  for (const it of items) {
    if (it.condition && it.condition !== "ROUTE_EXISTS") continue;
    const seconds = it.duration ? parseInt(it.duration.replace("s", ""), 10) : NaN;
    matrix[it.originIndex][it.destinationIndex] = {
      durationSeconds: Number.isFinite(seconds) ? seconds : Number.POSITIVE_INFINITY,
      distanceMeters: it.distanceMeters ?? Number.POSITIVE_INFINITY,
    };
  }

  // Replace any remaining infinities with a haversine fallback so TSP can run.
  for (let i = 0; i < origins.length; i++) {
    for (let j = 0; j < destinations.length; j++) {
      if (!Number.isFinite(matrix[i][j].durationSeconds)) {
        const meters = haversineMeters(origins[i], destinations[j]);
        matrix[i][j] = {
          distanceMeters: meters,
          durationSeconds: meters / 11.1, // ~40 km/h fallback
        };
      }
    }
  }

  return matrix;
}

/**
 * Pure haversine fallback used when the Routes API is unavailable (e.g. the
 * API isn't enabled on the user's project). Assumes ~30 km/h average city
 * driving speed for ETA estimates — not as accurate as live traffic, but
 * good enough for clustering and TSP ordering.
 */
function haversineMatrix(points: LatLng[]): MatrixCell[][] {
  const AVG_SPEED_M_PER_S = 30_000 / 3600; // 30 km/h
  return points.map((from) =>
    points.map((to) => {
      const meters = haversineMeters(from, to);
      return {
        distanceMeters: meters,
        durationSeconds: meters / AVG_SPEED_M_PER_S,
      };
    }),
  );
}

/**
 * Builds a road-following polyline for the **outbound** leg only: depot → stops
 * in order → last customer (no return to depot). Uses Routes API `computeRoutes`.
 */
async function computeRoutesPolyline(
  depot: LatLng,
  viaStopsInOrder: LatLng[],
  apiKey: string,
): Promise<{ polyline: string; status?: string; errorMessage?: string }> {
  if (viaStopsInOrder.length === 0) return { polyline: "" };

  const url = "https://routes.googleapis.com/directions/v2:computeRoutes";
  const w = (p: LatLng) => ({
    location: { latLng: { latitude: p.lat, longitude: p.lng } },
  });

  const lastStop = viaStopsInOrder[viaStopsInOrder.length - 1];
  const intermediates =
    viaStopsInOrder.length > 1 ? viaStopsInOrder.slice(0, -1) : [];

  const body = {
    origin: w(depot),
    destination: w(lastStop),
    intermediates: intermediates.map(w),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    polylineQuality: "OVERVIEW",
  };

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.polyline.encodedPolyline",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const rawText = await r.text();

    if (!r.ok) {
      try {
        const errJson = JSON.parse(rawText) as {
          error?: { code?: number; message?: string; status?: string };
        };
        const msg = errJson.error?.message ?? rawText.slice(0, 400);
        return {
          polyline: "",
          status: errJson.error?.status ?? String(r.status),
          errorMessage: msg,
        };
      } catch {
        return {
          polyline: "",
          status: String(r.status),
          errorMessage: rawText.slice(0, 400),
        };
      }
    }

    const data = JSON.parse(rawText) as {
      routes?: Array<{ polyline?: { encodedPolyline?: string } }>;
    };
    const enc = data.routes?.[0]?.polyline?.encodedPolyline;
    if (!enc) {
      return {
        polyline: "",
        status: "NO_ROUTE",
        errorMessage: "Routes API returned no polyline (empty route).",
      };
    }
    return { polyline: enc };
  } catch (err) {
    return {
      polyline: "",
      errorMessage: err instanceof Error ? err.message : "Unknown error.",
    };
  }
}

// ---------- Main handler ----------

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing GOOGLE_MAPS_API_KEY." },
      { status: 500 },
    );
  }

  const baseAddress = process.env.NEXT_PUBLIC_BASE_LOCATION || "Hellinga 3";
  const region = process.env.NEXT_PUBLIC_REGION || undefined;

  let body: OptimizeRequestBody;
  try {
    body = (await req.json()) as OptimizeRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const driversRequested = Math.max(1, Math.floor(body.drivers || 1));
  const ordersIn = Array.isArray(body.orders) ? body.orders : [];
  const nowMs =
    typeof body.optimizeAtEpochMs === "number" &&
    Number.isFinite(body.optimizeAtEpochMs)
      ? body.optimizeAtEpochMs
      : Date.now();
  const rawMaxDel = Number(body.maxDeliveryMinutes);
  const maxDeliveryMinutes =
    Number.isFinite(rawMaxDel) && rawMaxDel > 0
      ? Math.min(120, Math.max(15, Math.floor(rawMaxDel)))
      : 40;

  if (ordersIn.length === 0) {
    return NextResponse.json(
      { error: "No orders to optimize." },
      { status: 400 },
    );
  }

  const warnings: string[] = [];

  try {
    // 1) Geocode the depot.
    const base = await geocodeAddress(baseAddress, apiKey, region);

    // 2) Ensure every order has coordinates (geocode any that don't).
    const geoOrders = await Promise.all(
      ordersIn.map(async (o) => {
        if (typeof o.lat === "number" && typeof o.lng === "number") {
          return { ...o, lat: o.lat, lng: o.lng };
        }
        const g = await geocodeAddress(o.address, apiKey, region);
        return { ...o, lat: g.location.lat, lng: g.location.lng };
      }),
    );

    // 3) Build a single travel-time + distance matrix over [depot, ...orders].
    //    The dispatch optimizer uses this to evaluate every candidate trip.
    const allPoints: LatLng[] = [
      base.location,
      ...geoOrders.map((o) => ({ lat: o.lat!, lng: o.lng! })),
    ];

    let matrix: MatrixCell[][];
    try {
      matrix = await computeRouteMatrix(allPoints, allPoints, apiKey);
    } catch (err) {
      if (
        err instanceof GoogleApiError &&
        (err.status === 403 ||
          err.reason === "SERVICE_DISABLED" ||
          err.reason === "API_KEY_SERVICE_BLOCKED")
      ) {
        warnings.push(
          `Routes API is not enabled on your Google Cloud project, so ETAs use a haversine estimate instead of live traffic. Enable it at ${err.enableUrl ?? "https://console.cloud.google.com/apis/library/routes.googleapis.com"} and reload.`,
        );
        matrix = haversineMatrix(allPoints);
      } else {
        throw err;
      }
    }

    const travelMatrix: number[][] = matrix.map((row) =>
      row.map((c) => c.durationSeconds),
    );
    const distMatrix: number[][] = matrix.map((row) =>
      row.map((c) => c.distanceMeters),
    );

    const orderTiming = buildDispatchOrderTiming(
      geoOrders,
      maxDeliveryMinutes,
      nowMs,
    );

    // 4) Run pizza-aware dispatch: candidate trips → set-partition DP → LPT.
    const dispatchResult = dispatch(
      geoOrders.length,
      travelMatrix,
      distMatrix,
      driversRequested,
      {
        serviceSeconds: SERVICE_TIME_SECONDS,
        freshnessWeight: FRESHNESS_WEIGHT,
        schedulePreferenceWeight: SCHEDULE_PREFERENCE_WEIGHT,
        timeWindowPenaltyWeight: TIME_WINDOW_PENALTY_WEIGHT,
        maxTripSize: MAX_TRIP_SIZE,
        maxInBagSeconds: MAX_IN_BAG_SECONDS,
        nowEpochMs: nowMs,
        orderTiming,
      },
    );

    // 5) Materialize routes, fetching one computeRoutes polyline per trip.
    const routes: DriverRoute[] = [];
    let nextTourIndex = 0;

    for (let dIdx = 0; dIdx < dispatchResult.driverTrips.length; dIdx++) {
      const driverTripList = dispatchResult.driverTrips[dIdx];
      const trips: Trip[] = [];
      let driverTotalSeconds = 0;
      let driverTotalMeters = 0;
      let driverTotalStops = 0;

      for (let tIdx = 0; tIdx < driverTripList.length; tIdx++) {
        const t = driverTripList[tIdx];

        // Build legs (depot + visited stops; return-to-depot is implied).
        const legs: RouteLeg[] = [
          {
            orderId: null,
            address: base.formattedAddress,
            location: base.location,
            travelSeconds: 0,
            travelMeters: 0,
            cumulativeSeconds: 0,
          },
        ];

        let prevMatrixIdx = 0;
        for (let si = 0; si < t.orderIndices.length; si++) {
          const visit = t.orderIndices[si];
          const stopMatrixIdx = visit + 1;
          const cell = matrix[prevMatrixIdx][stopMatrixIdx];
          legs.push({
            orderId: geoOrders[visit].id,
            address: geoOrders[visit].address,
            location: {
              lat: geoOrders[visit].lat!,
              lng: geoOrders[visit].lng!,
            },
            travelSeconds: cell.durationSeconds,
            travelMeters: cell.distanceMeters,
            cumulativeSeconds: t.cumulativeBagAtStop[si] ?? 0,
          });
          prevMatrixIdx = stopMatrixIdx;
        }

        // Road-following polyline: depot → stops → last stop (no return leg).
        const stopLocations = legs.slice(1).map((l) => l.location);
        const dir = await computeRoutesPolyline(base.location, stopLocations, apiKey);
        if (
          !dir.polyline &&
          dir.status &&
          !warnings.some((w) => w.startsWith("Route polylines"))
        ) {
          warnings.push(
            `Route polylines: computeRoutes returned ${dir.status}${dir.errorMessage ? `: ${dir.errorMessage}` : ""}. Lines are drawn straight between stops until the Routes API is enabled: https://console.cloud.google.com/apis/library/routes.googleapis.com`,
          );
        }

        const tourIndex = nextTourIndex++;
        const tourColor = colorForTour(tourIndex);

        trips.push({
          tourIndex,
          tripIndex: tIdx,
          color: tourColor,
          legs,
          durationSeconds: t.durationSeconds,
          distanceMeters: t.distanceMeters,
          polyline: dir.polyline,
          maxInBagSeconds: t.maxInBagSeconds,
        });

        driverTotalSeconds += t.durationSeconds;
        driverTotalMeters += t.distanceMeters;
        driverTotalStops += t.orderIndices.length;
      }

      routes.push({
        driverIndex: dIdx,
        trips,
        totalSeconds: driverTotalSeconds,
        totalMeters: driverTotalMeters,
        totalStops: driverTotalStops,
      });
    }

    const resp: OptimizeResponse = {
      base: { address: base.formattedAddress, location: base.location },
      plannedAtEpochMs: nowMs,
      routes,
      strategy: dispatchResult.strategy,
      serviceTimePerStopSeconds: SERVICE_TIME_SECONDS,
      config: {
        freshnessWeight: FRESHNESS_WEIGHT,
        maxTripSize: MAX_TRIP_SIZE,
        maxInBagSeconds: MAX_IN_BAG_SECONDS,
        maxDeliveryMinutes,
        scheduleWindowMinutes: SCHEDULE_WINDOW_MINUTES,
        schedulePreferenceWeight: SCHEDULE_PREFERENCE_WEIGHT,
        timeWindowPenaltyWeight: TIME_WINDOW_PENALTY_WEIGHT,
      },
      warnings: warnings.length ? warnings : undefined,
    };

    return NextResponse.json(resp);
  } catch (err) {
    if (err instanceof GoogleApiError) {
      const apiName = err.apiTitle || "A Google API";
      const enable = err.enableUrl ? ` Enable it at ${err.enableUrl}.` : "";
      return NextResponse.json(
        {
          error: `${apiName} is not enabled or returned ${err.status}: ${err.message}${enable}`,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Unknown error during optimization.",
      },
      { status: 500 },
    );
  }
}
