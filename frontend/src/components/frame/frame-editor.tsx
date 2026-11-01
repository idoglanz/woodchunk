"use client";

import { ArrowLeft, Box, Download, Maximize, MousePointer2, PenLine, Redo2, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslations } from "use-intl";
import { CutList } from "@/components/frame/cut-list";
import { Inspector } from "@/components/frame/inspector";
import { barAnchors, DimensionLabels, dimensionAnchors, onCanvasOrPage } from "@/components/frame/edit-layers";
import { DepthChip } from "@/components/frame/depth-chip";
import { useFrameEdit } from "@/components/frame/use-frame-edit";
import { MiniView, Viewport, type EditHandlers, type JointMarker } from "@/components/frame/viewport";
import { useProjectCtx } from "@/components/project/context";
import { IconButton } from "@/components/ui/button";
import { EmptyState, Ltr, Skeleton } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import type { Assembly, CatalogItem } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { newId, useEditor } from "@/lib/editor";
import { addMember, commonItem, deleteMembers, mergeNode, moveNode, nodePositions, setMemberLength } from "@/lib/frame/edit";
import { frameStl, saveBlob } from "@/lib/frame/export";
import { evaluate as ev } from "@/lib/frame/expr";
import { useMediaQuery } from "@/lib/focus";
import { solveFrame } from "@/lib/frame/parts";
import type { Frame } from "@/lib/frame/types";
import { FLAT, flatPlane, resetFrameUI, useFrameUI, type Tool, type View } from "@/lib/frame/ui";
import { useCatalog, useItemMap } from "@/lib/queries";
import { isTyping, shortcutKey } from "@/lib/typing";

const VIEWS: View[] = ["iso", "front", "side", "top"];

export function FrameEditor({ assemblyId }: { assemblyId: string }) {
  const t = useTranslations("frame");
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

  if (!asm) return <EmptyState title={t("editor.notFound")} text={t("editor.notFoundText")} action={<Link href={`/projects/${id}/build`} className="font-semibold text-info">{t("editor.backToBuild")}</Link>} />;
  if (!asm.frame) return <EmptyState title={t("editor.noFrame")} text={t("editor.noFrameText")} action={<Link href={`/projects/${id}/build`} className="font-semibold text-info">{t("editor.backToBuild")}</Link>} />;
  if (!catalog.data) return <div className="p-6"><Skeleton className="h-[70dvh] w-full rounded-[16px]" /></div>;
  return <Loaded asm={asm} frame={asm.frame as Frame} byId={byId} readOnly={readOnly} smallScreen={!desktop && !readOnlyProject} projectId={id} />;
}

function Loaded({ asm, frame, byId, readOnly, smallScreen, projectId }: {
  asm: Assembly; frame: Frame; byId: Map<string, CatalogItem>; readOnly: boolean; smallScreen: boolean; projectId: string;
}) {
  const t = useTranslations("frame");
  // While a joint is dragged the frame is previewed (model and cut list) and saved on release.
  const drag = useFrameUI((s) => s.drag);
  const shown = useMemo(() => {
    if (!drag) return frame;
    const copy = structuredClone(frame);
    moveNode(copy, drag.node, drag.at);
    return copy;
  }, [frame, drag]);
  const result = useMemo(() => solveFrame(shown, byId, t), [shown, byId, t]);
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
  const mode = useFrameUI((s) => s.mode);
  const depths = useFrameUI((s) => s.depth);
  // Sizes always; in flat views also every bar's length (click to type a new one).
  const anchors = useMemo(() => {
    if (readOnly) return [];
    // A flat view doesn't label the size that runs toward the viewer (Front: no depth).
    const along: Record<string, number> = { W: 0, D: 1, H: 2 };
    const sizes = dimensionAnchors(shown, t).filter((a) => mode === "3d" || along[a.short] !== FLAT[mode].normal);
    const depthAt = mode === "3d" ? 0 : flatPlane(mode, depths[mode], nodePositions(shown).values()).at;
    return [...sizes, ...(mode === "3d" ? [] : barAnchors(shown, FLAT[mode].normal, depthAt, t))];
  }, [shown, readOnly, mode, depths, t]);

  const handlers: EditHandlers = useMemo(() => ({
    onMove: (node, at, join) => {
      editFrame((f) => {
        moveNode(f, node, at);
        // Dropped on a joint: join them (if moving it didn't move that joint too, via a size).
        const pos = nodePositions(f);
        const [p, q] = [pos.get(node), join ? pos.get(join) : undefined];
        if (join && p && q && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= 0.5) mergeNode(f, node, join);
      });
      const ui = useFrameUI.getState();
      if (join && ui.selected?.kind === "node" && ui.selected.id === node) ui.select({ kind: "node", id: join });
    },
    onParam: (name, mm) => editFrame((f) => { const p = f.params?.find((x) => x.name === name); if (p) p.mm = mm; }),
    onLabel: (key, mm) => {
      const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
      if (kind === "param") editFrame((f) => { const p = f.params?.find((x) => x.name === id); if (p) p.mm = mm; });
      else editFrame((f) => setMemberLength(f, id, mm));
    },
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
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const ui = useFrameUI.getState();
      if (ui.drag) return; // finish (or drop) the drag first
      const key = shortcutKey(e);
      if (key === "v") ui.setTool("select");
      else if (key === "l") ui.setTool("draw");
      // Deleting is stricter: only from the page, the 3D view or the cut list, never a focused button.
      else if ((e.key === "Delete" || e.key === "Backspace") && ui.tool === "select" && onCanvasOrPage(e.target)) deleteSelected();
      else if (e.key === "Escape" && ui.tool === "select") { if (ui.back) ui.goBack(); else ui.select(null); }
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
          <Link href={`/projects/${projectId}/build`} aria-label={t("editor.backToBuild")}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface/90 text-ink-2 shadow-[var(--shadow-card)] backdrop-blur hover:text-ink"><ArrowLeft size={18} className="rtl:-scale-x-100" /></Link>
          <span className="rounded-full bg-surface/90 px-3 py-1.5 text-[14px] font-semibold shadow-[var(--shadow-card)] backdrop-blur">{asm.letter} · <bdi>{asm.name}</bdi></span>
          {!readOnly ? (
            <div role="radiogroup" aria-label={t("editor.tool")} className="flex rounded-full bg-surface/90 p-0.5 shadow-[var(--shadow-card)] backdrop-blur">
              {TOOLS.map((x) => (
                <button key={x.value} type="button" role="radio" aria-checked={tool === x.value} title={t("editor.toolTitle", { tool: t(`editor.${x.value}`), key: x.key })}
                  onClick={() => useFrameUI.getState().setTool(x.value)}
                  className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium", tool === x.value ? "bg-ink text-surface" : "text-ink-2 hover:text-ink")}>
                  <x.icon size={14} />{t(`editor.${x.value}`)}
                </button>
              ))}
            </div>
          ) : null}
          {!readOnly && selected?.kind === "member" && tool === "select" ? (
            <IconButton label={t("editor.deleteBar")} size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]" onClick={deleteSelected}><Trash2 size={16} /></IconButton>
          ) : null}
          <div className="ms-auto flex items-center gap-2">
            <Segmented size="sm" label={t("editor.view")} value={view === "fit" || view === "along" ? "iso" : view} onChange={(v) => look(v)} options={VIEWS.map((v) => ({ value: v, label: t(`editor.views.${v}`) }))} className="bg-surface/90 shadow-[var(--shadow-card)] backdrop-blur" />
            <IconButton label={ortho ? t("editor.perspective") : t("editor.orthographic")} size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]"
              onClick={() => useFrameUI.getState().setOrtho(!ortho)} aria-pressed={ortho}><Box size={16} /></IconButton>
            <IconButton label={t("editor.fit")} size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]" onClick={() => look("fit")}><Maximize size={16} /></IconButton>
            <IconButton label={t("editor.download")} size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]" disabled={!result.members.length}
              onClick={() => saveBlob(frameStl(result.members), `${asm.name || t("editor.fileName")}.stl`)}><Download size={16} /></IconButton>
            {!readOnly ? <>
              <IconButton label={t("editor.undo")} size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]" disabled={!ed.past} onClick={ed.undo}><Undo2 size={16} className="rtl:-scale-x-100" /></IconButton>
              <IconButton label={t("editor.redo")} size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]" disabled={!ed.future} onClick={ed.redo}><Redo2 size={16} className="rtl:-scale-x-100" /></IconButton>
            </> : null}
          </div>
        </div>
        <Viewport frame={shown} members={result.members} joints={joints} steel={steel} readOnly={readOnly} edit={handlers} anchors={tool === "select" ? anchors : []} labels={labels} />
        {/* Left to right in Hebrew too: the labels are placed at screen x. */}
        {tool === "select" ? <div dir="ltr" className="pointer-events-none absolute inset-0 overflow-hidden"><DimensionLabels anchors={anchors} labels={labels} onCommit={handlers.onLabel} /></div> : null}
        {tool === "draw" && !readOnly ? <DrawHint /> : null}
        {tool === "select" && !readOnly ? <DragHint frame={frame} /> : null}
        {mode !== "3d" && !readOnly ? <DepthChip mode={mode} frame={shown} /> : null}
        {mode !== "3d" ? <MiniView members={result.members} steel={steel} /> : null}
      </div>
      <aside aria-label={t("editor.details")}
        className="flex max-h-[54dvh] w-full shrink-0 flex-col overflow-y-auto border-t border-line bg-surface md:max-h-none md:w-[360px] md:border-s md:border-t-0">
        {!readOnly ? <Inspector asm={asm} frame={frame} result={result} byId={byId} /> : null}
        {smallScreen ? <p className="border-b border-line px-4 py-3 text-[13px] text-ink-2">{t("editor.smallScreen")}</p> : null}
        <CutList asm={asm} result={result} byId={byId} />
      </aside>
    </div>
  );
}

// Shortcut letters stay Latin (Hebrew keyboards map to them).
const TOOLS: { value: Tool; key: string; icon: typeof PenLine }[] = [
  { value: "select", key: "V", icon: MousePointer2 },
  { value: "draw", key: "L", icon: PenLine },
];

const SNAP_KEYS = { node: "node", mid: "mid", "on-bar": "onBar", axis: "axis", meet: "meet", square: "square" } as const;

/** While a joint is dragged: what it snapped to, and what releasing there does. */
function DragHint({ frame }: { frame: Frame }) {
  const t = useTranslations("frame");
  const snap = useFrameUI((s) => s.drag?.snap);
  const flat = useFrameUI((s) => s.mode !== "3d");
  if (!snap) return null;
  const bar = (id: string) => {
    const i = frame.members.findIndex((m) => m.id === id);
    return i < 0 ? t("drag.aBar") : frame.members[i].name || t("barN", { n: String(i + 1) });
  };
  const text = snap.kind === "node" ? t("drag.join")
    : snap.kind === "mid" ? t("drag.mid", { bar: bar(snap.member) })
    : snap.kind === "on-bar" ? t("drag.onBar", { bar: bar(snap.member) })
    : snap.aligned.length ? t("drag.aligned", { axes: snap.aligned.map((g) => "XYZ"[g.axis]).join(t("drag.and")) }) : null;
  if (!text) return null;
  return (
    <div className={cn("pointer-events-none absolute inset-x-3 bottom-3 z-10 flex justify-center", flat && "pe-[13rem] sm:pe-[16rem]")}>
      <div role="status" className="rounded-2xl bg-surface/95 px-4 py-2 text-[13px] font-medium text-ink shadow-[var(--shadow-pop)] backdrop-blur">{text}</div>
    </div>
  );
}

function DrawHint() {
  const t = useTranslations("frame");
  const start = useFrameUI((s) => s.drawStart);
  const typed = useFrameUI((s) => s.typed);
  const lock = useFrameUI((s) => s.lockAxis);
  const hover = useFrameUI((s) => s.drawHover);
  const flat = useFrameUI((s) => s.mode !== "3d");
  return (
    <div className={cn("pointer-events-none absolute inset-x-3 bottom-3 z-10 flex justify-center", flat && "pe-[13rem] sm:pe-[16rem]")}>
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl bg-surface/95 px-4 py-2 text-[13px] text-ink-2 shadow-[var(--shadow-pop)] backdrop-blur">
        {!start ? <span>{t("drawHint.start", { where: flat ? "grid" : "floor" })}</span> : <>
          <span>{t("drawHint.next")}</span>
          <span className="tnum min-w-16 rounded-md bg-surface-2 px-2 py-0.5 text-center font-semibold text-ink"><Ltr>{typed ? `${typed} mm` : hover?.len ? `${hover.len} mm` : "— mm"}</Ltr></span>
          <span>{t("drawHint.enter")}</span>
        </>}
        {hover && hover.kind !== "plane" ? <span className="font-medium text-ink">{hover.kind in SNAP_KEYS ? t(`snap.${SNAP_KEYS[hover.kind as keyof typeof SNAP_KEYS]}`) : ""}</span> : null}
        <span className="text-ink-3">{lock !== null ? t("drawHint.locked", { axis: "XYZ"[lock] }) : t("drawHint.shiftLocks")} · {start ? t("drawHint.escEnds") : t("drawHint.escBack")}</span>
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

