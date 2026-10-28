"use client";

import { Copy, MoreHorizontal, PencilRuler, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useProjectCtx } from "@/components/project/context";
import { Button, IconButton } from "@/components/ui/button";
import { AsmChip, Card } from "@/components/ui/misc";
import { Menu, MenuItem } from "@/components/ui/overlay";
import { newId, useEditor } from "@/lib/editor";
import { newSketch, pointAt } from "@/lib/sketch/model";
import { syncParts } from "@/lib/sketch/parts";
import { solve } from "@/lib/sketch/solve";
import type { Sketch } from "@/lib/sketch/types";
import { arcSweep, fit, radiusOf } from "@/lib/sketch/view";
import { toast } from "@/lib/toast";

/** Build's list of the project's sketches: a preview of each, and a button for a new one. */
export function SketchesCard() {
  const sketches = useEditor((s) => s.content?.sketches ?? []);
  const readOnly = useEditor((s) => s.readOnly);
  const create = useNewSketch();
  if (!sketches.length && readOnly) return null;
  return (
    <Card className="flex flex-col">
      <div className="flex items-center gap-3 px-4 pb-2 pt-4 sm:px-5">
        <PencilRuler size={18} className="text-ink-2" />
        <h2 className="text-[17px] font-semibold">Sketches</h2>
        {!readOnly && sketches.length ? <Button size="sm" variant="ghost" className="ms-auto" icon={<Plus size={15} strokeWidth={2.4} />} onClick={() => create()}>New sketch</Button> : null}
      </div>
      {!sketches.length ? (
        <div className="flex flex-wrap items-center gap-3 px-4 pb-4 sm:px-5">
          <p className="min-w-0 flex-1 text-[14px] text-ink-2">Draw it roughly, pin the sizes and angles you know, and the rest is worked out.</p>
          <Button size="sm" icon={<Plus size={15} strokeWidth={2.4} />} onClick={() => create()}>New sketch</Button>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 px-4 pb-4 sm:px-5">
          {sketches.map((sk) => <SketchTile key={sk.id} sk={sk} readOnly={readOnly} />)}
        </ul>
      )}
    </Card>
  );
}

/** As many as a project holds (the server's limit). */
const MAX_SKETCHES = 50;

/** Start a sketch (for an assembly, if given) and open it. */
export function useNewSketch() {
  const { id } = useProjectCtx();
  const router = useRouter();
  const edit = useEditor((s) => s.edit);
  return (assembly?: { id: string; name: string }) => {
    const existing = useEditor.getState().content?.sketches ?? [];
    if (existing.length >= MAX_SKETCHES) { toast.error(`A project holds up to ${MAX_SKETCHES} sketches. Delete one to start another.`); return; }
    const sk = newSketch(existing, assembly);
    edit((d) => { d.sketches.push(sk); });
    router.push(`/projects/${id}/sketch/${sk.id}`);
  };
}

function SketchTile({ sk, readOnly }: { sk: Sketch; readOnly: boolean }) {
  const { id } = useProjectCtx();
  const edit = useEditor((s) => s.edit);
  const full = useEditor((s) => (s.content?.sketches.length ?? 0) >= MAX_SKETCHES);
  const asm = useEditor((s) => s.content?.assemblies.find((a) => a.id === sk.assembly_id));
  const status = useMemo(() => (sk.shapes.length ? solve(sk) : null), [sk]);
  const note = !status ? "Empty" : !status.ok ? "Conflicting" : status.dof ? `${status.dof} to pin down` : "Fully defined";
  return (
    <li className="group relative flex flex-col overflow-hidden rounded-xl bg-surface-2/60 ring-1 ring-line hover:ring-line-strong">
      <Link href={`/projects/${id}/sketch/${sk.id}`} className="flex flex-col">
        <SketchThumb sk={sk} className="h-[110px] w-full" />
        <span className="flex items-center gap-1.5 truncate px-3 pt-2 text-[14px] font-semibold">
          {asm ? <AsmChip letter={asm.letter} className="h-5 min-w-5 px-1 text-[11px]" /> : null}{sk.name}
        </span>
        <span className={status && !status.ok ? "px-3 pb-2.5 text-[12px] text-kerf" : "px-3 pb-2.5 text-[12px] text-ink-3"}>{note}</span>
      </Link>
      {!readOnly ? (
        <div className="absolute end-1.5 top-1.5">
          <Menu trigger={<IconButton label="Sketch options" size="sm" className="bg-surface/90"><MoreHorizontal size={16} /></IconButton>}>
            <MenuItem icon={<Copy size={16} />} disabled={full} onSelect={() => edit((d) => {
              const i = d.sketches.findIndex((x) => x.id === sk.id);
              d.sketches.splice(i + 1, 0, { ...structuredClone(sk), id: newId(), name: `${sk.name} copy`.slice(0, 80) });
            })}>Duplicate</MenuItem>
            <MenuItem icon={<Trash2 size={16} />} danger onSelect={() => edit((d) => {
              d.sketches = d.sketches.filter((x) => x.id !== sk.id);
              syncParts(d, sk.id); // its parts keep their lengths, unlinked
            })}>Delete</MenuItem>
          </Menu>
        </div>
      ) : null}
    </li>
  );
}

/** A small drawing of the sketch, fitted to its box (no dimensions). */
export function SketchThumb({ sk, className }: { sk: Sketch; className?: string }) {
  const W = 300, H = 160;
  const v = fit(sk, W, H, 16);
  const s = (p: [number, number]) => `${(p[0] - v.cx) * v.scale + W / 2},${H / 2 - (p[1] - v.cy) * v.scale}`;
  const paths = sk.shapes.map((sh) => {
    if (sh.kind === "line") return `M${s(pointAt(sk, sh.a))}L${s(pointAt(sk, sh.b))}`;
    const r = radiusOf(sk, sh) * v.scale;
    if (sh.kind === "circle") {
      const [cx, cy] = s(pointAt(sk, sh.c)).split(",").map(Number);
      return `M${cx - r},${cy}a${r},${r} 0 1 0 ${2 * r},0a${r},${r} 0 1 0 ${-2 * r},0`;
    }
    return `M${s(pointAt(sk, sh.a))}A${r},${r} 0 ${arcSweep(sk, sh).sweep > Math.PI ? 1 : 0} 0 ${s(pointAt(sk, sh.b))}`;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <path d={paths.join("")} fill="none" stroke="var(--ink)" strokeWidth={1.6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
