"use client";

import { AlertCircle } from "lucide-react";
import { useMemo } from "react";
import { SectionGlyph } from "@/components/project/section-glyph";
import { AsmChip, Callout } from "@/components/ui/misc";
import type { Assembly, CatalogItem } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { useEditor } from "@/lib/editor";
import type { EndCut, FrameResult } from "@/lib/frame/kernel";
import { useFrameUI } from "@/lib/frame/ui";
import { fmtMeters } from "@/lib/units";

/** "Square", "45° / 45°", "square / 11.4°", with "bevel" when the blade tilts. */
export function cutSummary(ends: readonly EndCut[] | readonly { miter: number; bevel: number }[]): string {
  const one = (e: { miter: number; bevel: number }) =>
    !e.miter && !e.bevel ? "square" : e.bevel ? `${e.miter}° · bevel ${e.bevel}°` : `${e.miter}°`;
  if (ends.every((e) => !e.miter && !e.bevel)) return "Square";
  return ends.map(one).join(" / ");
}

export function CutList({ asm, result, byId }: { asm: Assembly; result: FrameResult; byId: Map<string, CatalogItem> }) {
  const hovered = useFrameUI((s) => s.hovered);
  const selected = useFrameUI((s) => s.selected);
  const hover = useFrameUI((s) => s.hover);
  const select = useFrameUI((s) => s.select);
  const settings = useEditor((s) => s.content?.settings);
  const beyondSaw = (ends: readonly EndCut[]) => !!settings && ends.some((e) => e.miter > settings.max_miter_deg + 0.05 || e.bevel > settings.max_bevel_deg + 0.05);

  const totals = useMemo(() => {
    const byItem = new Map<string, { item?: CatalogItem; mm: number }>();
    let kg = 0;
    for (const g of result.groups) {
      if (!g.item_id) continue;
      const item = byId.get(g.item_id);
      const t = byItem.get(g.item_id) ?? { item, mm: 0 };
      t.mm += g.qty * g.lp;
      byItem.set(g.item_id, t);
      if (item?.kg_per_m) kg += (g.qty * g.lp * item.kg_per_m) / 1000;
    }
    return { byItem: [...byItem.values()], kg };
  }, [result.groups, byId]);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold">Cut list</h2>
        <span className="text-[13px] text-ink-3">per {asm.name || "assembly"}{asm.qty > 1 ? ` · ×${asm.qty}` : ""}</span>
      </div>
      {result.warnings.length ? (
        <Callout tone="warn" icon={<AlertCircle size={16} />}>
          <ul className="flex flex-col gap-0.5 text-[13px]">{[...new Set(result.warnings)].map((w) => <li key={w}>{w}</li>)}</ul>
        </Callout>
      ) : null}
      <ol className="flex flex-col">
        {result.groups.map((g, i) => {
          const item = g.item_id ? byId.get(g.item_id) : undefined;
          const lit = g.members.some((m) => hovered.includes(m)) || (selected?.kind === "member" && g.members.includes(selected.id));
          return (
            <li key={g.key}>
              <button type="button" data-frame-shortcuts onMouseEnter={() => hover(g.members)} onMouseLeave={() => hover([])}
                onFocus={() => hover(g.members)} onBlur={() => hover([])} onClick={() => select({ kind: "member", id: g.members[0] })}
                className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl px-2 py-2 text-start transition-colors", lit ? "bg-accent-soft" : "hover:bg-surface-2")}>
                <AsmChip letter={asm.letter}>{asm.letter}{i + 1}</AsmChip>
                <span className="flex min-w-0 flex-col">
                  <span className="tnum text-[15px] font-semibold">{g.qty} × {g.lp} mm</span>
                  <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink-2">
                    {item ? <SectionGlyph item={item} size={16} /> : null}
                    <span className="truncate">{item ? item.name.en : "No material"}</span>
                  </span>
                </span>
                <span className="flex flex-col items-end text-[13px]">
                  <span className={cn("font-medium", beyondSaw(g.ends) && "text-kerf")} title={beyondSaw(g.ends) ? "Beyond your saw's range (cutting settings)" : undefined}>{cutSummary(g.ends)}</span>
                  {g.sp !== g.lp ? <span className="tnum text-ink-3">short {g.sp}</span> : null}
                  {g.face_up === "side" ? <span className="text-ink-3">on its side</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {totals.byItem.length ? (
        <div className="flex flex-col gap-1 border-t border-line pt-3 text-[13px] text-ink-2">
          {totals.byItem.map((t) => (
            <div key={t.item?.id ?? "x"} className="flex justify-between gap-3">
              <span className="truncate">{t.item?.name.en ?? "No material"}</span>
              <span className="tnum shrink-0">{fmtMeters(t.mm)}</span>
            </div>
          ))}
          {totals.kg ? <div className="flex justify-between gap-3 font-medium text-ink"><span>Steel weight</span><span className="tnum">{totals.kg.toFixed(1)} kg</span></div> : null}
        </div>
      ) : null}
    </div>
  );
}
