"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { Sidebar } from "@/components/Sidebar";
import { MapView } from "@/components/MapView";
import {
  loadDrivers,
  loadMaxDeliveryMinutes,
  loadOrders,
  saveDrivers,
  saveMaxDeliveryMinutes,
  saveOrders,
} from "@/lib/storage";
import type {
  AddOrderPayload,
  OptimizeResponse,
  Order,
} from "@/lib/types";

const REGION = process.env.NEXT_PUBLIC_REGION || "NO";
const PUBLIC_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function HomePage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [drivers, setDrivers] = useState<number>(1);
  const [maxDeliveryMinutes, setMaxDeliveryMinutes] = useState(40);
  const [hydrated, setHydrated] = useState(false);
  const [refocusToken, setRefocusToken] = useState(0);

  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  /** Bumped on each successful optimize so map overlays get fresh React keys (Polylines don't always clear). */
  const [optimizeRunId, setOptimizeRunId] = useState(0);
  /** Phones show one panel at a time; ignored at md+ where both are side by side. */
  const [mobileView, setMobileView] = useState<"orders" | "map">("orders");

  // Hydrate from localStorage on mount.
  useEffect(() => {
    setOrders(loadOrders());
    setDrivers(loadDrivers());
    setMaxDeliveryMinutes(loadMaxDeliveryMinutes());
    setHydrated(true);
  }, []);

  // Persist whenever state changes.
  useEffect(() => {
    if (hydrated) saveOrders(orders);
  }, [orders, hydrated]);
  useEffect(() => {
    if (hydrated) saveDrivers(drivers);
  }, [drivers, hydrated]);
  useEffect(() => {
    if (hydrated) saveMaxDeliveryMinutes(maxDeliveryMinutes);
  }, [maxDeliveryMinutes, hydrated]);

  // Geocode any orders that don't yet have coords.
  const inFlight = useRef<Set<string>>(new Set());
  useEffect(() => {
    const pending = orders.filter(
      (o) =>
        !o.lat &&
        !o.lng &&
        o.geocodeStatus !== "error" &&
        !inFlight.current.has(o.id),
    );
    if (pending.length === 0) return;

    pending.forEach((o) => inFlight.current.add(o.id));

    pending.forEach(async (o) => {
      try {
        const r = await fetch("/api/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: o.address, region: REGION }),
        });
        const data = await r.json();
        if (data.ok) {
          setOrders((prev) =>
            prev.map((p) =>
              p.id === o.id
                ? {
                    ...p,
                    lat: data.lat,
                    lng: data.lng,
                    formattedAddress: data.formattedAddress,
                    geocodeStatus: "ok",
                    geocodeError: undefined,
                  }
                : p,
            ),
          );
        } else {
          setOrders((prev) =>
            prev.map((p) =>
              p.id === o.id
                ? { ...p, geocodeStatus: "error", geocodeError: data.error }
                : p,
            ),
          );
        }
      } catch (err) {
        setOrders((prev) =>
          prev.map((p) =>
            p.id === o.id
              ? {
                  ...p,
                  geocodeStatus: "error",
                  geocodeError:
                    err instanceof Error ? err.message : "Network error.",
                }
              : p,
          ),
        );
      } finally {
        inFlight.current.delete(o.id);
      }
    });
  }, [orders]);

  const handleAddOrder = useCallback((payload: AddOrderPayload) => {
    const o: Order = {
      id: makeId(),
      address: payload.address,
      type: payload.type,
      scheduledFor:
        payload.type === "Scheduled" ? payload.scheduledFor : undefined,
      geocodeStatus: "pending",
      createdAt: Date.now(),
    };
    setOrders((prev) => [...prev, o]);
    setRefocusToken((t) => t + 1);
  }, []);

  const handleRemoveOrder = useCallback((id: string) => {
    setOrders((prev) => prev.filter((o) => o.id !== id));
    setResult(null);
    setRefocusToken((t) => t + 1);
  }, []);

  const handleClearOrders = useCallback(() => {
    setOrders([]);
    setResult(null);
    setRefocusToken((t) => t + 1);
  }, []);

  const handleChangeDrivers = useCallback((n: number) => {
    setDrivers(n);
    setResult(null);
  }, []);

  const handleMaxDeliveryChange = useCallback((n: number) => {
    setMaxDeliveryMinutes(n);
    setResult(null);
  }, []);

  const handleOptimize = useCallback(async () => {
    const ready = orders.filter(
      (o) => typeof o.lat === "number" && typeof o.lng === "number",
    );
    if (ready.length === 0) {
      setOptimizeError("No geocoded orders to optimize yet.");
      return;
    }
    const missingSchedule = ready.some(
      (o) => o.type === "Scheduled" && !o.scheduledFor?.trim(),
    );
    if (missingSchedule) {
      setOptimizeError("Every scheduled order needs a delivery date and time.");
      return;
    }
    setOptimizing(true);
    setOptimizeError(null);
    try {
      const r = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drivers,
          optimizeAtEpochMs: Date.now(),
          maxDeliveryMinutes,
          orders: ready.map((o) => ({
            id: o.id,
            address: o.formattedAddress || o.address,
            type: o.type,
            lat: o.lat,
            lng: o.lng,
            createdAt: o.createdAt,
            scheduledFor: o.scheduledFor,
          })),
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setOptimizeError(data.error || `Optimize failed (${r.status}).`);
        return;
      }
      setOptimizeRunId((id) => id + 1);
      setResult(data as OptimizeResponse);
      setMobileView("map");
    } catch (err) {
      setOptimizeError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setOptimizing(false);
    }
  }, [drivers, maxDeliveryMinutes, orders]);

  return (
    <main className="h-dvh w-screen flex flex-col overflow-hidden">
      <TopBar
        drivers={drivers}
        refocusToken={refocusToken}
        onAddOrder={handleAddOrder}
        onChangeDrivers={handleChangeDrivers}
      />

      <div className="flex-1 min-h-0 relative flex overflow-hidden">
        {/* On phones the sidebar overlays the map (kept mounted so it keeps its size). */}
        <div
          className={`${mobileView === "orders" ? "flex" : "hidden"} absolute inset-0 z-10 md:static md:z-auto md:flex`}
        >
          <Sidebar
            orders={orders}
            onRemoveOrder={handleRemoveOrder}
            onClearOrders={handleClearOrders}
            onOptimize={handleOptimize}
            optimizing={optimizing}
            optimizeError={optimizeError}
            result={result}
            maxDeliveryMinutes={maxDeliveryMinutes}
            onMaxDeliveryChange={handleMaxDeliveryChange}
          />
        </div>
        <div className="flex-1 relative bg-peppes-dark min-h-0">
          {PUBLIC_MAPS_KEY ? (
            <MapView
              apiKey={PUBLIC_MAPS_KEY}
              orders={orders}
              result={result}
              optimizeRunId={optimizeRunId}
            />
          ) : (
            <div className="h-full grid place-items-center text-peppes-subtle p-6 text-center">
              <div>
                <div className="text-base font-semibold text-white mb-1">
                  Map disabled.
                </div>
                <div className="text-sm">
                  Set <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> in{" "}
                  <code>.env.local</code> and restart the dev server.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <nav className="md:hidden shrink-0 grid grid-cols-2 border-t border-peppes-border bg-peppes-dark pb-[env(safe-area-inset-bottom)]">
        {(["orders", "map"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setMobileView(v)}
            className={`py-3 text-sm font-semibold transition ${
              mobileView === v ? "text-white border-t-2 border-peppes-red -mt-px" : "text-peppes-subtle"
            }`}
          >
            {v === "orders" ? `Orders (${orders.length})` : "Map"}
          </button>
        ))}
      </nav>
    </main>
  );
}
