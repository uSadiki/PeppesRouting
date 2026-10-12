import { haversineMeters } from "./optimizer";
import type { LatLng, TripLeg } from "./types";

/** Server-side Google Maps Platform helpers shared by the API routes. */

export async function geocodeAddress(
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

/** Same ~30 km/h city estimate the optimizer falls back to. */
const FALLBACK_SPEED_M_PER_S = 30_000 / 3600;

/** Straight-line legs depot → stops → depot, for when the Routes API is unavailable. */
export function estimatedTripLegs(depot: LatLng, stops: LatLng[]): TripLeg[] {
  const path = [depot, ...stops, depot];
  return path.slice(1).map((to, i) => {
    const meters = haversineMeters(path[i], to);
    return {
      durationSeconds: meters / FALLBACK_SPEED_M_PER_S,
      distanceMeters: meters,
      polyline: "",
    };
  });
}

/**
 * Road route for one hand-built trip: depot → stops (in the given order) →
 * depot, with live traffic. Returns one leg per hop, so `stops.length + 1`
 * legs where the last one is the drive back to the depot.
 */
export async function computeTripLegs(
  depot: LatLng,
  stops: LatLng[],
  apiKey: string,
): Promise<TripLeg[]> {
  if (stops.length === 0) return [];

  const w = (p: LatLng) => ({
    location: { latLng: { latitude: p.lat, longitude: p.lng } },
  });
  const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "routes.legs.duration,routes.legs.distanceMeters,routes.legs.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: w(depot),
      destination: w(depot),
      intermediates: stops.map(w),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      polylineQuality: "OVERVIEW",
    }),
    cache: "no-store",
  });

  const raw = await r.text();
  if (!r.ok) {
    let message = raw.slice(0, 300);
    try {
      message = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      // keep the raw snippet
    }
    throw new Error(`Routes API ${r.status}: ${message}`);
  }

  const data = JSON.parse(raw) as {
    routes?: Array<{
      legs?: Array<{
        duration?: string;
        distanceMeters?: number;
        polyline?: { encodedPolyline?: string };
      }>;
    }>;
  };
  const legs = data.routes?.[0]?.legs ?? [];
  if (legs.length !== stops.length + 1) {
    throw new Error("Routes API returned no route for these stops.");
  }
  return legs.map((l) => ({
    durationSeconds: l.duration ? Number.parseInt(l.duration, 10) || 0 : 0,
    distanceMeters: l.distanceMeters ?? 0,
    polyline: l.polyline?.encodedPolyline ?? "",
  }));
}
