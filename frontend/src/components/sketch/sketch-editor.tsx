"use client";

import { ArrowLeft, Circle, Hammer, Maximize, Rows3, MousePointer2, PenLine, Redo2, Ruler, SquareDashed, Spline, Square, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useProjectCtx } from "@/components/project/context";
import { SaveIndicator } from "@/components/project/workspace";
import { DimensionInput, fmt, SketchCanvas } from "@/components/sketch/canvas";
import { GridControl } from "@/components/sketch/grid-control";
import { MakeParts } from "@/components/sketch/make-parts";
import { RepeatDialog } from "@/components/sketch/repeat-dialog";
import { RELATION_KEYS, ShortcutsHelp } from "@/components/sketch/shortcuts";
import { Button, IconButton } from "@/components/ui/button";
import { Switch } from "@/components/ui/field";
import { AsmChip, EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { useEditor } from "@/lib/editor";
import { useMediaQuery } from "@/lib/focus";
import { acting, addDimension, addRelation, constraintName, deleteItems, dimensionFor, dimensionValue, isDimension, itemNames, movable, pointAt, relationOptions, setConstruction, setDimension, take, type RelationOption } from "@/lib/sketch/model";
import { partLabels, partLines, syncParts } from "@/lib/sketch/parts";
import { solve } from "@/lib/sketch/solve";
import { isBuiltIn, isMid, type Constraint, type Sketch } from "@/lib/sketch/types";
import { useSketchUI, type Tool } from "@/lib/sketch/ui";
import { fit, measured, type View } from "@/lib/sketch/view";
import { toast } from "@/lib/toast";
import { isTyping } from "@/lib/typing";
import type { Units } from "@/lib/units";

const TOOLS: { value: Tool; label: string; key: string; icon: typeof PenLine }[] = [
  { value: "select", label: "Select", key: "V", icon: MousePointer2 },
  { value: "line", label: "Line", key: "L", icon: PenLine },
  { value: "rect", label: "Rectangle", key: "R", icon: Square },
  { value: "circle", label: "Circle", key: "C", icon: Circle },
  { value: "arc", label: "Arc", key: "A", icon: Spline },
  { value: "dimension", label: "Dimension", key: "D", icon: Ruler },
];

export function SketchEditor({ sketchId }: { sketchId: string }) {
  const { id: projectId } = useProjectCtx();
  const sk = useEditor((s) => s.content?.sketches.find((x) => x.id === sketchId));
  useEffect(() => () => useSketchUI.getState().reset(), []);
  if (!sk) {
    return <EmptyState title="Sketch not found" text="It may have been deleted." action={<Link href={`/projects/${projectId}/build`} className="font-semibold text-info">Back to Build</Link>} />;
  }
  return <Loaded sk={sk} projectId={projectId} />;
}

function Loaded({ sk, projectId }: { sk: Sketch; projectId: string }) {
  const { units } = useProjectCtx();
  const readOnly = useEditor((s) => s.readOnly);
  const edit = useEditor((s) => s.edit);
  const desktop = useMediaQuery("(min-width: 900px)");
  const canDraw = !readOnly && desktop;
  const canType = !readOnly;
  const ui = useSketchUI();
  const history = { past: useEditor((s) => s.past.length), future: useEditor((s) => s.future.length), undo: useEditor((s) => s.undo), redo: useEditor((s) => s.redo) };

  /** Change this sketch through the project editor (autosave, undo), re-solved. */
  const editSketch = useCallback((fn: (d: Sketch) => void, key?: string) => {
    edit((c) => {
      const d = c.sketches.find((x) => x.id === sk.id);
      if (!d) return;
      fn(d);
      const r = solve(d, { quick: true });
      if (r.ok) take(d, r.sketch);
      syncParts(c, d.id); // parts cut to its lines follow, in the same undo step
    }, key);
  }, [edit, sk.id]);

  const status = useMemo(() => solve(sk), [sk]);
  const content = useEditor((s) => s.content);
  const parts = useMemo(() => (content ? partLabels(content, sk.id) : new Map<string, { label: string; letter: string; name: string }>()), [content, sk.id]);
  const shown = useMemo(() => (ui.drag ? solve(sk, { drag: ui.drag, quick: true }).sketch : sk), [sk, ui.drag]);

  // The canvas fills its box; the view starts fitted to the sketch.
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const latest = useCallback(() => useEditor.getState().content?.sketches.find((x) => x.id === sk.id) ?? sk, [sk]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width: w, height: h } = e.contentRect;
      setSize({ w, h });
      setView((v) => v ?? (w ? fit(latest(), w, h) : null));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [latest]);
  const fitView = useCallback(() => setView(fit(latest(), size.w, size.h)), [latest, size.w, size.h]);
  const updateView = useCallback((next: View | ((v: View) => View)) => setView((v) => (v ? (typeof next === "function" ? next(v) : next) : v)), []);

  const onSetDimension = useCallback((cid: string, value: number) => {
    const c = sk.constraints.find((x) => x.id === cid);
    if (!c) return;
    // A worked-out value typed as it already is: nothing to change.
    if (!c.driving && Math.abs(measured(sk, c) - value) < 0.05) return;
    const trial = structuredClone(sk);
    const r = setDimension(trial, cid, value);
    if (!r.ok) {
      toast.error(c.driving
        ? "That doesn't fit with the other dimensions. Change or delete one of them first."
        : "This one is worked out from the others. Change one of those, or delete one, to set it directly.");
      return;
    }
    editSketch((d) => { setDimension(d, cid, value); }, `dim-${cid}`);
  }, [sk, editSketch]);

  const onDimension = useCallback((kind: Constraint["kind"], refs: string[]) => {
    if (!canType) return;
    const existing = sk.constraints.find((c) => c.kind === kind && c.refs.length === refs.length && c.refs.every((r, i) => r === refs[i]));
    if (existing) { useSketchUI.getState().set({ editing: existing.id }); return; }
    let added: { constraint: Constraint; driving: boolean } | null = null;
    editSketch((d) => { added = addDimension(d, kind, refs); });
    const a = added as { constraint: Constraint; driving: boolean } | null;
    if (!a) return;
    if (a.driving) useSketchUI.getState().set({ editing: a.constraint.id });
    else toast.info("Already decided by the rest: shown as a worked-out value.");
  }, [sk, canType, editSketch]);

  const deleteSelected = useCallback(() => {
    const ids = acting(useSketchUI.getState().selected);
    if (!ids.length) return;
    editSketch((d) => deleteItems(d, ids));
    useSketchUI.getState().select([]);
  }, [editSketch]);

  const relate = useCallback((o: RelationOption) => {
    const r = addRelation(structuredClone(sk), o);
    if (!r.ok) { toast.error(`Can't make that ${o.label.toLowerCase()}: it doesn't fit with the rest.`); return; }
    editSketch((d) => { addRelation(d, o); });
    if (o.kind === "coincident") useSketchUI.getState().select([]); // the point left may be either one
  }, [sk, editSketch]);

  /** Move the selection by `d` mm, if the constraints let it. */
  const nudge = useCallback((d: [number, number]) => {
    const points = [...new Set(useSketchUI.getState().selected.flatMap((x) => movable(sk, x)))];
    if (!points.length) return;
    const drag = points.map((p) => { const [x, y] = pointAt(sk, p); return { point: p, to: [x + d[0], y + d[1]] as [number, number] }; });
    editSketch((s) => take(s, solve(s, { drag, quick: true }).sketch), "nudge");
  }, [sk, editSketch]);

  /** Selected shapes to helpers (construction), or all back to drawing if they all are. */
  const toggleConstruction = useCallback(() => {
    const ids = acting(useSketchUI.getState().selected).filter((x) => sk.shapes.some((s) => s.id === x));
    if (!ids.length) return;
    const on = !ids.every((x) => sk.shapes.find((s) => s.id === x)?.construction);
    editSketch((d) => setConstruction(d, ids, on));
  }, [sk, editSketch]);

  const [help, setHelp] = useState(false);

  // Keyboard shortcuts (the list is in shortcuts.tsx, behind the keyboard button and ?).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || isTyping(e.target)) return;
      const s = useSketchUI.getState();
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (e.metaKey || e.ctrlKey) {
        if (key === "a" && canDraw) { e.preventDefault(); s.select(sk.shapes.map((x) => x.id)); }
        return; // ⌘Z and the rest are the app's
      }
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) { setHelp((h) => !h); return; }
      if (e.key === "Escape") {
        if (s.anchors.length || s.picks.length) s.set({ anchors: [], picks: [], typed: "" });
        else if (s.selected.length) s.select([]);
        else s.setTool("select");
        return;
      }
      // Seeing: fit, zoom, measurements (phones and viewers too).
      if (key === "f" && !e.shiftKey) { fitView(); return; }
      if (key === "=" || key === "+" || key === "-" || key === "_") {
        const k = key === "-" || key === "_" ? 1 / 1.25 : 1.25;
        updateView((v) => ({ ...v, scale: Math.max(0.005, Math.min(60, v.scale * k)) }));
        return;
      }
      if (key === "m" && !e.shiftKey) { s.set({ showAll: !s.showAll }); return; }
      if (key === "g" && !e.shiftKey) { s.setGrid({ snap: !s.snap }); toast.info(`Snap to grid ${s.snap ? "off" : "on"}`); return; }
      if (!canDraw) return;
      if ((e.key === "Delete" || e.key === "Backspace") && s.selected.length) { e.preventDefault(); deleteSelected(); return; }
      if (e.key.startsWith("Arrow") && s.selected.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        nudge(e.key === "ArrowLeft" ? [-step, 0] : e.key === "ArrowRight" ? [step, 0] : e.key === "ArrowUp" ? [0, step] : [0, -step]);
        return;
      }
      if (e.key === "Enter" && s.tool === "dimension" && s.picks.length) {
        const dim = dimensionFor(sk, acting(s.picks));
        if (dim) onDimension(dim.kind, dim.refs);
        s.set({ picks: [] });
        return;
      }
      if (e.shiftKey && s.selected.length) {
        // Shift + letter: that relation on the selection, when it fits.
        const o = relationOptions(sk, acting(s.selected)).find((x) => RELATION_KEYS[x.kind]?.toLowerCase() === key);
        if (o) { e.preventDefault(); relate(o); }
        return;
      }
      if (key === "x") { toggleConstruction(); return; }
      if (key === "d" && s.tool === "select" && s.selected.length) {
        // D on a selection dimensions it, if it's something that has a size.
        const dim = dimensionFor(sk, acting(s.selected));
        if (dim) { onDimension(dim.kind, dim.refs); return; }
      }
      const t = TOOLS.find((x) => x.key.toLowerCase() === key);
      if (t) s.setTool(t.value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canDraw, deleteSelected, onDimension, sk, relate, nudge, fitView, updateView, toggleConstruction]);

  return (
    <div className="flex h-[calc(100dvh-52px)] flex-col md:flex-row">
      <div className="relative min-h-[46dvh] min-w-0 flex-1" ref={box}>
        {view && size.w ? (
          <SketchCanvas sketch={shown} status={status} canDraw={canDraw} canType={canType} units={units} view={view} setView={updateView} size={size}
            onEdit={editSketch} onSetDimension={onSetDimension} onDimension={onDimension} onFit={fitView} parts={parts} />
        ) : null}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-center gap-2 [&>*]:pointer-events-auto">
          <Link href={`/projects/${projectId}/build`} aria-label="Back to Build"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface/90 text-ink-2 shadow-[var(--shadow-card)] backdrop-blur hover:text-ink"><ArrowLeft size={18} /></Link>
          <span className="max-w-[40vw] truncate rounded-full bg-surface/90 px-3 py-1.5 text-[14px] font-semibold shadow-[var(--shadow-card)] backdrop-blur">{sk.name}</span>
          {canDraw ? (
            <div role="radiogroup" aria-label="Tool" className="flex rounded-full bg-surface/90 p-0.5 shadow-[var(--shadow-card)] backdrop-blur">
              {TOOLS.map((t) => (
                <button key={t.value} type="button" role="radio" aria-checked={ui.tool === t.value} title={`${t.label} (${t.key})`} aria-label={t.label}
                  onClick={() => ui.setTool(t.value)}
                  className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium xl:px-3", ui.tool === t.value ? "bg-ink text-surface" : "text-ink-2 hover:text-ink")}>
                  <t.icon size={14} /><span className="hidden xl:inline">{t.label}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="ms-auto flex items-center gap-2">
            <span className="inline-flex rounded-full bg-surface/90 py-1 ps-3 shadow-[var(--shadow-card)] backdrop-blur empty:hidden"><SaveIndicator /></span>
            {canDraw && view ? <GridControl view={view} units={units} /> : null}
            <IconButton label="Fit to sketch (F)" size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]" onClick={fitView}><Maximize size={16} /></IconButton>
            <span className="hidden md:inline-flex"><ShortcutsHelp open={help} onOpenChange={setHelp} /></span>
            {!readOnly ? <>
              <IconButton label="Undo (⌘Z)" size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]" disabled={!history.past} onClick={history.undo}><Undo2 size={16} /></IconButton>
              <IconButton label="Redo (⇧⌘Z)" size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]" disabled={!history.future} onClick={history.redo}><Redo2 size={16} /></IconButton>
            </> : null}
          </div>
        </div>
        {canDraw ? <ToolHint sketch={sk} empty={!sk.shapes.length} /> : null}
      </div>
      <aside aria-label="Sketch details"
        className="flex max-h-[54dvh] w-full shrink-0 flex-col overflow-y-auto border-t border-line bg-surface md:max-h-none md:w-[340px] md:border-s md:border-t-0">
        <Details sk={sk} status={status} readOnly={readOnly} canDraw={canDraw} units={units}
          editSketch={editSketch} onSetDimension={onSetDimension} onDimension={onDimension} onRelate={relate} onDelete={deleteSelected}
          onConstruction={toggleConstruction} />
      </aside>
    </div>
  );
}

/** What the current tool does next, at the bottom of the canvas. */
function ToolHint({ sketch: sk, empty }: { sketch: Sketch; empty: boolean }) {
  const tool = useSketchUI((s) => s.tool);
  const anchors = useSketchUI((s) => s.anchors.length);
  const picks = useSketchUI((s) => s.picks);
  const typed = useSketchUI((s) => s.typed);
  const text = (() => {
    switch (tool) {
      case "select": return empty
        ? "Start at the origin (the circle where the axes cross): pick Rectangle (R), click the origin, type 1200x600 and press Enter. Rough drawing is fine too: pin the sizes after."
        : "Click to select (Shift for more; double-click for a whole shape), drag to move. A line's middle (▲) is its midpoint: pick two to line them up. X makes helper lines. Click a number to change it.";
      case "line": return anchors ? "Click the next point, or type a length and press Enter. End on a point to close; Esc to stop." : "Click where the line starts: the origin, a point, an axis or anywhere.";
      case "rect": return anchors ? "Click the opposite corner, or type width x height (1200x600) and press Enter." : "Click one corner (the origin is a good start).";
      case "circle": return anchors ? "Click to set the size, or type the diameter and press Enter." : "Click the centre.";
      case "arc": return anchors === 0 ? "Click the centre." : anchors === 1 ? "Click where the arc starts." : "Click where it ends (counter-clockwise).";
      case "dimension": {
        if (!picks.length) return "Click a grey size to pin it, or pick two things (points, lines, an axis) for the distance or angle between them.";
        const one = dimensionFor(sk, acting(picks));
        return one ? "Press Enter (or click empty space) for its own size, or click a second thing." : "Click a second point or line.";
      }
    }
  })();
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex justify-start">
      <div role="status" className="flex max-w-[min(620px,100%)] flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl bg-surface/95 px-4 py-2 text-[13px] text-ink-2 shadow-[var(--shadow-pop)] backdrop-blur">
        <span>{text}</span>
        {typed ? <span className="tnum rounded-md bg-accent px-2 py-0.5 font-semibold text-accent-ink">{typed}</span> : null}
      </div>
    </div>
  );
}

function Details({ sk, status, readOnly, canDraw, units, editSketch, onSetDimension, onDimension, onRelate, onDelete, onConstruction }: {
  sk: Sketch; status: ReturnType<typeof solve>; readOnly: boolean; canDraw: boolean; units: Units;
  editSketch: (fn: (d: Sketch) => void, key?: string) => void;
  onSetDimension: (id: string, v: number) => void;
  onDimension: (kind: Constraint["kind"], refs: string[]) => void;
  onRelate: (o: RelationOption) => void;
  onDelete: () => void;
  onConstruction: () => void;
}) {
  const ui = useSketchUI();
  const names = useMemo(() => itemNames(sk), [sk]);
  const dims = sk.constraints.filter(isDimension);
  const relations = sk.constraints.filter((c) => !isDimension(c));
  const sel = acting(ui.selected);
  const options = canDraw ? relationOptions(sk, sel) : [];
  const dim = canDraw ? dimensionFor(sk, sel) : null;
  const selectedConstraint = ui.selected.length === 1 ? sk.constraints.find((c) => c.id === ui.selected[0]) : undefined;
  const selectedLines = sel.filter((x) => { const s = sk.shapes.find((y) => y.id === x); return s?.kind === "line" && !s.construction; });
  const content = useEditor((s) => s.content);
  const labels = useMemo(() => (content ? partLabels(content, sk.id) : new Map<string, { label: string; letter: string; name: string }>()), [content, sk.id]);
  const [making, setMaking] = useState(false);
  const [repeating, setRepeating] = useState(false);
  const selectedShapes = sel.filter((x) => sk.shapes.some((s) => s.id === x));
  const allHelpers = selectedShapes.length > 0 && selectedShapes.every((x) => sk.shapes.find((s) => s.id === x)?.construction);
  const edit = useEditor((s) => s.edit);
  /** The part keeps its length, and no longer follows the line. */
  const unlink = (line: string) => edit((c) => {
    for (const a of c.assemblies) for (const p of a.parts) if (p.sketch?.sketch_id === sk.id && p.sketch.shape_id === line) p.sketch = null;
  });

  return (
    <div className="flex flex-col">
      <div className="border-b border-line px-4 py-3">
        {readOnly ? <h1 className="text-[17px] font-semibold">{sk.name}</h1> : (
          <input aria-label="Sketch name" defaultValue={sk.name} key={sk.name} maxLength={80}
            onBlur={(e) => { const v = e.target.value.trim() || "Sketch"; if (v !== sk.name) editSketch((d) => { d.name = v; }); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="w-full rounded-lg bg-transparent px-1 py-0.5 text-[17px] font-semibold outline-none hover:bg-surface-2 focus:bg-surface-2" />
        )}
        <AssemblyPicker sk={sk} readOnly={readOnly} editSketch={editSketch} />
        <StatusLine sk={sk} status={status} names={names} />
      </div>

      {canDraw && ui.selected.length ? (
        <section aria-label="Selection" className="flex flex-col gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold text-ink-2">
              {selectedConstraint ? constraintName(selectedConstraint, names)
                : ui.selected.length > 3 ? `${ui.selected.length} selected`
                : ui.selected.map((x) => names.get(x)).filter(Boolean).join(", ")}
            </h2>
            {sel.some((x) => !isBuiltIn(x) && !isMid(x)) ? <IconButton label="Delete (Del)" size="sm" variant="destructive" className="ms-auto" onClick={onDelete}><Trash2 size={15} /></IconButton> : null}
          </div>
          {!selectedConstraint && sel.length === 1 ? <Measures sk={sk} id={sel[0]} units={units} driven={status.driven.has(sel[0])} /> : null}
          {selectedLines.length === 1 && labels.get(selectedLines[0]) ? (() => {
            const part = labels.get(selectedLines[0])!;
            return (
              <p className="flex items-center gap-2 text-[13px] text-ink-2">
                <AsmChip letter={part.letter}>{part.label}</AsmChip>
                <span className="min-w-0 flex-1 truncate">Cut as {part.name || "a part"}: its length follows this line.</span>
                <Button size="sm" variant="ghost" onClick={() => unlink(selectedLines[0])}>Unlink</Button>
              </p>
            );
          })() : null}
          {options.length || dim || selectedShapes.length ? (
            <div className="flex flex-wrap gap-1.5">
              {selectedShapes.length ? <Button size="sm" icon={<Rows3 size={14} />} onClick={() => setRepeating(true)}>Repeat</Button> : null}
              {selectedShapes.length ? (
                <Button size="sm" icon={<SquareDashed size={14} />} aria-pressed={allHelpers} onClick={onConstruction}
                  title={allHelpers ? "Back to drawing (X)" : "A helper: positions the rest, isn't a part, needs no size (X)"}>
                  {allHelpers ? "Make drawing" : "Helper line"}<span className="hidden text-[11px] font-medium text-ink-3 lg:inline">X</span>
                </Button>
              ) : null}
              {selectedLines.length && selectedLines.some((l) => !labels.has(l)) ? (
                <Button size="sm" icon={<Hammer size={14} />} onClick={() => setMaking(true)}>Make {partLines(sk, selectedLines).length > 1 ? "parts" : "a part"}</Button>
              ) : null}
              {dim ? <Button size="sm" variant="primary" icon={<Ruler size={14} />} title="D" onClick={() => onDimension(dim.kind, dim.refs)}>{dim.kind === "angle" ? "Angle" : "Dimension"}<span className="hidden text-[11px] font-medium opacity-60 lg:inline">D</span></Button> : null}
              {options.map((o) => (
                <Button key={o.kind + o.label} size="sm" onClick={() => onRelate(o)} title={RELATION_KEYS[o.kind] ? `Shift ${RELATION_KEYS[o.kind]}` : undefined}>
                  {o.label}{RELATION_KEYS[o.kind] ? <span className="hidden text-[11px] font-medium text-ink-3 lg:inline">⇧{RELATION_KEYS[o.kind]}</span> : null}
                </Button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section aria-label="Dimensions" className="px-4 py-3">
        <h2 className="mb-1 text-[13px] font-semibold text-ink-2">Dimensions</h2>
        {!dims.length ? <p className="text-[13px] text-ink-3">{canDraw ? "Use the Dimension tool (D), or select a line and press Dimension." : "None yet."}</p> : null}
        <ul className="flex flex-col">
          {dims.map((c) => (
            <DimensionRow key={c.id} c={c} sk={sk} name={constraintName(c, names)} units={units} readOnly={readOnly}
              conflict={status.conflicts.includes(c.id)} onSet={onSetDimension}
              onDelete={canDraw ? () => editSketch((d) => deleteItems(d, [c.id])) : undefined} />
          ))}
        </ul>
      </section>

      {relations.length ? (
        <section aria-label="Relations" className="border-t border-line px-4 py-3">
          <h2 className="mb-1 text-[13px] font-semibold text-ink-2">Relations</h2>
          <ul className="flex flex-col">
            {relations.map((c) => (
              <li key={c.id} className={cn("group flex min-h-9 items-center gap-2 rounded-lg px-1 text-[14px]", ui.selected.includes(c.id) && "bg-accent-soft")}
                onPointerEnter={() => ui.set({ hovered: [c.id] })} onPointerLeave={() => ui.set({ hovered: [] })}>
                <button type="button" className={cn("min-w-0 flex-1 truncate text-start", status.conflicts.includes(c.id) && "text-kerf")}
                  onClick={() => ui.select([c.id])} disabled={!canDraw}>{constraintName(c, names)}</button>
                {canDraw ? <IconButton label={`Remove ${constraintName(c, names)}`} size="sm" className="opacity-60 group-hover:opacity-100" onClick={() => editSketch((d) => deleteItems(d, [c.id]))}><Trash2 size={14} /></IconButton> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {making ? <MakeParts sk={sk} lines={partLines(sk, selectedLines)} open={making} onOpenChange={setMaking} /> : null}
      {repeating ? <RepeatDialog sk={sk} ids={selectedShapes} open={repeating} onOpenChange={setRepeating} onApply={(fn) => editSketch(fn)} /> : null}
      <div className="mt-auto border-t border-line px-4 py-3">
        <Switch checked={ui.showAll} onChange={(v) => ui.set({ showAll: v })} label="Show all measurements" description="Every line's length and every circle's size, worked out." />
        {!canDraw && !readOnly ? <p className="mt-3 text-[13px] text-ink-2">Change any number here or on the drawing. To draw, open the sketch on a larger screen.</p> : null}
      </div>
    </div>
  );
}

function StatusLine({ sk, status, names }: { sk: Sketch; status: ReturnType<typeof solve>; names: Map<string, string> }) {
  if (!sk.shapes.length) return <p className="mt-1 text-[13px] text-ink-3">Empty: draw something to start.</p>;
  if (!status.ok) {
    const which = sk.constraints.filter((c) => status.conflicts.includes(c.id)).map((c) => constraintName(c, names));
    return <p className="mt-1 text-[13px] text-kerf">These don&apos;t agree{which.length ? `: ${which.join(", ")}` : ""}. Change or remove one.</p>;
  }
  if (!status.dof) return <p className="mt-1 text-[13px] font-medium text-ok">Fully defined: every size is pinned down.</p>;
  return (
    <p className="mt-1 text-[13px] text-info">
      {status.dof} more {status.dof === 1 ? "dimension or relation" : "dimensions or relations"} to pin it down. Blue parts can still move.
    </p>
  );
}

/** A selected shape's sizes as worked out: length and angle of a line (and whether the rest decides it), size of a circle. */
function Measures({ sk, id, units, driven }: { sk: Sketch; id: string; units: Units; driven: boolean }) {
  const s = sk.shapes.find((x) => x.id === id);
  if (!s) return null;
  if (s.kind === "line") {
    const length = measured(sk, { kind: "distance", refs: [id] });
    const [a, b] = [pointAt(sk, s.a), pointAt(sk, s.b)];
    const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    const pinned = sk.constraints.some((c) => c.kind === "distance" && c.refs.length === 1 && c.refs[0] === id && c.driving);
    return (
      <p className="tnum text-[14px]">
        {fmt("distance", length, units)} {units} · {fmt("angle", ((angle % 180) + 180) % 180, units)} from level
        {s.construction ? <span className="text-ink-3"> · helper</span>
          : !pinned ? <span className={driven ? "text-ink-3" : "text-info"}> · {driven ? "length worked out from the rest" : "length still free"}</span> : null}
      </p>
    );
  }
  const r = measured(sk, { kind: "radius", refs: [id] });
  return <p className="tnum text-[14px]">⌀{fmt("distance", 2 * r, units)} {units} · R{fmt("distance", r, units)}</p>;
}

function DimensionRow({ c, sk, name, units, readOnly, conflict, onSet, onDelete }: {
  c: Constraint; sk: Sketch; name: string; units: Units; readOnly: boolean; conflict: boolean;
  onSet: (id: string, v: number) => void; onDelete?: () => void;
}) {
  const ui = useSketchUI();
  const [editing, setEditing] = useState(false);
  const value = dimensionValue(sk, c);
  return (
    <li className={cn("group relative flex min-h-10 items-center gap-2 rounded-lg px-1 text-[14px]", ui.selected.includes(c.id) && "bg-accent-soft")}
      onPointerEnter={() => ui.set({ hovered: [c.id] })} onPointerLeave={() => ui.set({ hovered: [] })}>
      <span className={cn("min-w-0 flex-1 truncate", conflict && "text-kerf")}>{name}</span>
      {editing ? (
        <DimensionInput kind={c.kind} value={value} units={units} onDone={(v) => { setEditing(false); if (v !== null) onSet(c.id, v); }} />
      ) : (
        <button type="button" disabled={readOnly} onClick={() => setEditing(true)} title={c.driving ? "Change" : "Worked out from the rest"}
          aria-label={`${name}: ${fmt(c.kind, value, units)}${c.kind === "angle" ? "" : ` ${units}`}${c.driving ? "" : ", worked out"}`}
          className={cn("tnum min-w-20 rounded-lg px-2 py-1 text-end font-semibold hover:bg-surface-2 disabled:hover:bg-transparent", !c.driving && "font-medium text-ink-3")}>
          {c.driving ? fmt(c.kind, value, units) : `(${fmt(c.kind, value, units)})`}
          <span className="ms-1 text-[12px] font-normal text-ink-3">{c.kind === "angle" ? "" : units}</span>
        </button>
      )}
      {onDelete ? <IconButton label={`Remove ${name}`} size="sm" className="opacity-60 group-hover:opacity-100" onClick={onDelete}><Trash2 size={14} /></IconButton> : null}
    </li>
  );
}

/** Which assembly the sketch is drawn for: it shows on that assembly's card, and its parts go there. */
function AssemblyPicker({ sk, readOnly, editSketch }: { sk: Sketch; readOnly: boolean; editSketch: (fn: (d: Sketch) => void) => void }) {
  const assemblies = useEditor((s) => s.content?.assemblies ?? []);
  const current = assemblies.find((a) => a.id === sk.assembly_id);
  if (readOnly) return current ? <p className="mt-1 flex items-center gap-1.5 text-[13px] text-ink-2">For <AsmChip letter={current.letter} /> {current.name}</p> : null;
  return (
    <label className="mt-1.5 flex items-center gap-2 text-[13px] text-ink-2">
      For
      <select aria-label="Assembly this sketch is for" value={current?.id ?? ""}
        onChange={(e) => editSketch((d) => { d.assembly_id = e.target.value || null; })}
        className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2 py-1 text-[13px] text-ink outline-none focus:shadow-[0_0_0_2px_var(--accent)]">
        <option value="">No assembly</option>
        {assemblies.map((a) => <option key={a.id} value={a.id}>{a.letter} · {a.name || "Assembly"}</option>)}
      </select>
    </label>
  );
}
