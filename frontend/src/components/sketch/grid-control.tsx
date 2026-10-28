"use client";

import { Grid3x3 } from "lucide-react";
import { Switch } from "@/components/ui/field";
import { Pop } from "@/components/ui/overlay";
import { cn } from "@/lib/cn";
import { useSketchUI } from "@/lib/sketch/ui";
import { gridOf, type View } from "@/lib/sketch/view";
import { lengthInput, type Units } from "@/lib/units";

const SIZES = [1, 5, 10, 25, 50, 100];

/** The grid's spacing (fixed, or following the zoom) and whether clicks snap to it. */
export function GridControl({ view, units }: { view: View; units: Units }) {
  const snap = useSketchUI((s) => s.snap);
  const grid = useSketchUI((s) => s.grid);
  const setGrid = useSketchUI((s) => s.setGrid);
  const now = gridOf(view.scale, grid).snap;
  const label = (mm: number) => `${lengthInput(mm, units)} ${units}`;
  return (
    <Pop align="end" className="w-[260px] p-3"
      trigger={
        <button type="button" aria-label={`Grid: ${label(now)}${grid === "auto" ? " (follows the zoom)" : ""}, snapping ${snap ? "on" : "off"}`}
          className={cn("inline-flex h-8 items-center gap-1.5 rounded-full bg-surface/90 px-2.5 text-[13px] font-medium shadow-[var(--shadow-card)] backdrop-blur",
            snap ? "text-ink" : "text-ink-3")}>
          <Grid3x3 size={15} /><span className="tnum">{label(now)}</span>
        </button>
      }>
      <div className="flex flex-col gap-3">
        <Switch checked={snap} onChange={(v) => setGrid({ snap: v })} label="Snap to grid" description="G to switch; hold Alt to place freely." />
        <div>
          <p className="mb-1.5 text-[13px] text-ink-2">Grid size</p>
          <div role="radiogroup" aria-label="Grid size" className="flex flex-wrap gap-1">
            {(["auto", ...SIZES] as const).map((g) => (
              <button key={g} type="button" role="radio" aria-checked={grid === g} onClick={() => setGrid({ grid: g })}
                className={cn("tnum h-8 rounded-lg px-2.5 text-[13px] font-medium", grid === g ? "bg-ink text-surface" : "bg-surface-2 text-ink-2 hover:text-ink")}>
                {g === "auto" ? "Auto" : label(g)}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-ink-3">Auto follows the zoom: finer as you zoom in.</p>
        </div>
      </div>
    </Pop>
  );
}
