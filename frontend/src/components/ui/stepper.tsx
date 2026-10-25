"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/cn";

export function Stepper({ value, onChange, min = 1, max = 9999, label, prefix = "×", className }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number; label: string; prefix?: string; className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex h-8 items-center rounded-[10px] bg-surface-2", className)}>
      <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}
        className="flex h-8 w-8 items-center justify-center rounded-[10px] text-ink-2 hover:text-ink disabled:opacity-30">
        <Minus size={14} strokeWidth={2.2} />
      </button>
      <input aria-label={label} inputMode="numeric" value={`${prefix}${value}`}
        onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ""), 10); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); }}
        className="tnum w-11 bg-transparent text-center text-[14px] font-semibold outline-none" />
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-8 w-8 items-center justify-center rounded-[10px] text-ink-2 hover:text-ink disabled:opacity-30">
        <Plus size={14} strokeWidth={2.2} />
      </button>
    </div>
  );
}
