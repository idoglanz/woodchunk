"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ItemPicker, rememberMaterial } from "@/components/project/material-picker";
import { useProjectCtx } from "@/components/project/context";
import { Button } from "@/components/ui/button";
import { Field, LengthInput, QtyInput, Switch } from "@/components/ui/field";
import { Sheet } from "@/components/ui/overlay";
import type { CatalogItem } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { newAssembly, nextLetter, useEditor } from "@/lib/editor";
import { deriveParts, sectionOf } from "@/lib/frame/parts";
import { TEMPLATES, type TemplateRole } from "@/lib/frame/templates";
import { useFrameUI } from "@/lib/frame/ui";
import { useCatalog } from "@/lib/queries";

/**
 * Start a 3D frame from a template, either as a new assembly or replacing an existing assembly's
 * typed parts (`assemblyId`).
 */
export function TemplateDialog({ open, onOpenChange, assemblyId }: { open: boolean; onOpenChange: (o: boolean) => void; assemblyId?: string }) {
  const router = useRouter();
  const { id: projectId, units } = useProjectCtx();
  const edit = useEditor((s) => s.edit);
  const catalog = useCatalog({ kind: "lumber" });
  const bars = useMemo(() => (catalog.data ?? []).filter((i) => sectionOf(i)), [catalog.data]);
  const byId = useMemo(() => new Map(bars.map((i) => [i.id, i])), [bars]);
  const fallback = bars.find((i) => i.name.en.startsWith("40 × 40 × 2 square")) ?? bars[0];

  const [tplId, setTplId] = useState(TEMPLATES[0].id);
  const tpl = TEMPLATES.find((t) => t.id === tplId)!;
  const [params, setParams] = useState<Record<string, Record<string, number>>>({});
  const [options, setOptions] = useState<Record<string, Record<string, number>>>({});
  const [items, setItems] = useState<Partial<Record<TemplateRole, string>>>({});
  const p = { ...Object.fromEntries(tpl.params.map((x) => [x.name, x.mm])), ...params[tpl.id] };
  const o = { ...Object.fromEntries(tpl.options.map((x) => [x.key, x.value])), ...options[tpl.id] };
  const roleItem = (r: TemplateRole) => items[r] ?? fallback?.id ?? null;

  const create = () => {
    const chosen = Object.fromEntries(tpl.roles.map((r) => [r.key, roleItem(r.key)]));
    const sections = Object.fromEntries(tpl.roles.map((r) => {
      const it = chosen[r.key] ? byId.get(chosen[r.key]!) : undefined;
      return [r.key, it ? sectionOf(it) : null];
    }));
    const frame = tpl.build({ params: p, options: o, items: chosen, sections });
    let target = assemblyId;
    edit((d) => {
      let a = assemblyId ? d.assemblies.find((x) => x.id === assemblyId) : undefined;
      if (!a) {
        a = newAssembly({ letter: nextLetter(d.assemblies.map((x) => x.letter)), name: tpl.name });
        d.assemblies.push(a);
      }
      a.frame = frame;
      deriveParts(a, byId);
      target = a.id;
    });
    onOpenChange(false);
    // An empty frame opens ready to draw, with the chosen material.
    if (!frame.members.length) {
      useFrameUI.getState().setTool("draw");
      useFrameUI.getState().set({ drawItem: chosen.rails ?? null });
    }
    if (target) router.push(`/projects/${projectId}/frame/${target}`);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} wide title="Design a frame in 3D"
      description="Pick a starting shape and sizes. You can change everything later in the 3D view."
      footer={<div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" onClick={create} disabled={!bars.length}>Create frame</Button>
      </div>}>
      <div className="flex flex-col gap-5">
        <div role="radiogroup" aria-label="Starting shape" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TEMPLATES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={t.id === tplId} onClick={() => setTplId(t.id)}
              className={cn("flex flex-col gap-0.5 rounded-[14px] border px-3 py-2.5 text-start transition-colors",
                t.id === tplId ? "border-ink bg-surface-2" : "border-line hover:bg-surface-2")}>
              <span className="text-[15px] font-semibold">{t.name}</span>
              <span className="text-[13px] leading-snug text-ink-2">{t.summary}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tpl.params.map((x) => (
            <Field key={`${tpl.id}-${x.name}`} label={x.label} htmlFor={`tp-${x.name}`}>
              <LengthInput id={`tp-${x.name}`} ariaLabel={x.label} units={units} value={p[x.name]}
                onChange={(mm) => { if (mm && mm > 0) setParams((s) => ({ ...s, [tpl.id]: { ...s[tpl.id], [x.name]: mm } })); }} />
            </Field>
          ))}
        </div>
        {tpl.options.length ? (
          <div className="flex flex-col gap-3">
            {tpl.options.map((x) => x.kind === "toggle" ? (
              <Switch key={`${tpl.id}-${x.key}`} label={x.label} checked={!!o[x.key]}
                onChange={(v) => setOptions((s) => ({ ...s, [tpl.id]: { ...s[tpl.id], [x.key]: v ? 1 : 0 } }))} />
            ) : (
              <div key={`${tpl.id}-${x.key}`} className="flex items-center justify-between gap-4">
                <span className="text-[15px]">{x.label}</span>
                <QtyInput ariaLabel={x.label} value={o[x.key]} min={x.min ?? 0} max={x.max ?? 10} className="w-28"
                  onChange={(n) => setOptions((s) => ({ ...s, [tpl.id]: { ...s[tpl.id], [x.key]: n } }))} />
              </div>
            ))}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {tpl.roles.map((r) => (
            <Field key={r.key} label={r.label}>
              <ItemPicker items={bars as CatalogItem[]} value={roleItem(r.key)} kinds={["lumber"]} ariaLabel={`${r.label} material`}
                onChange={(id) => { if (!id) return; rememberMaterial(id); setItems((s) => ({ ...s, [r.key]: id })); }} />
            </Field>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
