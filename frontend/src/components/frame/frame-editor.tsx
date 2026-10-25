"use client";

import { ArrowLeft, Box, Download, Maximize, MousePointer2, PenLine, Redo2, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { CutList } from "@/components/frame/cut-list";
import { Inspector } from "@/components/frame/inspector";
import { DimensionLabels, dimensionAnchors, onCanvasOrPage } from "@/components/frame/edit-layers";
import { useFrameEdit } from "@/components/frame/use-frame-edit";
import { Viewport, type EditHandlers, type JointMarker } from "@/components/frame/viewport";
import { useProjectCtx } from "@/components/project/context";
import { IconButton } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import type { Assembly, CatalogItem } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { newId, useEditor } from "@/lib/editor";
import { addMember, commonItem, deleteMembers, moveNode, nodePositions } from "@/lib/frame/edit";
import { frameStl, saveBlob } from "@/lib/frame/export";
import { evaluate as ev } from "@/lib/frame/expr";
import { useMediaQuery } from "@/lib/focus";
import { solveFrame } from "@/lib/frame/parts";
import type { Frame } from "@/lib/frame/types";
import { resetFrameUI, useFrameUI, type Tool, type View } from "@/lib/frame/ui";
import { useCatalog, useItemMap } from "@/lib/queries";

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
  // The frame's own materials too, even if the list hides them (retired or suggested items).
  const byId = useItemMap(catalog.data, asm?.frame?.members.map((m) => m.item_id) ?? []);

  // Leaving the editor resets its view state (next time starts fitted, in Select, nothing pending).
  useEffect(() => () => resetFrameUI(), []);

  if (!asm) return <EmptyState title="Assembly not found" text="It may have been deleted." action={<Link href={`/projects/${id}/build`} className="font-semibold text-info">Back to Build</Link>} />;
  if (!asm.frame) return <EmptyState title="No 3D frame yet" text="Start one from the assembly's menu on the Build tab." action={<Link href={`/projects/${id}/build`} className="font-semibold text-info">Back to Build</Link>} />;
  if (!catalog.data) return <div className="p-6"><Skeleton className="h-[70dvh] w-full rounded-[16px]" /></div>;
  return <Loaded asm={asm} frame={asm.frame as Frame} byId={byId} readOnly={readOnly} smallScreen={!desktop && !readOnlyProject} projectId={id} />;
}

function Loaded({ asm, frame, byId, readOnly, smallScreen, projectId }: {
  asm: Assembly; frame: Frame; byId: Map<string, CatalogItem>; readOnly: boolean; smallScreen: boolean; projectId: string;
}) {
  // While a joint is dragged the frame is previewed (model and cut list) and saved on release.
  const drag = useFrameUI((s) => s.drag);
  const shown = useMemo(() => {
    if (!drag) return frame;
    const copy = structuredClone(frame);
    moveNode(copy, drag.node, drag.at);
    return copy;
  }, [frame, drag]);
  const result = useMemo(() => solveFrame(shown, byId), [shown, byId]);
  const steel = useMemo(() => new Set([...byId.values()].filter((i) => i.material === "steel").map((i) => i.id)), [byId]);
  const joints = useMemo(() => jointMarkers(shown, result.members), [shown, result.members]);
  const ed = { past: useEditor((s) => s.past.length), future: useEditor((s) => s.future.length), undo: useEditor((s) => s.undo), redo: useEditor((s) => s.redo) };
  const ortho = useFrameUI((s) => s.ortho);
  const look = useFrameUI((s) => s.look);
  const view = useFrameUI((s) => s.view.name);
  const tool = useFrameUI((s) => s.tool);
  const selected = useFrameUI((s) => s.selected);
  const editFrame = useFrameEdit(asm.id, byId);
  const labels = useRef(new Map<string, HTMLElement>());
  const anchors = useMemo(() => (readOnly ? [] : dimensionAnchors(shown)), [shown, readOnly]);

  const handlers: EditHandlers = useMemo(() => ({
    onMove: (node, at) => editFrame((f) => moveNode(f, node, at)),
    onParam: (name, mm) => editFrame((f) => { const p = f.params?.find((x) => x.name === name); if (p) p.mm = mm; }),
    onAdd: (from, to) => {
      if (!from) return null;
      const current = useEditor.getState().content?.assemblies.find((a) => a.id === asm.id)?.frame as Frame | undefined;
      if (!current) return null;
      // The start joint may be gone (undo mid-chain): start from its position instead.
      const start = from.node && current.nodes.some((n) => n.id === from.node) ? { node: from.node } : { at: from.at };
      // Try it on a copy first, so a bar that can't be added changes nothing (no stray joints, no empty undo step).
      if (!addMember(structuredClone(current), start, to, null, () => newId().slice(0, 10))) return null;
      let end: { node: string; at: [number, number, number] } | null = null;
      editFrame((f) => {
        const item = useFrameUI.getState().drawItem ?? commonItem(f);
        const res = addMember(f, start, to, item, () => newId().slice(0, 10));
        const at = res ? nodePositions(f).get(res.end) : undefined;
        if (res && at) end = { node: res.end, at };
      });
      return end;
    },
  }), [editFrame, asm.id]);

  const deleteSelected = useCallback(() => {
    const s = useFrameUI.getState().selected;
    if (s?.kind !== "member") return;
    editFrame((f) => deleteMembers(f, [s.id]));
    useFrameUI.getState().select(null);
  }, [editFrame]);

  // Shortcuts: V select, L draw, Delete removes the selected bar.
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !onCanvasOrPage(e.target)) return;
      const ui = useFrameUI.getState();
      if (ui.drag) return; // finish (or drop) the drag first
      if (e.key === "v" || e.key === "V") ui.setTool("select");
      else if (e.key === "l" || e.key === "L") ui.setTool("draw");
      else if ((e.key === "Delete" || e.key === "Backspace") && ui.tool === "select") deleteSelected();
      else if (e.key === "Escape" && ui.tool === "select") ui.select(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readOnly, deleteSelected]);

  return (
    <div className="flex h-[calc(100dvh-52px)] flex-col overflow-hidden md:flex-row">
      <div className={cn("relative min-h-[46dvh] min-w-0 flex-1", tool === "draw" && !readOnly && "cursor-crosshair")}>
        <div className="absolute inset-x-3 top-3 z-10 flex flex-wrap items-center gap-2">
          <Link href={`/projects/${projectId}/build`} aria-label="Back to Build"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface/90 text-ink-2 shadow-[var(--shadow-card)] backdrop-blur hover:text-ink"><ArrowLeft size={18} /></Link>
          <span className="rounded-full bg-surface/90 px-3 py-1.5 text-[14px] font-semibold shadow-[var(--shadow-card)] backdrop-blur">{asm.letter} · {asm.name}</span>
          {!readOnly ? (
            <div role="radiogroup" aria-label="Tool" className="flex rounded-full bg-surface/90 p-0.5 shadow-[var(--shadow-card)] backdrop-blur">
              {TOOLS.map((t) => (
                <button key={t.value} type="button" role="radio" aria-checked={tool === t.value} title={`${t.label} (${t.key})`}
                  onClick={() => useFrameUI.getState().setTool(t.value)}
                  className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium", tool === t.value ? "bg-ink text-surface" : "text-ink-2 hover:text-ink")}>
                  <t.icon size={14} />{t.label}
                </button>
              ))}
            </div>
          ) : null}
          {!readOnly && selected?.kind === "member" && tool === "select" ? (
            <IconButton label="Delete bar (Delete)" size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]" onClick={deleteSelected}><Trash2 size={16} /></IconButton>
          ) : null}
          <div className="ms-auto flex items-center gap-2">
            <Segmented size="sm" label="View" value={view === "fit" ? "iso" : view} onChange={(v) => look(v)} options={VIEWS} className="bg-surface/90 shadow-[var(--shadow-card)] backdrop-blur" />
            <IconButton label={ortho ? "Perspective" : "Orthographic"} size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]"
              onClick={() => useFrameUI.getState().setOrtho(!ortho)} aria-pressed={ortho}><Box size={16} /></IconButton>
            <IconButton label="Fit to frame" size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]" onClick={() => look("fit")}><Maximize size={16} /></IconButton>
            <IconButton label="Download 3D model (STL)" size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]" disabled={!result.members.length}
              onClick={() => saveBlob(frameStl(result.members), `${asm.name || "frame"}.stl`)}><Download size={16} /></IconButton>
            {!readOnly ? <>
              <IconButton label="Undo (⌘Z)" size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]" disabled={!ed.past} onClick={ed.undo}><Undo2 size={16} /></IconButton>
              <IconButton label="Redo (⇧⌘Z)" size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]" disabled={!ed.future} onClick={ed.redo}><Redo2 size={16} /></IconButton>
            </> : null}
          </div>
        </div>
        <Viewport frame={shown} members={result.members} joints={joints} steel={steel} readOnly={readOnly} edit={handlers} anchors={tool === "select" ? anchors : []} labels={labels} />
        {tool === "select" ? <div className="pointer-events-none absolute inset-0 overflow-hidden"><DimensionLabels anchors={anchors} labels={labels} onParam={handlers.onParam} /></div> : null}
        {tool === "draw" && !readOnly ? <DrawHint /> : null}
      </div>
      <aside aria-label="Frame details"
        className="flex max-h-[54dvh] w-full shrink-0 flex-col overflow-y-auto border-t border-line bg-surface md:max-h-none md:w-[360px] md:border-s md:border-t-0">
        {!readOnly ? <Inspector asm={asm} frame={frame} result={result} byId={byId} /> : null}
        {smallScreen ? <p className="border-b border-line px-4 py-3 text-[13px] text-ink-2">Look around and check the cut list here. To change the frame, open it on a larger screen.</p> : null}
        <CutList asm={asm} result={result} byId={byId} />
      </aside>
    </div>
  );
}

const TOOLS: { value: Tool; label: string; key: string; icon: typeof PenLine }[] = [
  { value: "select", label: "Select", key: "V", icon: MousePointer2 },
  { value: "draw", label: "Draw", key: "L", icon: PenLine },
];

const SNAP_NAMES: Record<string, string> = { node: "On a joint", mid: "Middle of a bar", "on-bar": "On a bar (T-joint)", axis: "Along an axis" };

function DrawHint() {
  const start = useFrameUI((s) => s.drawStart);
  const typed = useFrameUI((s) => s.typed);
  const lock = useFrameUI((s) => s.lockAxis);
  const hover = useFrameUI((s) => s.drawHover);
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex justify-center">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl bg-surface/95 px-4 py-2 text-[13px] text-ink-2 shadow-[var(--shadow-pop)] backdrop-blur">
        {!start ? <span>Click a joint, a bar or the floor to start a bar.</span> : <>
          <span>Click to place the next joint, or type a length</span>
          <span className="tnum min-w-16 rounded-md bg-surface-2 px-2 py-0.5 text-center font-semibold text-ink">{typed ? `${typed} mm` : hover?.len ? `${hover.len} mm` : "— mm"}</span>
          <span>then Enter.</span>
        </>}
        {hover && hover.kind !== "plane" ? <span className="font-medium text-ink">{SNAP_NAMES[hover.kind] ?? ""}</span> : null}
        <span className="text-ink-3">{lock !== null ? `Locked to ${"XYZ"[lock]}` : "Shift locks an axis"} · Esc {start ? "ends the chain" : "back to Select"}</span>
      </div>
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

