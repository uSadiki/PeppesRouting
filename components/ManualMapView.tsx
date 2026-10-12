"use client";

import { useEffect, useMemo, useState } from "react";
import { GoogleMap, MarkerF, PolylineF, useJsApiLoader } from "@react-google-maps/api";
import { colorForTour, inkFor } from "@/lib/colors";
import { FALLBACK_CENTER, darkMapStyle, decodePolyline } from "@/lib/map-utils";
import { formatMinutes, summarizeTrip, tripColor } from "@/lib/manual-trips";
import type { ManualTripsState } from "@/lib/use-manual-trips";
import type { LatLng, Order, TripLeg } from "@/lib/types";

interface Props {
  apiKey: string;
  orders: Order[];
  manual: ManualTripsState;
}

const containerStyle = { width: "100%", height: "100%" };
/** Hot-bag limit the optimizer uses — over this, the coldest-pizza figure turns amber. */
const BAG_WARN_SECONDS = 20 * 60;

/** Road path for one leg, or a straight segment while the route is unknown. */
function legPath(leg: TripLeg | undefined, from: LatLng, to: LatLng): LatLng[] {
  return leg?.polyline ? decodePolyline(leg.polyline) : [from, to];
}

function dot(fill: string, scale: number, strokeWeight = 2): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale,
    fillColor: fill,
    fillOpacity: 1,
    strokeColor: "white",
    strokeWeight,
  };
}

export function ManualMapView({ apiKey, orders, manual }: Props) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: "peppes-google-map",
    googleMapsApiKey: apiKey,
  });
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const { trips, draft, draftLegs, draftColorIndex, routing, depot, warning, assigned } = manual;

  const located = useMemo(
    () => orders.filter((o) => typeof o.lat === "number" && typeof o.lng === "number"),
    [orders],
  );
  const posOf = useMemo(
    () => new Map(located.map((o) => [o.id, { lat: o.lat!, lng: o.lng! }])),
    [located],
  );
  /** Queue position (1-based) — the same number the order list shows. */
  const queueNo = useMemo(() => new Map(orders.map((o, i) => [o.id, i + 1])), [orders]);
  const draftColor = colorForTour(draftColorIndex);
  // Stable reference: GoogleMap re-pans whenever `center` changes identity,
  // which would yank the map around on every tap.
  const depotLat = depot?.location.lat;
  const depotLng = depot?.location.lng;
  const center = useMemo(
    () => (depotLat !== undefined && depotLng !== undefined ? { lat: depotLat, lng: depotLng } : FALLBACK_CENTER),
    [depotLat, depotLng],
  );
  const draftSummary = draftLegs ? summarizeTrip(draftLegs) : null;

  // Fit everything once per new set of addresses — not on every tap.
  const fitKey = `${depot ? "d" : ""}${located.map((o) => o.id).join(",")}`;
  useEffect(() => {
    if (!map) return;
    const bounds = new google.maps.LatLngBounds();
    if (depot) bounds.extend(depot.location);
    located.forEach((o) => bounds.extend({ lat: o.lat!, lng: o.lng! }));
    if (bounds.isEmpty()) return;
    map.fitBounds(bounds, { top: 60, left: 40, right: 40, bottom: 230 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the address set changes
  }, [map, fitKey]);

  if (loadError) {
    return (
      <div className="h-full grid place-items-center text-peppes-subtle p-6 text-center text-sm">
        Could not load Google Maps.
      </div>
    );
  }
  if (!isLoaded) {
    return (
      <div className="h-full grid place-items-center text-peppes-subtle text-sm">Loading map…</div>
    );
  }

  // Outbound path depot → stops for a trip (return leg handled separately).
  const outbound = (ids: string[], legs: TripLeg[] | null): LatLng[][] => {
    if (!depot) return [];
    const pts = [depot.location, ...ids.map((id) => posOf.get(id)!).filter(Boolean)];
    return pts.slice(1).map((to, i) => legPath(legs?.[i], pts[i], to));
  };
  const lastDraft = draft.length ? posOf.get(draft[draft.length - 1]) : undefined;

  return (
    <div className="h-full w-full relative">
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={12}
        onLoad={setMap}
        onUnmount={() => setMap(null)}
        options={{
          styles: darkMapStyle,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
          backgroundColor: "#0E0E10",
          clickableIcons: false,
        }}
      >
        {depot && (
          <MarkerF
            position={depot.location}
            label={{ text: "P", color: "white", fontWeight: "700", fontSize: "12px" }}
            icon={dot("#D32027", 11)}
            // Below the delivery dots and not tappable, so customers right by
            // the store can still be picked.
            zIndex={40}
            clickable={false}
          />
        )}

        {/* Saved trips: outbound road route in the trip's colour. */}
        {trips.map((t) =>
          outbound(t.orderIds, t.legs).map((path, i) => (
            <PolylineF
              key={`${t.id}-${i}-${t.legs ? "road" : "est"}`}
              path={path}
              options={{ strokeColor: tripColor(t), strokeOpacity: 0.6, strokeWeight: 5, zIndex: 5 }}
            />
          )),
        )}

        {/* Trip being built: bright outbound route + dashed drive back. */}
        {outbound(draft, draftLegs).map((path, i) => (
          <PolylineF
            key={`draft-${draft.slice(0, i + 1).join(",")}-${draftLegs ? "road" : "est"}`}
            path={path}
            options={{
              strokeColor: draftColor,
              strokeOpacity: draftLegs ? 1 : 0.5,
              strokeWeight: draftLegs ? 7 : 4,
              zIndex: 20,
            }}
          />
        ))}
        {depot && lastDraft && (
          <PolylineF
            key={`draft-return-${draft.join(",")}-${draftLegs ? "road" : "est"}`}
            path={legPath(draftLegs?.[draft.length], lastDraft, depot.location)}
            options={{
              strokeOpacity: 0,
              zIndex: 19,
              icons: [
                {
                  icon: { path: "M 0,-1 0,1", strokeOpacity: 0.7, strokeColor: draftColor, scale: 3 },
                  offset: "0",
                  repeat: "14px",
                },
              ],
            }}
          />
        )}

        {/* Stops in saved trips — numbered trip.stop, like the auto plan. */}
        {trips.flatMap((t) =>
          t.orderIds.map((id, i) =>
            posOf.has(id) ? (
              <MarkerF
                key={`saved-${t.id}-${id}`}
                position={posOf.get(id)!}
                label={{
                  text: `${t.colorIndex + 1}.${i + 1}`,
                  color: inkFor(tripColor(t)),
                  fontWeight: "700",
                  fontSize: "10px",
                }}
                icon={dot(tripColor(t), 12, 1.5)}
                zIndex={50}
                title={`Trip ${t.colorIndex + 1}, stop ${i + 1} — use Edit in the list to change it`}
              />
            ) : null,
          ),
        )}

        {/* Free orders (grey) and stops in the trip being built (numbered in visit order). */}
        {located
          .filter((o) => !assigned.has(o.id))
          .map((o) => {
            const seq = draft.indexOf(o.id);
            const picked = seq >= 0;
            return (
              <MarkerF
                key={`free-${o.id}`}
                position={{ lat: o.lat!, lng: o.lng! }}
                onClick={() => manual.tapStop(o.id)}
                label={{
                  text: picked ? String(seq + 1) : String(queueNo.get(o.id)),
                  color: picked ? inkFor(draftColor) : "#0E0E10",
                  fontWeight: "800",
                  fontSize: picked ? "14px" : "11px",
                }}
                icon={picked ? dot(draftColor, 15, 3) : dot("#C9C9D3", 12, 2)}
                zIndex={picked ? 200 : 100}
                title={`${o.formattedAddress || o.address}\n${picked ? "Tap to remove from trip" : "Tap to add to trip"}`}
              />
            );
          })}
      </GoogleMap>

      {/* Trip builder */}
      <div className="absolute left-3 right-3 bottom-3 md:left-4 md:right-auto md:w-[380px] bg-peppes-dark/95 backdrop-blur border border-peppes-border rounded-xl shadow-2xl">
        <div className="px-3.5 pt-3 pb-2 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: draftColor }} />
          <span className="text-sm font-bold">Trip {draftColorIndex + 1}</span>
          <span className="text-[11px] text-peppes-subtle">
            {draft.length === 0
              ? "· tap stops on the map"
              : `· ${draft.length} stop${draft.length === 1 ? "" : "s"}`}
          </span>
          {routing && <span className="ml-auto text-[11px] text-peppes-subtle">Finding route…</span>}
        </div>

        {draft.length === 0 ? (
          <p className="px-3.5 pb-3 text-[12px] text-peppes-subtle leading-snug">
            {located.some((o) => !assigned.has(o.id))
              ? "Tap the grey dots in the order the driver should deliver them. The road route lights up as you go, so you can spot stops along the way."
              : located.length
                ? "Every order is in a trip."
                : "Add addresses above — they show up here as dots."}
          </p>
        ) : (
          <>
            <ol className="px-3.5 max-h-28 overflow-y-auto thin-scroll space-y-0.5">
              {draft.map((id, i) => {
                const o = orders.find((x) => x.id === id);
                const t = draftSummary?.arrivalSeconds[i];
                return (
                  <li key={id} className="flex items-baseline gap-2 text-[12px]">
                    <span className="font-bold tabular-nums w-4 shrink-0" style={{ color: draftColor }}>
                      {i + 1}
                    </span>
                    <span className="truncate flex-1">
                      {(o?.formattedAddress || o?.address || "").split(",")[0]}
                    </span>
                    <span className="text-peppes-subtle tabular-nums shrink-0">
                      {t !== undefined ? formatMinutes(t) : "…"}
                    </span>
                  </li>
                );
              })}
            </ol>
            {draftSummary && (
              <div className="px-3.5 pt-1.5 text-[11px] text-peppes-subtle flex flex-wrap gap-x-2">
                <span>
                  Back at depot <b className="text-white tabular-nums">{formatMinutes(draftSummary.roundTripSeconds)}</b>
                </span>
                <span>· {(draftSummary.distanceMeters / 1000).toFixed(1)} km</span>
                <span className={draftSummary.coldestSeconds > BAG_WARN_SECONDS ? "text-amber-300" : ""}>
                  · last pizza {formatMinutes(draftSummary.coldestSeconds)} in bag
                </span>
              </div>
            )}
            <div className="p-3 pt-2.5 flex gap-2">
              <button
                type="button"
                onClick={manual.undoStop}
                className="px-3 py-2 rounded-lg bg-peppes-panel border border-peppes-border text-[13px] font-semibold"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={manual.clearDraft}
                className="px-3 py-2 rounded-lg bg-peppes-panel border border-peppes-border text-[13px] font-semibold"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={manual.saveDraft}
                className="flex-1 py-2 rounded-lg text-[13px] font-bold"
                style={{ backgroundColor: draftColor, color: inkFor(draftColor) }}
              >
                Save trip {draftColorIndex + 1}
              </button>
            </div>
          </>
        )}
        {warning && (
          <p className="px-3.5 pb-2.5 -mt-1 text-[11px] text-amber-300 leading-snug">{warning}</p>
        )}
      </div>
    </div>
  );
}
