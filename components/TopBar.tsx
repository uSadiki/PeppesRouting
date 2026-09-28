"use client";

import { OrderInput } from "./OrderInput";
import type { AddOrderPayload } from "@/lib/types";

interface Props {
  drivers: number;
  refocusToken: number;
  onAddOrder: (order: AddOrderPayload) => void;
  onChangeDrivers: (n: number) => void;
}

export function TopBar({ drivers, refocusToken, onAddOrder, onChangeDrivers }: Props) {
  return (
    <div className="shrink-0 border-b border-peppes-border bg-peppes-dark">
      <div className="px-3 md:px-5 py-2 flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-peppes-red flex items-center justify-center font-black text-white text-base">
            P
          </div>
          <div>
            <div className="text-[15px] font-bold leading-tight">Peppes Route Optimizer</div>
            <div className="text-[11px] text-peppes-subtle leading-tight">
              Depot · Hellinga 3
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0 md:pl-2">
          <OrderInput onSubmit={onAddOrder} refocusToken={refocusToken} compact />
        </div>

        <div className="md:w-[340px]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChangeDrivers(Math.max(1, drivers - 1))}
              className="w-9 h-9 rounded-lg bg-peppes-panel border border-peppes-border hover:border-white/30 transition text-lg font-bold"
              aria-label="Fewer drivers"
            >
              −
            </button>
            <input
              type="number"
              min={1}
              max={99}
              value={drivers}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                onChangeDrivers(Number.isNaN(n) ? 1 : Math.max(1, Math.min(99, n)));
              }}
              className="w-16 text-center bg-peppes-panel border border-peppes-border rounded-lg px-2 py-2 text-[15px] outline-none focus:border-peppes-red"
            />
            <button
              type="button"
              onClick={() => onChangeDrivers(Math.min(99, drivers + 1))}
              className="w-9 h-9 rounded-lg bg-peppes-panel border border-peppes-border hover:border-white/30 transition text-lg font-bold"
              aria-label="More drivers"
            >
              +
            </button>
            <div className="ml-auto text-[11px] text-peppes-subtle">
              {drivers}
              {" "}
              driver{drivers === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

