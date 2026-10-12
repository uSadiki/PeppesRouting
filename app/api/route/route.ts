import { NextRequest, NextResponse } from "next/server";
import { computeTripLegs, estimatedTripLegs, geocodeAddress } from "@/lib/google";
import type { LatLng, TripRouteRequestBody, TripRouteResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Routes API accepts at most 25 intermediate waypoints. */
const MAX_STOPS = 25;

// The depot never moves, so geocode it once per server process instead of on
// every tap in manual mode.
const depotCache = new Map<string, Promise<{ location: LatLng; formattedAddress: string }>>();

function geocodeDepot(address: string, apiKey: string, region?: string) {
  const key = `${address}|${region ?? ""}`;
  let hit = depotCache.get(key);
  if (!hit) {
    hit = geocodeAddress(address, apiKey, region);
    depotCache.set(key, hit);
    hit.catch(() => depotCache.delete(key)); // retry next time instead of caching a failure
  }
  return hit;
}

function isLatLng(v: unknown): v is LatLng {
  const p = v as LatLng;
  return (
    typeof p === "object" &&
    p !== null &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}

/** POST /api/route — road route for one hand-built trip (manual mode). */
export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Server is missing GOOGLE_MAPS_API_KEY." }, { status: 500 });
  }

  let body: TripRouteRequestBody;
  try {
    body = (await req.json()) as TripRouteRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const stops = body?.stops;
  if (!Array.isArray(stops) || !stops.every(isLatLng)) {
    return NextResponse.json({ error: "'stops' must be an array of {lat, lng}." }, { status: 400 });
  }
  if (stops.length > MAX_STOPS) {
    return NextResponse.json(
      { error: `A trip can have at most ${MAX_STOPS} stops.` },
      { status: 400 },
    );
  }

  const baseAddress = process.env.NEXT_PUBLIC_BASE_LOCATION || "Hellinga 3";
  const region = process.env.NEXT_PUBLIC_REGION || undefined;

  let base: { location: LatLng; formattedAddress: string };
  try {
    base = await geocodeDepot(baseAddress, apiKey, region);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not locate the depot." },
      { status: 502 },
    );
  }

  const resp: TripRouteResponse = {
    base: { address: base.formattedAddress, location: base.location },
    legs: [],
  };
  try {
    resp.legs = await computeTripLegs(base.location, stops, apiKey);
  } catch (err) {
    resp.legs = estimatedTripLegs(base.location, stops);
    resp.warning = `Road route unavailable (${
      err instanceof Error ? err.message : "unknown error"
    }); showing straight-line estimates.`;
  }
  return NextResponse.json(resp);
}
