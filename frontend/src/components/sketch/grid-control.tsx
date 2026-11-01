"use client";

import { Grid3x3 } from "lucide-react";
import { useTranslations } from "use-intl";
import { Switch } from "@/components/ui/field";
import { Ltr } from "@/components/ui/misc";
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
  const t = useTranslations("sketch.grid");
  const now = gridOf(view.scale, grid).snap;
  const label = (mm: number) => `${lengthInput(mm, units)} ${units}`;
  return (
    <Pop align="end" className="w-[260px] p-3"
      trigger={
        <button type="button" aria-label={t("aria", { size: label(now), auto: grid === "auto" ? "yes" : "no", snap: snap ? "yes" : "no" })}
          className={cn("inline-flex h-8 items-center gap-1.5 rounded-full bg-surface/90 px-2.5 text-[13px] font-medium shadow-[var(--shadow-card)] backdrop-blur",
            snap ? "text-ink" : "text-ink-3")}>
          <Grid3x3 size={15} /><span className="tnum"><Ltr>{label(now)}</Ltr></span>
        </button>
      }>
      <div className="flex flex-col gap-3">
        <Switch checked={snap} onChange={(v) => setGrid({ snap: v })} label={t("snap")} description={t("snapHint")} />
        <div>
          <p className="mb-1.5 text-[13px] text-ink-2">{t("size")}</p>
          <div role="radiogroup" aria-label={t("size")} className="flex flex-wrap gap-1">
            {(["auto", ...SIZES] as const).map((g) => (
              <button key={g} type="button" role="radio" aria-checked={grid === g} onClick={() => setGrid({ grid: g })}
                className={cn("tnum h-8 rounded-lg px-2.5 text-[13px] font-medium", grid === g ? "bg-ink text-surface" : "bg-surface-2 text-ink-2 hover:text-ink")}>
                {g === "auto" ? t("auto") : <Ltr>{label(g)}</Ltr>}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-ink-3">{t("autoHint")}</p>
        </div>
      </div>
    </Pop>
  );
}
