"use client";

import type { OptimizeResponse, Order } from "@/lib/types";
import {
  type TourPlanGroup,
  suggestedDriveOutLabel,
} from "@/lib/tour-plan";

interface Props {
  orders: Order[];
  onRemove: (id: string) => void;
  onClear: () => void;
  /** After Optimize: orders are visually batched by tour (same colors as the map). */
  tourPlan?: { groups: TourPlanGroup[]; unassignedIds: string[] } | null;
  /** Last successful optimize result — used for suggested drive-out on scheduled tours. */
  optimizeResult?: OptimizeResponse | null;
}

function scheduleHint(o: Order): string | null {
  if (o.type !== "Scheduled" || !o.scheduledFor?.trim()) return null;
  const t = Date.parse(o.scheduledFor);
  if (!Number.isFinite(t)) return o.scheduledFor;
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function OrderRow({
  o,
  indexLabel,
  onRemove,
  className = "",
}: {
  o: Order;
  indexLabel: string;
  onRemove: (id: string) => void;
  className?: string;
}) {
  const sched = scheduleHint(o);
  return (
    <li
      className={`group flex items-start gap-2 rounded-lg px-3 py-2.5 bg-peppes-panel/90 border border-peppes-border ${className}`}
    >
      <span className="mt-0.5 text-[11px] font-mono font-semibold text-white/90 w-8 shrink-0 tabular-nums">
        {indexLabel}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm leading-tight truncate">
          {o.formattedAddress || o.address}
        </div>
        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
          {o.geocodeStatus === "pending" && (
            <span className="text-[10px] text-peppes-subtle">geocoding…</span>
          )}
          {o.geocodeStatus === "error" && (
            <span className="text-[10px] text-amber-400" title={o.geocodeError}>
              not found
            </span>
          )}
          {o.geocodeStatus === "ok" && (
            <span className="text-[10px] text-emerald-400 inline-flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 live-dot" />
              located
            </span>
          )}
          <span className="text-[10px] text-peppes-subtle/90">
            {o.type === "ASAP" ? "ASAP" : sched ? `Scheduled · ${sched}` : "Scheduled"}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onRemove(o.id)}
        aria-label={`Remove order ${o.address}`}
        className="opacity-60 group-hover:opacity-100 text-peppes-subtle hover:text-peppes-red transition shrink-0"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18" />
          <path d="M19 6l-1.5 14a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
    </li>
  );
}

export function OrdersList({
  orders,
  onRemove,
  onClear,
  tourPlan,
  optimizeResult,
}: Props) {
  const showGrouped =
    tourPlan != null && tourPlan.groups.some((g) => g.orderIds.length > 0);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-peppes-subtle font-medium">
            Active Orders
          </span>
          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-peppes-panel border border-peppes-border text-peppes-subtle">
            {orders.length}
          </span>
        </div>
        {orders.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-peppes-subtle hover:text-white transition"
          >
            Clear all
          </button>
        )}
      </div>

      {showGrouped && (
        <p className="text-[10px] text-peppes-subtle mb-2 leading-snug">
          Batched tours follow the last plan — same colors as on the map. New
          addresses stay grey on the map until you optimize again.
        </p>
      )}

      <div className="thin-scroll overflow-y-auto pr-1 -mr-1 flex-1 min-h-0">
        {orders.length === 0 ? (
          <div className="text-sm text-peppes-subtle border border-dashed border-peppes-border rounded-lg p-4 text-center">
            No active orders. Add one above.
          </div>
        ) : showGrouped ? (
          <div className="space-y-3">
            {tourPlan.groups.map((g) => {
              const driveOut =
                optimizeResult != null
                  ? suggestedDriveOutLabel(optimizeResult, g.tourIndex, orders)
                  : null;
              return (
                <div
                  key={g.tourIndex}
                  className="rounded-xl overflow-hidden border border-peppes-border border-l-[5px] bg-peppes-panel/30"
                  style={{ borderLeftColor: g.color }}
                >
                  <div
                    className="px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-peppes-border/80"
                    style={{ backgroundColor: `${g.color}1a` }}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-white/20"
                      style={{ backgroundColor: g.color }}
                    />
                    <span className="text-[11px] font-bold text-white tracking-wide">
                      Tour {g.tourIndex + 1}
                    </span>
                    <span className="text-[10px] text-peppes-subtle">
                      {g.orderIds.length} stop{g.orderIds.length === 1 ? "" : "s"} · same run
                    </span>
                    {driveOut ? (
                      <span
                        className="text-[10px] text-peppes-subtle ml-auto min-w-[12rem] text-right leading-snug"
                        title="Leave the depot by this time to reach the tightest scheduled promise, given this route's drive times."
                      >
                        <span className="text-peppes-subtle/90">Suggested drive out</span>
                        {": "}
                        <span className="text-white/95 font-semibold tabular-nums">
                          {driveOut}
                        </span>
                      </span>
                    ) : null}
                  </div>
                  <ul className="p-1.5 space-y-1">
                    {g.orderIds.map((oid, idx) => {
                      const o = orders.find((x) => x.id === oid);
                      if (!o) return null;
                      return (
                        <OrderRow
                          key={oid}
                          o={o}
                          indexLabel={`${g.tourIndex + 1}.${idx + 1}`}
                          onRemove={onRemove}
                        />
                      );
                    })}
                  </ul>
                </div>
              );
            })}

            {tourPlan.unassignedIds.length > 0 && (
              <div className="rounded-xl border border-dashed border-peppes-border bg-peppes-panel/20 p-2">
                <div className="text-[10px] uppercase tracking-wider text-amber-200/90 font-medium px-1 mb-1.5">
                  Not in last plan — optimize again
                </div>
                <ul className="space-y-1">
                  {tourPlan.unassignedIds.map((oid) => {
                    const o = orders.find((x) => x.id === oid);
                    if (!o) return null;
                    return (
                      <OrderRow
                        key={oid}
                        o={o}
                        indexLabel="—"
                        onRemove={onRemove}
                      />
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {orders.map((o, i) => (
              <OrderRow
                key={o.id}
                o={o}
                indexLabel={String(i + 1).padStart(2, "0")}
                onRemove={onRemove}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
