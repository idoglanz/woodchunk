"use client";

import { useState, type ReactNode } from "react";
import { Card } from "@/components/ui/misc";
import { niceMax, shortDay, type Point } from "@/lib/admin";
import { cn } from "@/lib/cn";

export type Series = { name: string; color: string };

function range(p: Point): string {
  return p.from === p.to ? shortDay(p.from) : `${shortDay(p.from)} – ${shortDay(p.to)}`;
}

/**
 * Bars over time, stacked when there's more than one series. Hover or tap a bar for its numbers.
 * One series needs no legend (the title names it); several get one, with totals, so colour never carries identity alone.
 */
export function BarChart({ title, headline, note, series, points, unit = "", legend, empty = "Nothing yet." }: {
  title: string; headline?: ReactNode; note?: ReactNode; series: Series[]; points: Point[]; unit?: string;
  /** Replaces the default legend (series names with totals). */
  legend?: ReactNode; empty?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = points.map((p) => p.values.reduce((a, b) => a + b, 0));
  const max = niceMax(Math.max(0, ...totals));
  const blank = totals.every((t) => t === 0);
  const h = hover === null ? null : points[hover];
  const fmt = (n: number) => `${n.toLocaleString("en-US")}${unit}`;
  const sums = series.map((_, i) => points.reduce((a, p) => a + p.values[i], 0));

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h3 className="text-[17px] font-semibold">{title}</h3>
          {note ? <p className="text-[13px] text-ink-2">{note}</p> : null}
        </div>
        {headline !== undefined ? <span className="tnum shrink-0 text-[22px] font-semibold tracking-[-0.01em]">{headline}</span> : null}
      </div>

      <div className="relative pt-4">
        <div className="pointer-events-none absolute inset-x-0 top-4 border-t border-dashed border-line" />
        <span className="tnum pointer-events-none absolute end-0 top-0 text-[11px] leading-4 text-ink-3">{fmt(max)}</span>
        <div role="img" aria-label={`${title}: ${series.map((s, i) => `${s.name} ${fmt(sums[i])}`).join(", ")}`}
          className={cn("flex h-36 items-end border-b border-line-strong", points.length > 40 ? "gap-px" : "gap-[2px]")}
          onPointerLeave={() => setHover(null)}>
          {points.map((p, i) => (
            <div key={p.from} className="flex h-full min-w-0 flex-1 flex-col justify-end"
              onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
              <div className={cn("flex flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px] transition-opacity duration-150",
                hover !== null && hover !== i && "opacity-45")}
                style={{ height: `${(totals[i] / max) * 100}%` }}>
                {p.values.map((v, k) => v > 0 ? (
                  <div key={k} style={{ flexGrow: v, background: series[k].color }} className="min-h-[2px]" />
                ) : null)}
              </div>
            </div>
          ))}
        </div>
        {blank ? <p className="pointer-events-none absolute inset-x-0 top-16 text-center text-[13px] text-ink-3">{empty}</p> : null}
        {h && hover !== null ? (
          <div className="pointer-events-none absolute -top-2 z-10 min-w-36 -translate-y-full rounded-[10px] bg-surface px-3 py-2 text-[12px] shadow-[var(--shadow-pop)] dark:border dark:border-line"
            style={hover < points.length / 2 ? { insetInlineStart: `${(hover / points.length) * 100}%` } : { insetInlineEnd: `${((points.length - hover - 1) / points.length) * 100}%` }}>
            <p className="font-semibold">{range(h)}</p>
            {series.map((s, k) => (
              <p key={s.name} className="tnum flex items-center justify-between gap-4 text-ink-2">
                <span className="flex items-center gap-1.5">{series.length > 1 ? <span className="h-2 w-2 rounded-full" style={{ background: s.color }} /> : null}{s.name}</span>
                <span className="text-ink">{fmt(h.values[k])}</span>
              </p>
            ))}
          </div>
        ) : null}
        <div className="tnum mt-1.5 flex justify-between text-[11px] text-ink-3">
          {points.length ? <><span>{shortDay(points[0].from)}</span><span>{shortDay(points[points.length - 1].to)}</span></> : null}
        </div>
      </div>

      {legend ?? (series.length > 1 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {series.map((s, i) => (
            <li key={s.name} className="flex items-center gap-1.5 text-ink-2">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />{s.name}
              <span className="tnum text-ink">{fmt(sums[i])}</span>
            </li>
          ))}
        </ul>
      ) : null)}
    </Card>
  );
}
