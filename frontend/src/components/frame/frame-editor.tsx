"use client";

import { ArrowLeft, Box, Maximize, Redo2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { CutList } from "@/components/frame/cut-list";
import { Inspector } from "@/components/frame/inspector";
import { Viewport, type JointMarker } from "@/components/frame/viewport";
import { useProjectCtx } from "@/components/project/context";
import { IconButton } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import type { Assembly, CatalogItem } from "@/lib/api/client";
import { useEditor } from "@/lib/editor";
import { evaluate as ev } from "@/lib/frame/expr";
import { useMediaQuery } from "@/lib/focus";
import { solveFrame } from "@/lib/frame/parts";
import type { Frame } from "@/lib/frame/types";
import { useFrameUI, type View } from "@/lib/frame/ui";
import { useCatalog } from "@/lib/queries";

const VIEWS: { value: View; label: string }[] = [
  { value: "iso", label: "3D" }, { value: "front", label: "Front" }, { value: "side", label: "Side" }, { value: "top", label: "Top" },
];

export function FrameEditor({ assemblyId }: { assemblyId: string }) {
  const { id } = useProjectCtx();
  const asm = useEditor((s) => s.content?.assemblies.find((a) => a.id === assemblyId));
  const readOnlyProject = useEditor((s) => s.readOnly);
  const desktop = useMediaQuery("(min-width: 900px)");
  const readOnly = readOnlyProject || !desktop;
  const catalog = useCatalog({ kind: "lumber" });
  const byId = useMemo(() => new Map((catalog.data ?? []).map((i) => [i.id, i])), [catalog.data]);

  useEffect(() => () => useFrameUI.getState().select(null), []);

  if (!asm) return <EmptyState title="Assembly not found" text="It may have been deleted." action={<Link href={`/projects/${id}/build`} className="font-semibold text-info">Back to Build</Link>} />;
  if (!asm.frame) return <EmptyState title="No 3D frame yet" text="Start one from the assembly's menu on the Build tab." action={<Link href={`/projects/${id}/build`} className="font-semibold text-info">Back to Build</Link>} />;
  if (!catalog.data) return <div className="p-6"><Skeleton className="h-[70dvh] w-full rounded-[16px]" /></div>;
  return <Loaded asm={asm} frame={asm.frame as Frame} byId={byId} readOnly={readOnly} projectId={id} />;
}

function Loaded({ asm, frame, byId, readOnly, projectId }: {
  asm: Assembly; frame: Frame; byId: Map<string, CatalogItem>; readOnly: boolean; projectId: string;
}) {
  const result = useMemo(() => solveFrame(frame, byId), [frame, byId]);
  const steel = useMemo(() => new Set([...byId.values()].filter((i) => i.material === "steel").map((i) => i.id)), [byId]);
  const joints = useMemo(() => jointMarkers(frame, result.members), [frame, result.members]);
  const ed = useEditor();
  const ortho = useFrameUI((s) => s.ortho);
  const look = useFrameUI((s) => s.look);
  const view = useFrameUI((s) => s.view.name);

  return (
    <div className="flex h-[calc(100dvh-52px)] flex-col overflow-hidden md:flex-row">
      <div className="relative min-h-[46dvh] min-w-0 flex-1">
        <div className="absolute inset-x-3 top-3 z-10 flex flex-wrap items-center gap-2">
          <Link href={`/projects/${projectId}/build`} aria-label="Back to Build"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface/90 text-ink-2 shadow-[var(--shadow-card)] backdrop-blur hover:text-ink"><ArrowLeft size={18} /></Link>
          <span className="rounded-full bg-surface/90 px-3 py-1.5 text-[14px] font-semibold shadow-[var(--shadow-card)] backdrop-blur">{asm.letter} · {asm.name}</span>
          <div className="ms-auto flex items-center gap-2">
            <Segmented size="sm" label="View" value={view === "fit" ? "iso" : view} onChange={(v) => look(v)} options={VIEWS} className="bg-surface/90 shadow-[var(--shadow-card)] backdrop-blur" />
            <IconButton label={ortho ? "Perspective" : "Orthographic"} size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]"
              onClick={() => useFrameUI.getState().setOrtho(!ortho)} aria-pressed={ortho}><Box size={16} /></IconButton>
            <IconButton label="Fit to frame" size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]" onClick={() => look("fit")}><Maximize size={16} /></IconButton>
            {!readOnly ? <>
              <IconButton label="Undo (⌘Z)" size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]" disabled={!ed.past.length} onClick={ed.undo}><Undo2 size={16} /></IconButton>
              <IconButton label="Redo (⇧⌘Z)" size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]" disabled={!ed.future.length} onClick={ed.redo}><Redo2 size={16} /></IconButton>
            </> : null}
          </div>
        </div>
        <Viewport members={result.members} joints={joints} steel={steel} readOnly={readOnly} />
      </div>
      <aside aria-label="Frame details"
        className="flex max-h-[54dvh] w-full shrink-0 flex-col overflow-y-auto border-t border-line bg-surface md:max-h-none md:w-[360px] md:border-s md:border-t-0">
        {!readOnly ? <Inspector asm={asm} frame={frame} result={result} byId={byId} /> : null}
        <CutList asm={asm} result={result} byId={byId} />
      </aside>
    </div>
  );
}

/** A marker at every node where members meet (to pick a joint and change how it's cut). */
function jointMarkers(frame: Frame, members: { id: string; profile: { w: number; h: number } }[]): JointMarker[] {
  const count = new Map<string, number>();
  for (const m of frame.members) for (const n of [m.a, m.b]) count.set(n, (count.get(n) ?? 0) + 1);
  const size = Math.max(8, Math.min(30, ...members.map((m) => Math.min(m.profile.w, m.profile.h) * 0.45)));
  const params = Object.fromEntries((frame.params ?? []).map((p) => [p.name, p.mm]));
  const out: JointMarker[] = [];
  for (const n of frame.nodes) {
    if ((count.get(n.id) ?? 0) < 2) continue;
    try {
      out.push({ id: n.id, at: [ev(n.x, params), ev(n.y, params), ev(n.z, params)], size });
    } catch { /* bad expressions are reported in the cut list warnings */ }
  }
  return out;
}

