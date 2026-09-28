import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as geocode } from "@/app/api/geocode/route";
import { POST as optimize } from "@/app/api/optimize/route";
import { colorForTour } from "@/lib/colors";
import { haversineMeters } from "@/lib/optimizer";
import type { LatLng, OptimizeResponse } from "@/lib/types";

// ---------- helpers ----------

const DEPOT: LatLng = { lat: 59.9127, lng: 10.7461 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const geocodeOk = (loc: LatLng, formatted: string) =>
  json({
    status: "OK",
    results: [{ formatted_address: formatted, geometry: { location: loc } }],
  });

const permissionDenied = () =>
  json(
    {
      error: {
        code: 403,
        message: "Routes API has not been used in project 123 before or it is disabled.",
        status: "PERMISSION_DENIED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "SERVICE_DISABLED",
            metadata: { service: "routes.googleapis.com" },
          },
          {
            "@type": "type.googleapis.com/google.rpc.Help",
            links: [{ description: "Enable", url: "https://console.example/enable-routes" }],
          },
        ],
      },
    },
    403,
  );

interface FakeGoogle {
  geocodeTable?: Record<string, LatLng>;
  matrix?: "ok" | "disabled" | "error";
  routes?: "ok" | "disabled";
}

/** Minimal fake of the three Google endpoints the optimizer talks to. */
function fakeGoogle({ geocodeTable = {}, matrix = "ok", routes = "ok" }: FakeGoogle = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));

    if (url.pathname.endsWith("/geocode/json")) {
      const address = url.searchParams.get("address") ?? "";
      if (address === "Hellinga 3") return geocodeOk(DEPOT, "Hellinga 3, Oslo, Norway");
      const hit = geocodeTable[address];
      return hit ? geocodeOk(hit, `${address}, Oslo`) : json({ status: "ZERO_RESULTS", results: [] });
    }

    if (url.pathname.endsWith(":computeRouteMatrix")) {
      if (matrix === "disabled") return permissionDenied();
      if (matrix === "error") return json({ error: { message: "Backend exploded" } }, 500);
      const body = JSON.parse(String(init?.body));
      const pts: LatLng[] = body.origins.map(
        (o: { waypoint: { location: { latLng: { latitude: number; longitude: number } } } }) => ({
          lat: o.waypoint.location.latLng.latitude,
          lng: o.waypoint.location.latLng.longitude,
        }),
      );
      const items = pts.flatMap((a, i) =>
        pts.map((b, j) => {
          const m = haversineMeters(a, b);
          return {
            originIndex: i,
            destinationIndex: j,
            distanceMeters: Math.round(m),
            duration: `${Math.round(m / 8)}s`,
            condition: "ROUTE_EXISTS",
          };
        }),
      );
      return json(items);
    }

    if (url.pathname.endsWith(":computeRoutes")) {
      if (routes === "disabled") return permissionDenied();
      return json({ routes: [{ polyline: { encodedPolyline: "encoded_poly" } }] });
    }

    throw new Error(`Unexpected fetch to ${url}`);
  });
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
  vi.stubEnv("NEXT_PUBLIC_BASE_LOCATION", "Hellinga 3");
  vi.stubEnv("NEXT_PUBLIC_REGION", "NO");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ---------- /api/geocode ----------

describe("POST /api/geocode", () => {
  it("resolves an address to coordinates", async () => {
    const fetchMock = fakeGoogle({ geocodeTable: { "Storgata 1": { lat: 59.91, lng: 10.75 } } });
    vi.stubGlobal("fetch", fetchMock);

    const res = await geocode(post("/api/geocode", { address: "  Storgata 1 ", region: "NO" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      lat: 59.91,
      lng: 10.75,
      formattedAddress: "Storgata 1, Oslo",
    });
    const calledUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(calledUrl.searchParams.get("address")).toBe("Storgata 1");
    expect(calledUrl.searchParams.get("region")).toBe("no");
    expect(calledUrl.searchParams.get("key")).toBe("test-key");
  });

  it("reports a friendly message when nothing matches", async () => {
    vi.stubGlobal("fetch", fakeGoogle());
    const res = await geocode(post("/api/geocode", { address: "Nowhere 999" }));
    expect(await res.json()).toEqual({ ok: false, error: "No match for that address." });
  });

  it("rejects a missing address", async () => {
    const res = await geocode(post("/api/geocode", { address: "   " }));
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const res = await geocode(post("/api/geocode", "{oops"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid JSON/);
  });

  it("returns 502 when Google is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const res = await geocode(post("/api/geocode", { address: "Storgata 1" }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("ECONNRESET");
  });

  it("fails fast with 500 when the server key is not configured", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    const res = await geocode(post("/api/geocode", { address: "Storgata 1" }));
    expect(res.status).toBe(500);
  });
});

// ---------- /api/optimize ----------

const ORDERS = [
  { id: "o1", address: "Grønland 10", type: "ASAP", lat: 59.9123, lng: 10.7609 },
  { id: "o2", address: "Tøyen 4", type: "ASAP", lat: 59.9155, lng: 10.7712 },
  { id: "o3", address: "Majorstuen 2", type: "ASAP" }, // no coords → geocoded server-side
  { id: "o4", address: "Frogner 7", type: "Scheduled", scheduledFor: "2026-01-15T19:00", lat: 59.9179, lng: 10.7089 },
] as const;

const GEOCODE_TABLE = { "Majorstuen 2": { lat: 59.9297, lng: 10.7156 } };

describe("POST /api/optimize", () => {
  it("builds a complete dispatch plan from live Google data", async () => {
    const fetchMock = fakeGoogle({ geocodeTable: GEOCODE_TABLE });
    vi.stubGlobal("fetch", fetchMock);

    const res = await optimize(post("/api/optimize", { drivers: 2, orders: ORDERS }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as OptimizeResponse;

    expect(body.base.address).toBe("Hellinga 3, Oslo, Norway");
    expect(body.strategy).toBe("multi-trip");
    expect(body.routes).toHaveLength(2);
    expect(body.warnings).toBeUndefined();

    // Every order is delivered exactly once.
    const trips = body.routes.flatMap((r) => r.trips);
    const delivered = trips.flatMap((t) => t.legs.slice(1).map((l) => l.orderId));
    expect(delivered.sort()).toEqual(["o1", "o2", "o3", "o4"]);

    // Each trip starts at the depot, has a unique tour colour and a road polyline.
    trips.forEach((t) => {
      expect(t.legs[0]).toMatchObject({ orderId: null, location: DEPOT, cumulativeSeconds: 0 });
      expect(t.color).toBe(colorForTour(t.tourIndex));
      expect(t.polyline).toBe("encoded_poly");
    });
    expect(trips.map((t) => t.tourIndex).sort()).toEqual(trips.map((_, i) => i));

    // Driver totals add up.
    for (const r of body.routes) {
      expect(r.totalStops).toBe(r.trips.reduce((s, t) => s + t.legs.length - 1, 0));
      expect(r.totalSeconds).toBeCloseTo(r.trips.reduce((s, t) => s + t.durationSeconds, 0));
    }

    // The order without coordinates was geocoded; the others were not.
    const geocoded = fetchMock.mock.calls
      .map(([u]) => new URL(String(u)))
      .filter((u) => u.pathname.endsWith("/geocode/json"))
      .map((u) => u.searchParams.get("address"));
    expect(geocoded.sort()).toEqual(["Hellinga 3", "Majorstuen 2"]);

    // Traffic-aware routing was requested with the key in a header, not the URL.
    const matrixCall = fetchMock.mock.calls.find(([u]) => String(u).includes("computeRouteMatrix"))!;
    const init = matrixCall[1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("test-key");
    expect(JSON.parse(String(init.body)).routingPreference).toBe("TRAFFIC_AWARE");
  });

  it("gives each order its own driver when staffing allows", async () => {
    vi.stubGlobal("fetch", fakeGoogle({ geocodeTable: GEOCODE_TABLE }));
    const res = await optimize(post("/api/optimize", { drivers: 5, orders: ORDERS }));
    const body = (await res.json()) as OptimizeResponse;
    expect(body.strategy).toBe("one-per-driver");
    expect(body.routes.map((r) => r.totalStops)).toEqual([1, 1, 1, 1, 0]);
  });

  it.each([
    [undefined, 40],
    [5, 15],
    [55, 55],
    [500, 120],
  ])("clamps maxDeliveryMinutes=%s to %i", async (input, expected) => {
    vi.stubGlobal("fetch", fakeGoogle({ geocodeTable: GEOCODE_TABLE }));
    const res = await optimize(
      post("/api/optimize", { drivers: 1, orders: ORDERS.slice(0, 1), maxDeliveryMinutes: input }),
    );
    expect(((await res.json()) as OptimizeResponse).config.maxDeliveryMinutes).toBe(expected);
  });

  it("degrades gracefully to straight-line estimates when the Routes API is disabled", async () => {
    vi.stubGlobal(
      "fetch",
      fakeGoogle({ geocodeTable: GEOCODE_TABLE, matrix: "disabled", routes: "disabled" }),
    );

    const res = await optimize(post("/api/optimize", { drivers: 2, orders: ORDERS }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as OptimizeResponse;

    expect(body.warnings).toHaveLength(2);
    expect(body.warnings![0]).toMatch(/Routes API is not enabled.*haversine/);
    expect(body.warnings![0]).toContain("https://console.example/enable-routes");
    expect(body.warnings![1]).toMatch(/^Route polylines: computeRoutes returned PERMISSION_DENIED/);

    const trips = body.routes.flatMap((r) => r.trips);
    expect(trips.flatMap((t) => t.legs.slice(1)).length).toBe(4);
    expect(trips.every((t) => t.polyline === "" && t.durationSeconds > 0)).toBe(true);
  });

  it("surfaces unexpected Google failures as 502", async () => {
    vi.stubGlobal("fetch", fakeGoogle({ geocodeTable: GEOCODE_TABLE, matrix: "error" }));
    const res = await optimize(post("/api/optimize", { drivers: 1, orders: ORDERS }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("Backend exploded");
  });

  it("returns 500 with a clear message when an address cannot be geocoded", async () => {
    vi.stubGlobal("fetch", fakeGoogle()); // Majorstuen 2 is unknown
    const res = await optimize(post("/api/optimize", { drivers: 1, orders: ORDERS }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Majorstuen 2/);
  });

  it("rejects an empty queue", async () => {
    const res = await optimize(post("/api/optimize", { drivers: 1, orders: [] }));
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const res = await optimize(post("/api/optimize", "not json"));
    expect(res.status).toBe(400);
  });
});
