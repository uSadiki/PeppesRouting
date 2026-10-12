import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as route } from "@/app/api/route/route";
import type { LatLng, TripRouteResponse } from "@/lib/types";

const DEPOT: LatLng = { lat: 59.8712, lng: 10.8078 };
const A: LatLng = { lat: 59.9123, lng: 10.7609 };
const B: LatLng = { lat: 59.9268, lng: 10.7242 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const post = (body: unknown) =>
  new NextRequest("http://localhost/api/route", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** Fake Geocoding + computeRoutes. `routes` decides how the Routes API behaves. */
function fakeGoogle(routes: "ok" | "disabled" = "ok") {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/geocode/json")) {
      return url.searchParams.get("address") === "Hellinga 3"
        ? json({
            status: "OK",
            results: [{ formatted_address: "Hellinga 3, 1151 Oslo", geometry: { location: DEPOT } }],
          })
        : json({ status: "ZERO_RESULTS", results: [] });
    }
    if (url.pathname.endsWith(":computeRoutes")) {
      if (routes === "disabled") {
        return json({ error: { code: 403, message: "Routes API has not been used", status: "PERMISSION_DENIED" } }, 403);
      }
      const body = JSON.parse(String(init?.body));
      const hops = body.intermediates.length + 1;
      return json({
        routes: [
          {
            legs: Array.from({ length: hops }, (_, i) => ({
              duration: `${(i + 1) * 100}s`,
              distanceMeters: (i + 1) * 1000,
              polyline: { encodedPolyline: `poly${i}` },
            })),
          },
        ],
      });
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

const routesCalls = (f: ReturnType<typeof fakeGoogle>) =>
  f.mock.calls.filter(([u]) => String(u).includes(":computeRoutes"));
const geocodeCalls = (f: ReturnType<typeof fakeGoogle>) =>
  f.mock.calls.filter(([u]) => String(u).includes("/geocode/json"));

describe("POST /api/route (manual trip builder)", () => {
  it("routes depot → stops in tapped order → back to depot, with live traffic", async () => {
    const f = fakeGoogle();
    vi.stubGlobal("fetch", f);

    const res = await route(post({ stops: [A, B] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as TripRouteResponse;

    expect(body.base).toEqual({ address: "Hellinga 3, 1151 Oslo", location: DEPOT });
    expect(body.legs).toEqual([
      { durationSeconds: 100, distanceMeters: 1000, polyline: "poly0" },
      { durationSeconds: 200, distanceMeters: 2000, polyline: "poly1" },
      { durationSeconds: 300, distanceMeters: 3000, polyline: "poly2" }, // drive back
    ]);
    expect(body.warning).toBeUndefined();

    const [, init] = routesCalls(f)[0];
    const sent = JSON.parse(String((init as RequestInit).body));
    const ll = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
    expect(sent.origin).toEqual(ll(DEPOT));
    expect(sent.destination).toEqual(ll(DEPOT));
    expect(sent.intermediates).toEqual([ll(A), ll(B)]);
    expect(sent.routingPreference).toBe("TRAFFIC_AWARE");
    expect((init as RequestInit).headers).toMatchObject({ "X-Goog-Api-Key": "test-key" });
  });

  it("geocodes the depot only once, not on every tap", async () => {
    const f = fakeGoogle();
    vi.stubGlobal("fetch", f);
    await route(post({ stops: [A] }));
    await route(post({ stops: [A, B] }));
    await route(post({ stops: [B] }));
    // At most one lookup (zero if an earlier request in this process cached it).
    expect(geocodeCalls(f).length).toBeLessThanOrEqual(1);
    expect(routesCalls(f)).toHaveLength(3);
  });

  it("returns just the depot for an empty trip without calling the Routes API", async () => {
    const f = fakeGoogle();
    vi.stubGlobal("fetch", f);
    const body = (await (await route(post({ stops: [] }))).json()) as TripRouteResponse;
    expect(body.base.location).toEqual(DEPOT);
    expect(body.legs).toEqual([]);
    expect(routesCalls(f)).toHaveLength(0);
  });

  it("falls back to straight-line estimates with a warning when the Routes API fails", async () => {
    vi.stubGlobal("fetch", fakeGoogle("disabled"));
    const res = await route(post({ stops: [A, B] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as TripRouteResponse;
    expect(body.warning).toMatch(/Road route unavailable.*Routes API 403/);
    expect(body.legs).toHaveLength(3);
    expect(body.legs.every((l) => l.polyline === "" && l.durationSeconds > 0)).toBe(true);
  });

  it("reports 502 when the depot address can't be found", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_LOCATION", "Nowhere 999");
    vi.stubGlobal("fetch", fakeGoogle());
    const res = await route(post({ stops: [A] }));
    expect(res.status).toBe(502);
  });

  it.each([
    ["malformed JSON", "{"],
    ["missing stops", {}],
    ["non-coordinate stops", { stops: [{ lat: "x", lng: 1 }] }],
    ["out-of-range coordinates", { stops: [{ lat: 95, lng: 10 }] }],
    ["more than 25 stops", { stops: Array.from({ length: 26 }, () => A) }],
  ])("rejects %s with 400", async (_label, body) => {
    vi.stubGlobal("fetch", fakeGoogle());
    expect((await route(post(body))).status).toBe(400);
  });

  it("fails fast when the server key is missing", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    expect((await route(post({ stops: [A] }))).status).toBe(500);
  });
});
