"use client";

import type { LumberPlan } from "@/lib/api/client";
import { asmColors } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { fmtMeters } from "@/lib/units";

/** Ruler with ticks every 100 mm and labels every 500 mm, spanning `max` mm. */
export function Ruler({ max, className }: { max: number; className?: string }) {
  const ticks = Math.floor(max / 100);
  return (
    <div aria-hidden="true" className={cn("relative h-5", className)}>
      <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${max} 20`} preserveAspectRatio="none">
        {Array.from({ length: ticks + 1 }, (_, i) => (
          <line key={i} x1={i * 100} x2={i * 100} y1={i % 5 === 0 ? 10 : 15} y2={20} stroke="var(--ink-3)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        <line x1={0} x2={max} y1={20} y2={20} stroke="var(--line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      {Array.from({ length: Math.floor(ticks / 5) + 1 }, (_, i) => (
        <span key={i} className="tnum absolute top-[-3px] -translate-x-1/2 text-[10px] text-ink-3 rtl:translate-x-1/2" style={{ insetInlineStart: `${(i * 500 / max) * 100}%` }}>
          {(i * 0.5).toFixed(1)}
        </span>
      ))}
    </div>
  );
}

export function LumberBars({ plan, labels = true, print = false, active, onPick }: {
  plan: LumberPlan; labels?: boolean; print?: boolean;
  /** Part id to emphasise; the other pieces fade back. */
  active?: string | null;
  onPick?: (partId: string) => void;
}) {
  const max = Math.max(...plan.patterns.map((p) => p.stock_length), 1);
  const dim = !!active && plan.patterns.some((pat) => pat.segments.some((s) => s.part_id === active));
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-3">
        <span className="w-[68px] shrink-0" />
        <Ruler max={max} className="flex-1" />
      </div>
      {plan.patterns.map((pat, i) => (
        <div key={i} className="avoid-break flex items-center gap-3">
          <span className="tnum flex w-[68px] shrink-0 flex-col text-[13px] leading-tight">
            <span className="font-semibold">{fmtMeters(pat.stock_length)}</span>
            <span className="text-ink-3">×{pat.count}{pat.source !== "buy" ? (pat.source === "inventory" ? " · yours" : " · bought") : ""}</span>
          </span>
          <div className="min-w-0 flex-1">
            <div className={cn("flex h-11 gap-[2px] overflow-hidden rounded-[6px]", print ? "border border-black bg-black" : "bg-kerf")}
              style={{ width: `${(pat.stock_length / max) * 100}%` }}
              role="img" aria-label={`${fmtMeters(pat.stock_length)} board: ${pat.segments.filter((s) => s.kind === "part").map((s) => `${s.label} ${s.length} mm`).join(", ")}`}>
              {pat.segments.map((s, j) => {
                const title = s.kind === "part" ? `${s.label} ${s.name} · ${s.length} mm` : s.kind === "offcut" ? `Offcut ${Math.round(s.length)} mm → workshop` : `Waste ${Math.round(s.length)} mm`;
                if (s.kind === "waste") return <div key={j} title={title} className="hatch min-w-[2px] bg-surface-2" style={{ flex: `${s.length} 1 0` }} />;
                if (s.kind === "offcut") {
                  return (
                    <div key={j} title={title} className="@container flex min-w-[2px] items-center justify-center rounded-e-[6px] border-[1.5px] border-dashed border-line-strong bg-surface text-ink-2" style={{ flex: `${s.length} 1 0` }}>
                      <span className="tnum hidden truncate px-1.5 text-[11px] font-medium @min-[72px]:inline">{Math.round(s.length)} → keep</span>
                    </div>
                  );
                }
                return (
                  <div key={j} title={title} data-part={s.part_id} onClick={onPick ? () => onPick(s.part_id) : undefined}
                    className={cn("@container flex min-w-[2px] flex-col justify-center overflow-hidden px-2 transition-opacity duration-150",
                      onPick && "cursor-pointer", dim && s.part_id !== active && "opacity-35")}
                    style={{ flex: `${s.length} 1 0`, ...(print ? { background: "#fff", color: "#000" } : asmColors(s.assembly)),
                      ...(s.part_id === active && !print ? { boxShadow: "inset 0 0 0 2.5px var(--ink)" } : {}) }}>
                    {labels ? <>
                      <span className="hidden truncate text-[12px] font-bold leading-tight @min-[30px]:block">{s.label}</span>
                      <span className="tnum hidden truncate font-mono text-[11px] leading-tight opacity-80 @min-[44px]:block">{Math.round(s.length)}</span>
                    </> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
