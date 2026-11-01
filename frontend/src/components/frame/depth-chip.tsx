"use client";

import { Layers } from "lucide-react";
import { useMemo } from "react";
import { useTranslations } from "use-intl";
import { Pop } from "@/components/ui/overlay";
import { NumberInput } from "@/components/ui/field";
import { Ltr } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { nodePositions } from "@/lib/frame/edit";
import type { Frame } from "@/lib/frame/types";
import { FLAT, flatPlane, useFrameUI, type FlatMode } from "@/lib/frame/ui";

/**
 * Which slice a flat view draws on: the frame's own levels along the view direction (front face,
 * back face, a middle rail…) or a typed value. Starting a line on a joint uses that joint's depth.
 */
export function DepthChip({ mode, frame }: { mode: FlatMode; frame: Frame }) {
  const t = useTranslations("frame");
  const depth = useFrameUI((s) => s.depth[mode]);
  const set = useFrameUI((s) => s.set);
  const f = FLAT[mode];
  const pos = useMemo(() => [...nodePositions(frame).values()], [frame]);
  const plane = flatPlane(mode, depth, pos);
  const levels = useMemo(() => {
    const vals = [...new Set(pos.map((p) => Math.round(p[f.normal] * 10) / 10))].sort((a, b) => a - b);
    return vals.map((v, i) => ({ v, name: i === 0 && vals.length > 1 ? t(`depth.faces.${f.faceName[0]}`) : i === vals.length - 1 && vals.length > 1 ? t(`depth.faces.${f.faceName[1]}`) : "" }));
  }, [pos, f, t]);
  const name = levels.find((l) => Math.abs(l.v - plane.at) < 0.05)?.name;
  const choose = (v: number | null) => set({ depth: { ...useFrameUI.getState().depth, [mode]: v } });

  return (
    <div className="absolute start-3 top-14 z-10">
      <Pop align="start" className="w-64 p-3" trigger={
        <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface/90 px-3 text-[13px] font-medium shadow-[var(--shadow-card)] backdrop-blur hover:bg-surface">
          <Layers size={14} className="text-ink-3" />
          {t("depth.drawingOn", { name: name || t("depth.aSlice") })} · <span className="tnum"><Ltr>{f.label} = {plane.at}</Ltr></span>
        </button>
      }>
        <div className="flex flex-col gap-1">
          <p className="px-1 pb-1 text-[12px] text-ink-3">{t("depth.hint")}</p>
          {levels.map((l) => (
            <button key={l.v} type="button" onClick={() => choose(l.v)}
              className={cn("flex items-center justify-between rounded-lg px-2 py-1.5 text-start text-[14px] hover:bg-surface-2", Math.abs(l.v - plane.at) < 0.05 && "bg-surface-2 font-semibold")}>
              <span>{l.name || t("depth.level")}</span><span className="tnum text-ink-2"><Ltr>{f.label} = {l.v}</Ltr></span>
            </button>
          ))}
          <div className="mt-1 flex items-center gap-2 border-t border-line px-1 pt-2">
            <span className="text-[13px] text-ink-2">{t("depth.other")}</span>
            <NumberInput ariaLabel={t("depth.aria", { axis: f.label })} value={plane.at} min={-100000} decimals={1} suffix="mm" className="flex-1"
              onChange={(n) => { if (n != null) choose(n); }} />
          </div>
        </div>
      </Pop>
    </div>
  );
}
