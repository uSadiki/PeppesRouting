"use client";

import { useMemo } from "react";
import { OrdersList } from "./OrdersList";
import type { Order, OptimizeResponse } from "@/lib/types";
import { buildTourPlan } from "@/lib/tour-plan";

interface Props {
  orders: Order[];
  onRemoveOrder: (id: string) => void;
  onClearOrders: () => void;
  onOptimize: () => void;
  optimizing: boolean;
  optimizeError?: string | null;
  result?: OptimizeResponse | null;
  maxDeliveryMinutes: number;
  onMaxDeliveryChange: (n: number) => void;
}

/**
 * Render text that may contain http(s) URLs by linkifying them. Keeps the
 * overall message length capped so a 1000-char Google API error doesn't take
 * over the sidebar.
 */
function LinkifiedText({ text }: { text: string }) {
  const urlRe = /(https?:\/\/[^\s)]+)/g;
  const parts: Array<string | { url: string }> = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    parts.push({ url: m[1] });
    lastIndex = m.index + m[1].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <a
            key={i}
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted hover:text-white break-all"
          >
            {p.url}
          </a>
        ),
      )}
    </>
  );
}

function fmtSeconds(s: number): string {
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}h ${rem}m`;
}

function fmtMeters(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function Sidebar(props: Props) {
  const {
    orders,
    onRemoveOrder,
    onClearOrders,
    onOptimize,
    optimizing,
    optimizeError,
    result,
    maxDeliveryMinutes,
    onMaxDeliveryChange,
  } = props;

  const geocodedCount = useMemo(
    () => orders.filter((o) => o.geocodeStatus === "ok").length,
    [orders],
  );

  const tourPlan = useMemo(
    () => buildTourPlan(result ?? null, orders),
    [result, orders],
  );

  const canOptimize = geocodedCount > 0 && !optimizing;

  return (
    <aside className="w-full md:w-[420px] shrink-0 h-full flex flex-col border-r border-peppes-border bg-peppes-dark">
      {/* Active orders (primary) */}
      <div className="flex-1 min-h-0 flex flex-col px-4 md:px-5 py-4">
        <OrdersList
          orders={orders}
          onRemove={onRemoveOrder}
          onClear={onClearOrders}
          tourPlan={tourPlan}
          optimizeResult={result}
        />
      </div>

      {/* Plan + Optimize (secondary) */}
      <div className="border-t border-peppes-border px-4 md:px-5 py-4 space-y-3 shrink-0 max-h-[48%] overflow-y-auto thin-scroll">
        {result && result.routes.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs uppercase tracking-wider text-peppes-subtle font-medium">
                Plan ({result.strategy === "one-per-driver" ? "1/driver" : "multi-trip"})
              </div>
              <div className="text-[10px] text-peppes-subtle text-right">
                ASAP ≤{result.config.maxDeliveryMinutes}m · cap{" "}
                {Math.round(result.config.maxInBagSeconds / 60)}m in-bag · ±
                {result.config.scheduleWindowMinutes}m scheduled
              </div>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto thin-scroll pr-1 -mr-1">
              {result.routes.map((r) => (
                <div
                  key={r.driverIndex}
                  className="bg-peppes-panel border border-peppes-border rounded-md overflow-hidden"
                >
                  <div className="flex items-center gap-2 text-[12px] px-2.5 py-1.5 border-b border-peppes-border">
                    <span className="font-semibold">Driver {r.driverIndex + 1}</span>
                    <span className="text-peppes-subtle">
                      {r.trips.length} tour{r.trips.length === 1 ? "" : "s"} · {r.totalStops} stop{r.totalStops === 1 ? "" : "s"}
                    </span>
                    <span className="ml-auto tabular-nums">
                      {fmtSeconds(r.totalSeconds)} · {fmtMeters(r.totalMeters)}
                    </span>
                  </div>
                  {r.trips.length === 0 ? (
                    <div className="px-2.5 py-1.5 text-[11px] text-peppes-subtle italic">
                      Idle — no trips assigned.
                    </div>
                  ) : (
                    <ul className="divide-y divide-peppes-border">
                      {r.trips.map((t) => {
                        const stopCount = t.legs.length - 1;
                        const coldMin = t.maxInBagSeconds / 60;
                        const capMin = result.config.maxInBagSeconds / 60;
                        const worstClass =
                          coldMin >= capMin * 0.85
                            ? "text-amber-300"
                            : coldMin >= capMin * 0.55
                              ? "text-amber-200/70"
                              : "text-emerald-400/80";
                        return (
                          <li
                            key={t.tourIndex}
                            className="px-2.5 py-1.5 text-[11px]"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: t.color }}
                              />
                              <span className="font-mono text-peppes-subtle">
                                T{t.tripIndex + 1}
                              </span>
                              <span className="font-semibold text-white/90">
                                Tour {t.tourIndex + 1}
                              </span>
                              <span className="font-medium">
                                {stopCount === 1
                                  ? "Solo drop"
                                  : `Batch of ${stopCount}`}
                              </span>
                              <span className="ml-auto tabular-nums text-peppes-subtle">
                                {fmtSeconds(t.durationSeconds)}
                              </span>
                            </div>
                            <div className="mt-0.5 pl-5 text-[10px] text-peppes-subtle truncate">
                              {t.legs
                                .slice(1)
                                .map((l) => l.address.split(",")[0])
                                .join(" → ")}
                              <span className={`ml-2 ${worstClass}`}>
                                · worst {Math.round(coldMin)}m in bag
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {optimizeError && (
          <div className="text-[12px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2 max-h-32 overflow-y-auto thin-scroll">
            <LinkifiedText text={optimizeError} />
          </div>
        )}

        {result?.warnings?.length ? (
          <div className="space-y-1.5">
            {result.warnings.map((w, i) => (
              <div
                key={i}
                className="text-[11px] text-amber-200/90 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2 max-h-32 overflow-y-auto thin-scroll"
              >
                <LinkifiedText text={w} />
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <label
            htmlFor="max-delivery"
            className="text-[11px] text-peppes-subtle shrink-0 whitespace-nowrap"
          >
            ASAP max
          </label>
          <select
            id="max-delivery"
            value={maxDeliveryMinutes}
            onChange={(e) => onMaxDeliveryChange(Number(e.target.value))}
            className="flex-1 text-[12px] bg-peppes-panel border border-peppes-border rounded-lg px-2 py-2 outline-none focus:border-peppes-red"
          >
            <option value={40}>40 min (normal)</option>
            <option value={50}>50 min (busy)</option>
            <option value={60}>60 min (very busy)</option>
          </select>
        </div>

        <button
          type="button"
          disabled={!canOptimize}
          onClick={onOptimize}
          className="w-full py-3 rounded-lg bg-peppes-red text-white font-bold tracking-wide hover:brightness-110 active:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {optimizing
            ? "Optimizing routes…"
            : `Optimize ${geocodedCount} order${geocodedCount === 1 ? "" : "s"}`}
        </button>

        <p className="text-[10px] text-peppes-subtle leading-snug">
          ASAP and scheduled times are targets: the optimizer still builds a full
          plan for every order even when a window is tight. ±15 min around
          scheduled promises.
        </p>
      </div>
    </aside>
  );
}
