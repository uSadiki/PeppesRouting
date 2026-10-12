"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { makeId } from "./ids";
import { assignedOrderIds, nextColorIndex, pruneTrips, toggleStop } from "./manual-trips";
import { loadManualTrips, saveManualTrips } from "./storage";
import type { LatLng, ManualTrip, Order, TripLeg, TripRouteResponse } from "./types";

/** Wait for a short pause in tapping before asking Google for the route. */
const ROUTE_DEBOUNCE_MS = 250;

async function fetchTripRoute(stops: LatLng[], signal?: AbortSignal): Promise<TripRouteResponse> {
  const r = await fetch("/api/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stops }),
    signal,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `Route failed (${r.status}).`);
  return data as TripRouteResponse;
}

const keyOf = (ids: string[]) => ids.join("|");

/**
 * State for manual mode: saved trips, the trip being built by tapping stops,
 * and its live road route. `ordersHydrated` must be true before saved trips
 * are reconciled against the queue, or an empty initial queue would wipe them.
 */
export function useManualTrips(orders: Order[], active: boolean, ordersHydrated: boolean) {
  const [trips, setTrips] = useState<ManualTrip[]>([]);
  const [tripsLoaded, setTripsLoaded] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  /** Trip number being edited, so it keeps its number and colour when re-saved. */
  const [editingColorIndex, setEditingColorIndex] = useState<number | null>(null);
  const [draftRoute, setDraftRoute] = useState<{ key: string; legs: TripLeg[] } | null>(null);
  const [routing, setRouting] = useState(false);
  const [depot, setDepot] = useState<TripRouteResponse["base"] | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const located = useMemo(
    () =>
      new Map(
        orders
          .filter((o) => typeof o.lat === "number" && typeof o.lng === "number")
          .map((o) => [o.id, { lat: o.lat!, lng: o.lng! }]),
      ),
    [orders],
  );
  // Read through a ref so adding an unrelated order doesn't cancel a route request.
  const locatedRef = useRef(located);
  locatedRef.current = located;
  const stopsFor = (ids: string[]): LatLng[] | null => {
    const pts = ids.map((id) => locatedRef.current.get(id));
    return pts.every(Boolean) ? (pts as LatLng[]) : null;
  };

  useEffect(() => {
    setTrips(loadManualTrips());
    setTripsLoaded(true);
  }, []);
  useEffect(() => {
    if (tripsLoaded) saveManualTrips(trips);
  }, [trips, tripsLoaded]);

  // Orders that leave the queue (delivered / deleted) leave their trips too.
  useEffect(() => {
    if (!ordersHydrated || !tripsLoaded) return;
    const live = new Set(orders.map((o) => o.id));
    setTrips((t) => pruneTrips(t, live));
    setDraft((d) => {
      const kept = d.filter((id) => located.has(id));
      return kept.length === d.length ? d : kept;
    });
  }, [orders, located, ordersHydrated, tripsLoaded]);

  // Depot pin as soon as manual mode opens, before any stop is tapped.
  useEffect(() => {
    if (!active || depot) return;
    const ctrl = new AbortController();
    fetchTripRoute([], ctrl.signal)
      .then((r) => setDepot((d) => d ?? r.base))
      .catch((e) => {
        if (!ctrl.signal.aborted) setWarning(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, [active, depot]);

  // Light up the road route for the trip being built.
  const draftKey = keyOf(draft);
  const draftLegs = draftRoute?.key === draftKey ? draftRoute.legs : null;
  useEffect(() => {
    if (!active || draft.length === 0 || draftRoute?.key === draftKey) {
      setRouting(false);
      return;
    }
    const stops = stopsFor(draft);
    if (!stops) return;
    const ctrl = new AbortController();
    setRouting(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetchTripRoute(stops, ctrl.signal);
        setDepot((d) => d ?? r.base);
        setDraftRoute({ key: draftKey, legs: r.legs });
        setWarning(r.warning ?? null);
      } catch (e) {
        if (!ctrl.signal.aborted) setWarning(e instanceof Error ? e.message : String(e));
      } finally {
        if (!ctrl.signal.aborted) setRouting(false);
      }
    }, ROUTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on draftKey; stops read via ref
  }, [active, draftKey, draftRoute?.key]);

  // Saved trips that lost a stop (or were saved mid-request) get a fresh route.
  const stale = trips.find((t) => t.legs === null);
  const staleKey = stale ? `${stale.id}:${keyOf(stale.orderIds)}` : "";
  useEffect(() => {
    if (!active || !stale) return;
    const stops = stopsFor(stale.orderIds);
    if (!stops) return;
    const ctrl = new AbortController();
    fetchTripRoute(stops, ctrl.signal)
      .then((r) => {
        setDepot((d) => d ?? r.base);
        setTrips((ts) =>
          ts.map((t) =>
            t.id === stale.id && keyOf(t.orderIds) === keyOf(stale.orderIds)
              ? { ...t, legs: r.legs }
              : t,
          ),
        );
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setWarning(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on staleKey
  }, [active, staleKey]);

  const assigned = useMemo(() => assignedOrderIds(trips), [trips]);
  const draftColorIndex =
    editingColorIndex !== null && !trips.some((t) => t.colorIndex === editingColorIndex)
      ? editingColorIndex
      : nextColorIndex(trips);

  const tapStop = useCallback(
    (orderId: string) => {
      if (assigned.has(orderId) || !located.has(orderId)) return;
      setDraft((d) => toggleStop(d, orderId));
    },
    [assigned, located],
  );

  const undoStop = useCallback(() => setDraft((d) => d.slice(0, -1)), []);

  const clearDraft = useCallback(() => {
    setDraft([]);
    setEditingColorIndex(null);
  }, []);

  const saveDraft = useCallback(() => {
    if (draft.length === 0) return;
    setTrips((ts) => [
      ...ts,
      { id: makeId(), orderIds: draft, colorIndex: draftColorIndex, legs: draftLegs },
    ]);
    setDraft([]);
    setEditingColorIndex(null);
  }, [draft, draftColorIndex, draftLegs]);

  /** Moves a saved trip back into the builder. Only allowed while the builder is empty. */
  const editTrip = useCallback(
    (colorIndex: number) => {
      if (draft.length > 0) return;
      const t = trips.find((x) => x.colorIndex === colorIndex);
      if (!t) return;
      setTrips((ts) => ts.filter((x) => x.id !== t.id));
      setDraft(t.orderIds);
      setEditingColorIndex(t.colorIndex);
      if (t.legs) setDraftRoute({ key: keyOf(t.orderIds), legs: t.legs });
    },
    [draft.length, trips],
  );

  const ungroupTrip = useCallback((colorIndex: number) => {
    setTrips((ts) => ts.filter((t) => t.colorIndex !== colorIndex));
  }, []);

  return {
    trips,
    draft,
    draftLegs,
    draftColorIndex,
    routing,
    depot,
    warning,
    assigned,
    tapStop,
    undoStop,
    clearDraft,
    saveDraft,
    editTrip,
    ungroupTrip,
  };
}

export type ManualTripsState = ReturnType<typeof useManualTrips>;
