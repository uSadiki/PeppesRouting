"use client";

import { useEffect, useRef, useState } from "react";
import type { AddOrderPayload, OrderType } from "@/lib/types";

interface Props {
  onSubmit: (order: AddOrderPayload) => void;
  /** Bumped by the parent every time it wants the input re-focused. */
  refocusToken: number;
  /** Compact mode for the thin top bar. */
  compact?: boolean;
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultScheduledLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return toDatetimeLocalValue(d);
}

export function OrderInput({ onSubmit, refocusToken, compact = false }: Props) {
  const [orderType, setOrderType] = useState<OrderType>("ASAP");
  const [scheduledFor, setScheduledFor] = useState(defaultScheduledLocal);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [refocusToken]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    const payload: AddOrderPayload =
      orderType === "Scheduled"
        ? {
            address: trimmed,
            type: "Scheduled",
            scheduledFor: scheduledFor.trim() || defaultScheduledLocal(),
          }
        : { address: trimmed, type: "ASAP" };
    onSubmit(payload);
    setValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className={compact ? "space-y-0" : "space-y-2"}>
      {!compact && (
        <label className="text-xs uppercase tracking-wider text-peppes-subtle font-medium">
          Add order
        </label>
      )}

      <div
        className={`flex flex-wrap items-center gap-2 ${compact ? "" : "flex-col sm:flex-row sm:items-stretch"}`}
      >
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <label className="sr-only">Delivery type</label>
          <select
            value={orderType}
            onChange={(e) => {
              const t = e.target.value as OrderType;
              setOrderType(t);
              if (t === "Scheduled") setScheduledFor((s) => s || defaultScheduledLocal());
            }}
            className="bg-peppes-panel border border-peppes-border rounded-lg px-2 py-2 text-[12px] outline-none focus:border-peppes-red shrink-0"
            aria-label="ASAP or scheduled delivery"
          >
            <option value="ASAP">ASAP</option>
            <option value="Scheduled">Scheduled</option>
          </select>
          {orderType === "Scheduled" && (
            <>
              <label className="sr-only">Scheduled time</label>
              <input
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                className="bg-peppes-panel border border-peppes-border rounded-lg px-2 py-2 text-[12px] outline-none focus:border-peppes-red w-[11.5rem] min-w-0 tabular-nums"
              />
            </>
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={compact ? "Address, Enter to add…" : "Address…"}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className={`min-w-0 flex-1 w-full bg-peppes-panel border border-peppes-border rounded-lg px-3 ${
            compact ? "py-2 text-[14px]" : "py-2.5 text-[15px]"
          } outline-none focus:border-peppes-red focus:shadow-glow transition placeholder:text-peppes-subtle`}
        />
      </div>
      {!compact && (
        <p className="text-[11px] text-peppes-subtle">
          Choose ASAP or scheduled time, type the address, then{" "}
          <kbd className="px-1 py-0.5 rounded bg-peppes-panel border border-peppes-border text-[10px]">
            Enter
          </kbd>
          .
        </p>
      )}
    </div>
  );
}
