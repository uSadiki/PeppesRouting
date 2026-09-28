import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GeocodeOk {
  ok: true;
  lat: number;
  lng: number;
  formattedAddress: string;
}

interface GeocodeErr {
  ok: false;
  error: string;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json<GeocodeErr>(
      { ok: false, error: "Server is missing GOOGLE_MAPS_API_KEY." },
      { status: 500 },
    );
  }

  let address: string | undefined;
  let region: string | undefined;
  try {
    const body = await req.json();
    address = typeof body.address === "string" ? body.address.trim() : undefined;
    region = typeof body.region === "string" ? body.region : undefined;
  } catch {
    return NextResponse.json<GeocodeErr>(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  if (!address) {
    return NextResponse.json<GeocodeErr>(
      { ok: false, error: "Missing 'address'." },
      { status: 400 },
    );
  }

  const params = new URLSearchParams({ address, key: apiKey });
  if (region) params.set("region", region.toLowerCase());

  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;

  try {
    const r = await fetch(url, { cache: "no-store" });
    const data = (await r.json()) as {
      status: string;
      error_message?: string;
      results: Array<{
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
      }>;
    };

    if (data.status !== "OK" || data.results.length === 0) {
      return NextResponse.json<GeocodeErr>(
        {
          ok: false,
          error:
            data.error_message ||
            (data.status === "ZERO_RESULTS"
              ? "No match for that address."
              : `Geocoding failed (${data.status}).`),
        },
        { status: 200 },
      );
    }

    const top = data.results[0];
    return NextResponse.json<GeocodeOk>({
      ok: true,
      lat: top.geometry.location.lat,
      lng: top.geometry.location.lng,
      formattedAddress: top.formatted_address,
    });
  } catch (err) {
    return NextResponse.json<GeocodeErr>(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown geocoding error.",
      },
      { status: 502 },
    );
  }
}
