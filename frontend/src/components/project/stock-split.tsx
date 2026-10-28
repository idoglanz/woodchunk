import { cn } from "@/lib/cn";

/** 77, 20, 3.4, 0.3: whole numbers unless small. */
export function share(v: number): string {
  return `${v >= 10 || v === 0 ? Math.round(v) : Math.round(v * 10) / 10}%`;
}

/**
 * Where a material's stock goes: into parts, into offcuts kept for the inventory, or to waste (saw
 * cuts, trims, scraps too small to keep). A single waste number hides the offcuts you paid for.
 */
export function StockSplit({ used, offcut, waste, className }: { used: number; offcut: number; waste: number; className?: string }) {
  const parts = [
    { key: "used", label: "used", v: used, color: "var(--accent)" },
    { key: "offcut", label: "offcuts", v: offcut, color: "var(--line-strong)" },
    { key: "waste", label: "waste", v: waste, color: "var(--kerf)" },
  ];
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div role="img" aria-label={`${share(used)} used in parts, ${share(offcut)} kept as offcuts, ${share(waste)} wasted`}
        className="flex h-1.5 gap-px overflow-hidden rounded-full bg-surface-2">
        {parts.map((p) => (p.v > 0 ? <span key={p.key} style={{ width: `${p.v}%`, minWidth: 2, background: p.color }} /> : null))}
      </div>
      <div className="tnum flex flex-wrap gap-x-3 text-[12px] text-ink-2">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            {share(p.v)} {p.label}{p.key === "offcut" && p.v > 0 ? <span className="text-ink-3"> → inventory</span> : null}
          </span>
        ))}
      </div>
    </div>
  );
}
