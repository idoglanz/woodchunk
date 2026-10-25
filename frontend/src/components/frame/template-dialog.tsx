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
import { nodePositions } from "@/lib/frame/edit";
import { deriveParts, sectionOf } from "@/lib/frame/parts";
import { TEMPLATES, type TemplateRole } from "@/lib/frame/templates";
import type { Frame } from "@/lib/frame/types";
import { useFrameUI } from "@/lib/frame/ui";
import { useMediaQuery } from "@/lib/focus";
import { useCatalog } from "@/lib/queries";

/**
 * Start a 3D frame from a template, either as a new assembly or replacing an existing assembly's
 * typed parts (`assemblyId`).
 */
/** A small isometric line drawing of a template, built from the template itself. */
function TemplateIcon({ id }: { id: string }) {
  const lines = useMemo(() => {
    const t = TEMPLATES.find((x) => x.id === id)!;
    const params = Object.fromEntries(t.params.map((p) => [p.name, p.mm]));
    const options = Object.fromEntries(t.options.map((o) => [o.key, o.value]));
    const frame = t.build({ params, options, items: {}, sections: {} });
    const pos = nodePositions(frame as Frame);
    const iso = ([x, y, z]: [number, number, number]) => [(x - y) * 0.866, (x + y) * 0.5 - z * 1.0] as const;
    return frame.members.flatMap((m) => { const a = pos.get(m.a), b = pos.get(m.b); return a && b ? [[iso(a), iso(b)]] : []; });
  }, [id]);
  const W = 72, H = 52, pad = 6;
  if (!lines.length) {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="mb-1 text-ink-3">
        <path d="M14 30 L36 18 L58 30 L36 42 Z" fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="3 3" />
        <path d="M30 34 L44 20 M41 19 L45 23" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
      </svg>
    );
  }
  const xs = lines.flatMap(([a, b]) => [a[0], b[0]]), ys = lines.flatMap(([a, b]) => [a[1], b[1]]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const k = Math.min((W - 2 * pad) / (Math.max(...xs) - minX || 1), (H - 2 * pad) / (Math.max(...ys) - minY || 1));
  const p = ([x, y]: readonly [number, number]) => `${(pad + (x - minX) * k).toFixed(1)},${(pad + (y - minY) * k).toFixed(1)}`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="mb-1 text-ink-2">
      {lines.map(([a, b], i) => <polyline key={i} points={`${p(a)} ${p(b)}`} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />)}
    </svg>
  );
}

export function TemplateDialog({ open, onOpenChange, assemblyId }: { open: boolean; onOpenChange: (o: boolean) => void; assemblyId?: string }) {
  const router = useRouter();
  const { id: projectId, units } = useProjectCtx();
  const edit = useEditor((s) => s.edit);
  const catalog = useCatalog({ kind: "lumber" });
  const bars = useMemo(() => (catalog.data ?? []).filter((i) => sectionOf(i)), [catalog.data]);
  const byId = useMemo(() => new Map(bars.map((i) => [i.id, i])), [bars]);
  const fallback = bars.find((i) => i.name.en.startsWith("40 × 40 × 2 square")) ?? bars[0];

  const [tplId, setTplId] = useState(TEMPLATES[0].id);
  // Drawing needs a pointer and room: on small screens offer only the ready-made shapes.
  const roomy = useMediaQuery("(min-width: 900px)");
  const templates = TEMPLATES.filter((t) => roomy || t.id !== "empty");
  const replacing = useEditor((s) => (assemblyId ? s.content?.assemblies.find((a) => a.id === assemblyId)?.parts.length ?? 0 : 0));
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
      description={replacing
        ? `Pick a starting shape and sizes. Its bars replace this assembly's ${replacing} typed part${replacing === 1 ? "" : "s"} (undo brings them back).`
        : "Pick a starting shape and sizes. You can change everything later in the 3D view."}
      footer={<div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" onClick={create} disabled={!bars.length}>Create frame</Button>
      </div>}>
      <div className="flex flex-col gap-5">
        <div role="radiogroup" aria-label="Starting shape" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {templates.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={t.id === tplId} onClick={() => setTplId(t.id)}
              className={cn("flex flex-col gap-0.5 rounded-[14px] border px-3 py-2.5 text-start transition-colors",
                t.id === tplId ? "border-ink bg-surface-2" : "border-line hover:bg-surface-2")}>
              <TemplateIcon id={t.id} />
              <span className="text-[15px] font-semibold">{t.name}</span>
              <span className="text-[13px] leading-snug text-ink-2">{t.summary}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tpl.params.filter((x) => !x.option || o[x.option]).map((x) => (
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
