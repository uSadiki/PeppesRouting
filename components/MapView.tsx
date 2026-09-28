"use client";

import { useEffect, useMemo, useRef } from "react";
import { GoogleMap, Marker, Polyline, useJsApiLoader } from "@react-google-maps/api";
import type { OptimizeResponse, Order } from "@/lib/types";

interface Props {
  apiKey: string;
  orders: Order[];
  result: OptimizeResponse | null;
  /** Increments on each successful optimize — forces Polyline/Marker remount. */
  optimizeRunId: number;
}

const containerStyle = { width: "100%", height: "100%" };

const FALLBACK_CENTER = { lat: 59.9139, lng: 10.7522 }; // Oslo

const darkStyle: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#16161b" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#16161b" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9a9aa8" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#26262e" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#22232a" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1a1b21" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2c2d36" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0b0c10" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3a3b45" }] },
];

/**
 * Decodes an encoded polyline string into an array of lat/lng points.
 * Implementation of Google's polyline algorithm.
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
function decodePolyline(encoded: string): { lat: number; lng: number }[] {
  const points: { lat: number; lng: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

export function MapView({ apiKey, orders, result, optimizeRunId }: Props) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: "peppes-google-map",
    googleMapsApiKey: apiKey,
  });

  const mapRef = useRef<google.maps.Map | null>(null);

  // One decoded polyline per trip: depot → stops only (no return leg to depot).
  const decodedTrips = useMemo(() => {
    if (!result) return [];
    return result.routes.flatMap((r) =>
      r.trips.map((t) => ({
        color: t.color,
        tourIndex: t.tourIndex,
        driverIndex: r.driverIndex,
        tripIndex: t.tripIndex,
        path:
          t.polyline && t.polyline.length > 0
            ? decodePolyline(t.polyline)
            : [
                result.base.location,
                ...t.legs.slice(1).map((l) => l.location),
              ],
      })),
    );
  }, [result]);

  const tourLegend = useMemo(() => {
    if (!result) return [];
    const rows: Array<{
      tourIndex: number;
      color: string;
      durationMin: number;
      driverIndex: number;
    }> = [];
    for (const r of result.routes) {
      for (const t of r.trips) {
        rows.push({
          tourIndex: t.tourIndex,
          color: t.color,
          durationMin: Math.round(t.durationSeconds / 60),
          driverIndex: r.driverIndex,
        });
      }
    }
    rows.sort((a, b) => a.tourIndex - b.tourIndex);
    return rows;
  }, [result]);

  // Customer stop markers: color follows tour (not driver).
  /** Order ids that appear in the last successful plan (not "pending" new adds). */
  const plannedOrderIds = useMemo(() => {
    if (!result) return new Set<string>();
    const ids = new Set<string>();
    for (const r of result.routes) {
      for (const t of r.trips) {
        for (const l of t.legs) {
          if (l.orderId) ids.add(l.orderId);
        }
      }
    }
    return ids;
  }, [result]);

  /** Geocoded orders not yet in the last plan — grey pins until next optimize. */
  const pendingPlanMarkers = useMemo(() => {
    if (!result) return [];
    return orders.filter(
      (o) =>
        o.geocodeStatus === "ok" &&
        typeof o.lat === "number" &&
        typeof o.lng === "number" &&
        !plannedOrderIds.has(o.id),
    );
  }, [orders, result, plannedOrderIds]);

  const stopMarkers = useMemo(() => {
    if (!result) return [];
    const markers: Array<{
      key: string;
      position: { lat: number; lng: number };
      label: string;
      color: string;
      strokeWeight: number;
      scale: number;
      title: string;
    }> = [];
    for (const r of result.routes) {
      for (const t of r.trips) {
        let stopInTour = 0;
        const nStops = t.legs.filter((l) => l.orderId !== null).length;
        for (const leg of t.legs) {
          if (leg.orderId === null) continue;
          stopInTour++;
          markers.push({
            key: `${t.tourIndex}-${leg.orderId}`,
            position: leg.location,
            label: `${t.tourIndex + 1}.${stopInTour}`,
            color: t.color,
            strokeWeight: nStops > 1 ? 2.5 : 1.5,
            scale: nStops > 1 ? 12 : 10,
            title: `Tour ${t.tourIndex + 1} · stop ${stopInTour}/${nStops}\nDriver ${r.driverIndex + 1}\n${leg.address}\n~${Math.round(leg.cumulativeSeconds / 60)} min in bag`,
          });
        }
      }
    }
    return markers;
  }, [result]);

  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const bounds = new google.maps.LatLngBounds();
    let added = false;

    if (result) {
      bounds.extend(result.base.location);
      added = true;
      const planned = new Set<string>();
      for (const r of result.routes) {
        for (const t of r.trips) {
          for (const l of t.legs) {
            if (l.orderId) planned.add(l.orderId);
            bounds.extend(l.location);
            added = true;
          }
        }
      }
      for (const o of orders) {
        if (planned.has(o.id)) continue;
        if (typeof o.lat === "number" && typeof o.lng === "number") {
          bounds.extend({ lat: o.lat, lng: o.lng });
          added = true;
        }
      }
    } else {
      for (const o of orders) {
        if (typeof o.lat === "number" && typeof o.lng === "number") {
          bounds.extend({ lat: o.lat, lng: o.lng });
          added = true;
        }
      }
    }

    if (added) {
      map.fitBounds(bounds, 80);
    }
  }, [isLoaded, orders, result]);

  if (loadError) {
    return (
      <div className="h-full w-full grid place-items-center text-peppes-subtle p-6 text-center">
        <div>
          <div className="text-base font-semibold text-white mb-1">
            Could not load Google Maps.
          </div>
          <div className="text-sm">
            Check that <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> is set and the key has the
            Maps JavaScript API enabled.
          </div>
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="h-full w-full grid place-items-center text-peppes-subtle">
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-block w-2 h-2 rounded-full bg-peppes-red live-dot" />
          Loading map…
        </div>
      </div>
    );
  }

  const firstGeo = orders.find(
    (o) => typeof o.lat === "number" && typeof o.lng === "number",
  );
  const center = result?.base.location
    ? result.base.location
    : firstGeo
      ? { lat: firstGeo.lat!, lng: firstGeo.lng! }
      : FALLBACK_CENTER;

  // Remount the map when routes are cleared vs shown, and on each successful optimize.
  // Otherwise @react-google-maps/api Polylines often stay drawn after React unmounts them.
  const googleMapInstanceKey = `peppes-gmap-${optimizeRunId}-${result ? "routes" : "plain"}`;

  return (
    <div className="h-full w-full relative">
      <GoogleMap
        key={googleMapInstanceKey}
        mapContainerStyle={containerStyle}
        center={center}
        zoom={13}
        onLoad={(m) => {
          mapRef.current = m;
        }}
        options={{
          styles: darkStyle,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
          backgroundColor: "#0E0E10",
        }}
      >
        {/* Depot marker */}
        {result && (
          <Marker
            key={`depot-${optimizeRunId}`}
            position={result.base.location}
            label={{
              text: "P",
              color: "white",
              fontWeight: "700",
              fontSize: "12px",
            }}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: 11,
              fillColor: "#D32027",
              fillOpacity: 1,
              strokeColor: "white",
              strokeWeight: 2,
            }}
            zIndex={1000}
          />
        )}

        {/* Pre-optimization markers (just the geocoded orders) */}
        {!result &&
          orders
            .filter((o) => typeof o.lat === "number" && typeof o.lng === "number")
            .map((o, i) => (
              <Marker
                key={o.id}
                position={{ lat: o.lat!, lng: o.lng! }}
                label={{
                  text: String(i + 1),
                  color: "white",
                  fontWeight: "700",
                  fontSize: "11px",
                }}
                icon={{
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 9,
                  fillColor: "#9A9AA8",
                  fillOpacity: 1,
                  strokeColor: "white",
                  strokeWeight: 1.5,
                }}
              />
            ))}

        {/* One polyline per tour (depot → stops only). */}
        {decodedTrips.map((t) => (
          <Polyline
            key={`${optimizeRunId}-tour-${t.tourIndex}`}
            path={t.path}
            options={{
              strokeColor: t.color,
              strokeOpacity: 0.92,
              strokeWeight: 6,
              zIndex: 5,
              geodesic: false,
            }}
          />
        ))}

        {/* Pins on top — label matches sidebar (e.g. 2.1 = tour 2, stop 1) */}
        {pendingPlanMarkers.map((o) => (
          <Marker
            key={`${optimizeRunId}-pending-${o.id}`}
            position={{ lat: o.lat!, lng: o.lng! }}
            zIndex={80}
            title={`Not in last plan — press Optimize to route\n${o.formattedAddress || o.address}`}
            label={{
              text: "+",
              color: "white",
              fontWeight: "700",
              fontSize: "11px",
            }}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: 9,
              fillColor: "#9A9AA8",
              fillOpacity: 1,
              strokeColor: "white",
              strokeWeight: 1.5,
            }}
          />
        ))}

        {stopMarkers.map((m) => (
          <Marker
            key={`${optimizeRunId}-${m.key}`}
            position={m.position}
            zIndex={100}
            label={{
              text: m.label,
              color: "white",
              fontWeight: "700",
              fontSize: m.label.length > 3 ? "9px" : "11px",
            }}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: m.scale,
              fillColor: m.color,
              fillOpacity: 1,
              strokeColor: "white",
              strokeWeight: m.strokeWeight,
            }}
            title={m.title}
          />
        ))}
      </GoogleMap>

      {/* Legend overlay */}
      {result && tourLegend.length > 0 && (
        <div className="absolute bottom-4 left-4 bg-peppes-dark/85 backdrop-blur border border-peppes-border rounded-lg px-3 py-2 text-[11px] space-y-1 max-w-[300px]">
          <div className="text-peppes-subtle uppercase tracking-wider font-medium mb-0.5">
            Tours
          </div>
          {tourLegend.map((row) => (
            <div key={row.tourIndex} className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: row.color }}
              />
              <span className="font-semibold">Tour {row.tourIndex + 1}</span>
              <span className="text-peppes-subtle">· D{row.driverIndex + 1}</span>
              <span className="text-peppes-subtle ml-auto tabular-nums">
                {row.durationMin} min
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
