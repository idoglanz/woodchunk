"use client";

import type { Schemas } from "@/lib/api/client";
import { asmColors } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

type Layout = Schemas["SheetLayoutOut"];

export function SheetDiagram({ layout, hasGrain, highlight, print = false }: { layout: Layout; hasGrain: boolean; highlight?: number | null; print?: boolean }) {
  const L = layout.length;
  const W = layout.width;
  const x = (v: number) => `${(v / L) * 100}%`;
  const y = (v: number) => `${(v / W) * 100}%`;
  return (
    <div className="flex flex-col gap-1.5" style={{ width: `min(100%, ${Math.round((440 * L) / W)}px)` }}>
      <div className="tnum flex justify-between text-[11px] text-ink-3">
        <span>0</span>
        {hasGrain ? <span className="inline-flex items-center gap-1">Grain <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true"><path d="M0 4h20M16 1l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg></span> : <span>No grain</span>}
        <span>{L}</span>
      </div>
      <div className={cn("relative w-full overflow-hidden rounded-[4px]", print ? "border border-black" : "hatch bg-surface-2 shadow-[inset_0_0_0_1px_var(--line-strong)]")}
        style={{ aspectRatio: `${L} / ${W}` }} role="img"
        aria-label={`${W} × ${L} sheet with ${layout.parts.length} parts`}>
        {layout.offcuts.map((r, i) => (
          <div key={`o${i}`} className="@container absolute flex items-center justify-center border-[1.5px] border-dashed border-line-strong bg-surface text-ink-2"
            style={{ left: x(r.x), top: y(r.y), width: x(r.w), height: y(r.h) }} title={`Offcut ${Math.round(r.w)} × ${Math.round(r.h)} → workshop`}>
            <span className="tnum hidden text-[11px] font-medium @min-[90px]:inline">{Math.round(Math.max(r.w, r.h))} × {Math.round(Math.min(r.w, r.h))} keep</span>
          </div>
        ))}
        {layout.parts.map((p, i) => (
          <div key={`p${i}`} className="@container absolute flex flex-col items-center justify-center overflow-hidden text-center"
            style={{ left: x(p.x), top: y(p.y), width: x(p.w), height: y(p.h), boxShadow: "inset 0 0 0 1px var(--line-strong)", ...(print ? { background: "#fff", color: "#000" } : asmColors(p.assembly)) }}
            title={`${p.label} ${p.name} · ${Math.round(p.rotated ? p.h : p.w)} × ${Math.round(p.rotated ? p.w : p.h)} mm${p.rotated ? " (rotated)" : ""}`}>
            <span className="hidden text-[12px] font-bold leading-tight @min-[26px]:block">{p.label}</span>
            <span className="tnum hidden font-mono text-[10px] leading-tight opacity-80 @min-[64px]:block">{Math.round(p.w)}×{Math.round(p.h)}</span>
          </div>
        ))}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${L} ${W}`} preserveAspectRatio="none" aria-hidden="true">
          {layout.cuts.map((c) => (
            <line key={c.n} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2}
              stroke={highlight === c.n ? "var(--accent)" : print ? "#000" : "var(--kerf)"}
              strokeWidth={highlight === c.n ? 4 : 1.25} vectorEffect="non-scaling-stroke" opacity={highlight && highlight !== c.n ? 0.35 : 1} />
          ))}
        </svg>
      </div>
    </div>
  );
}

export function cutText(c: Schemas["CutStep"], lang: "en" | "he" = "en"): string {
  const piece = `${Math.round(Math.max(c.piece_w, c.piece_h))} × ${Math.round(Math.min(c.piece_w, c.piece_h))}`;
  if (lang === "he") return `${c.kind === "rip" ? "חיתוך לאורך" : "חיתוך לרוחב"} של ${piece} ב־${c.offset} מ״מ`;
  return `${c.kind === "rip" ? "Rip" : "Crosscut"} the ${piece} piece at ${c.offset} mm`;
}
