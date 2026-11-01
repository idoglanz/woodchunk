"use client";

import { Check, PencilRuler, Plus, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "use-intl";
import { useProjectCtx } from "@/components/project/context";
import { SketchThumb, useNewSketch } from "@/components/sketch/sketch-card";
import { Button, IconButton } from "@/components/ui/button";
import { AsmChip } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/overlay";
import type { Assembly } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { useEditor } from "@/lib/editor";
import { sketchesOf } from "@/lib/sketch/parts";

/** The sketches an assembly is drawn in, on its card: attached ones, and ones its parts are cut from. */
export function AssemblySketches({ a }: { a: Assembly }) {
  const { id } = useProjectCtx();
  const content = useEditor((s) => s.content);
  const readOnly = useEditor((s) => s.readOnly);
  const edit = useEditor((s) => s.edit);
  const t = useTranslations("sketch.assembly");
  const list = content ? sketchesOf(content, a.id) : [];
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap gap-2 px-4 pb-2 sm:px-5">
      {list.map(({ sketch: sk, attached }) => (
        <div key={sk.id} className="group relative">
          <Link href={`/projects/${id}/sketch/${sk.id}`} title={attached ? t("drawnFor", { name: sk.name }) : t("cutFrom", { name: sk.name })}
            className="flex items-center gap-2 rounded-xl bg-surface-2/70 py-1 pe-3 ps-1 text-[13px] font-medium ring-1 ring-line hover:ring-line-strong">
            <SketchThumb sk={sk} className="h-8 w-12 rounded-lg bg-surface" />
            <span className="max-w-[160px] truncate"><bdi>{sk.name}</bdi></span>
            {!attached ? <span className="text-[12px] font-normal text-ink-3">{t("parts")}</span> : null}
          </Link>
          {attached && !readOnly ? (
            <IconButton label={t("detach", { name: sk.name })} size="sm" variant="secondary"
              className="absolute -end-2 -top-2 h-5 w-5 rounded-full opacity-0 shadow-[var(--shadow-card)] group-hover:opacity-100 focus:opacity-100 max-sm:opacity-100"
              onClick={() => edit((d) => { const s = d.sketches.find((x) => x.id === sk.id); if (s) s.assembly_id = null; })}><X size={12} /></IconButton>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Pick which of the project's sketches belong to an assembly, or start a new one for it. */
export function AttachSketches({ a, open, onOpenChange }: { a: Assembly; open: boolean; onOpenChange: (o: boolean) => void }) {
  const content = useEditor((s) => s.content);
  const edit = useEditor((s) => s.edit);
  const create = useNewSketch();
  const t = useTranslations("sketch");
  const sketches = content?.sketches ?? [];
  const letterOf = (asmId: string | null) => content?.assemblies.find((x) => x.id === asmId);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("assembly.title", { letter: a.letter, name: a.name || t("editor.assembly") })}
      description={t("assembly.description")}
      footer={<Button variant="primary" icon={<Plus size={15} strokeWidth={2.4} />} onClick={() => { onOpenChange(false); create(a); }}>{t("assembly.newFor", { letter: a.letter })}</Button>}>
      {!sketches.length ? <p className="text-[14px] text-ink-2">{t("assembly.none")}</p> : (
        <ul className="flex flex-col gap-1">
          {sketches.map((sk) => {
            const on = sk.assembly_id === a.id;
            const other = !on && sk.assembly_id ? letterOf(sk.assembly_id) : undefined;
            return (
              <li key={sk.id}>
                <button type="button" aria-pressed={on}
                  onClick={() => edit((d) => { const s = d.sketches.find((x) => x.id === sk.id); if (s) s.assembly_id = on ? null : a.id; })}
                  className={cn("flex w-full items-center gap-3 rounded-xl p-1.5 text-start hover:bg-surface-2", on && "bg-accent-soft hover:bg-accent-soft")}>
                  <SketchThumb sk={sk} className="h-10 w-16 shrink-0 rounded-md bg-surface-2/70" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium"><bdi>{sk.name}</bdi></span>
                  {other ? <span className="flex items-center gap-1 text-[12px] text-ink-3">{t("assembly.nowFor")} <AsmChip letter={other.letter} /></span> : null}
                  <span className={cn("flex h-6 w-6 items-center justify-center rounded-full", on ? "bg-ink text-surface" : "bg-surface-2 text-transparent")}><Check size={14} /></span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-3"><PencilRuler size={13} />{t("assembly.footnote")}</p>
    </Sheet>
  );
}
