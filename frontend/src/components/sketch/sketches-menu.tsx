"use client";

import { PencilRuler, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useProjectCtx } from "@/components/project/context";
import { SketchThumb, useNewSketch } from "@/components/sketch/sketch-card";
import { Button } from "@/components/ui/button";
import { AsmChip } from "@/components/ui/misc";
import { Pop } from "@/components/ui/overlay";
import { useEditor } from "@/lib/editor";
import { solve } from "@/lib/sketch/solve";
import type { Sketch } from "@/lib/sketch/types";

/**
 * The project's sketches from the header, wherever you are in it: open one, or start a new one,
 * without scrolling past the assemblies to the Sketches card.
 */
export function SketchesMenu() {
  const { id } = useProjectCtx();
  const sketches = useEditor((s) => s.content?.sketches ?? []);
  const readOnly = useEditor((s) => s.readOnly);
  const create = useNewSketch();
  const [open, setOpen] = useState(false);
  const assemblies = useEditor((s) => s.content?.assemblies ?? []);
  const asmOf = (asmId: string | null) => assemblies.find((a) => a.id === asmId);
  if (!sketches.length && readOnly) return null;
  return (
    <Pop open={open} onOpenChange={setOpen} align="end" className="w-[300px] p-2"
      trigger={
        // Filled, so it reads apart from the plain header actions around it. Not on phones: the
        // header is tight there, and Build lists the sketches.
        <Button size="sm" variant="secondary" aria-label={`Sketches (${sketches.length})`} title="Sketches" className="max-sm:hidden"
          icon={<PencilRuler size={15} />}>
          <span className="hidden sm:inline">Sketches</span>
          {sketches.length ? <span className="tnum hidden h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1.5 text-[11px] font-semibold text-surface sm:inline-flex">{sketches.length}</span> : null}
        </Button>
      }>
      <div className="flex max-h-[60dvh] flex-col overflow-y-auto">
        {!sketches.length ? <p className="px-2 py-2 text-[13px] text-ink-2">No sketches yet: draw it roughly, pin the sizes you know, and the rest is worked out.</p> : null}
        {sketches.map((sk) => (
          <Link key={sk.id} href={`/projects/${id}/sketch/${sk.id}`} onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-[10px] p-1.5 hover:bg-surface-2">
            <SketchThumb sk={sk} className="h-10 w-16 shrink-0 rounded-md bg-surface-2/70" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[14px] font-medium">{sk.name}</span>
              <span className="flex items-center gap-1.5 truncate text-[12px] text-ink-3">
                {asmOf(sk.assembly_id) ? <AsmChip letter={asmOf(sk.assembly_id)!.letter} className="h-4 min-w-4 px-1 text-[10px]" /> : null}
                {sketchNote(sk)}
              </span>
            </span>
          </Link>
        ))}
      </div>
      {!readOnly ? (
        <div className="mt-1 border-t border-line pt-1.5">
          <Button size="sm" variant="ghost" className="w-full justify-start" icon={<Plus size={15} strokeWidth={2.4} />}
            onClick={() => { setOpen(false); create(); }}>New sketch</Button>
        </div>
      ) : null}
    </Pop>
  );
}

/** "Fully defined", "3 to pin down", "Conflicting" or "Empty". */
function sketchNote(sk: Sketch): string {
  if (!sk.shapes.length) return "Empty";
  const r = solve(sk);
  return !r.ok ? "Conflicting" : r.dof ? `${r.dof} to pin down` : "Fully defined";
}
