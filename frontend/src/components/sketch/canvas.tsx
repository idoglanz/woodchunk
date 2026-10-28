"use client";

import { Pin } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AsmChip } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { useEditor } from "@/lib/editor";
import { addArc, addCircle, addConstraint, addLine, addPoint, addRectangle, connected, cornerSide, dimensionFor, isDimension, mergePoints, movable, pointAt, round, take } from "@/lib/sketch/model";
import { LIMIT, solve, type SolveResult, type V2 } from "@/lib/sketch/solve";
import { AXES, ORIGIN, X_AXIS, Y_AXIS, type Constraint, type Sketch } from "@/lib/sketch/types";
import { useSketchUI, type Anchor } from "@/lib/sketch/ui";
import { arcSweep, bounds, dimensionMarks, glyphAnchor, gridOf, hitTest, measured, measurementsFor, radiusOf, type Marks, type View } from "@/lib/sketch/view";
import { toast } from "@/lib/toast";
import { isTyping } from "@/lib/typing";
import { lengthInput, parseLength, type Units } from "@/lib/units";

const SNAP_PX = 10;
const HIT_PX = 10;
const CLICK_PX = 4;

export type CanvasProps = {
  /** What to draw: the sketch, or a preview of it while points are dragged. */
  sketch: Sketch;
  status: SolveResult;
  /** Drawing, dragging and adding relations (bigger screens, people who can edit). */
  canDraw: boolean;
  /** Changing dimension values (anyone who can edit, phones too). */
  canType: boolean;
  units: Units;
  view: View;
  setView: (next: View | ((v: View) => View)) => void;
  size: { w: number; h: number };
  onEdit: (fn: (sk: Sketch) => void) => void;
  onSetDimension: (id: string, value: number) => void;
  /** A measured value was clicked: make it a dimension (and type its value). */
  onDimension: (kind: Constraint["kind"], refs: string[]) => void;
  /** Fit the view to the sketch. */
  onFit: () => void;
  /** Lines cut as parts: their part's label ("B3"), by line id. */
  parts: Map<string, { label: string; letter: string; name: string }>;
};

type Gesture =
  | { kind: "pan"; start: V2; view: View }
  | { kind: "pinch"; dist: number; mid: V2; view: View }
  | { kind: "drag"; start: V2; points: { point: string; from: V2 }[]; moved: boolean }
  | { kind: "click"; start: V2 };

export function SketchCanvas(props: CanvasProps) {
  const { sketch: sk, status, canDraw, view, setView, size } = props;
  const ui = useSketchUI();
  const svg = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, V2>());
  const gesture = useRef<Gesture | null>(null);
  const [hover, setHover] = useState<{ at: V2; item: string | null; snap: string | null } | null>(null);
  const hoverAt = useRef<V2 | null>(null);

  const px = 1 / view.scale; // mm per screen pixel
  const toScreen = (p: V2): V2 => [(p[0] - view.cx) * view.scale + size.w / 2, size.h / 2 - (p[1] - view.cy) * view.scale];
  const toWorld = (s: V2): V2 => [(s[0] - size.w / 2) / view.scale + view.cx, (size.h / 2 - s[1]) / view.scale + view.cy];
  const local = (e: { clientX: number; clientY: number }): V2 => {
    const r = svg.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const grid = gridOf(view.scale, ui.grid);
  const onGrid = (v: number) => Math.round(v / grid.snap) * grid.snap;
  /**
   * Where a click or drag lands: a point (or the origin) near it to attach to, else an axis (at
   * a grid step along it), else the nearest grid point, unless snapping is off or Alt is held.
   */
  const snapAt = (at: V2, skip?: Set<string>, free = false): Anchor | null => {
    const id = hitTest({ ...sk, shapes: [] }, at, SNAP_PX * px, skip);
    const snapping = ui.snap && !free;
    const along = (v: number) => (snapping ? onGrid(v) : round(v));
    if (id && AXES.includes(id)) return { axis: id, at: id === X_AXIS ? [along(at[0]), 0] : [0, along(at[1])] };
    if (id) return { point: id, at: pointAt(sk, id) };
    return snapping ? { at: [onGrid(at[0]), onGrid(at[1])] } : null;
  };

  // Zoom with the wheel (pinch on a trackpad sends ctrl+wheel), scroll to pan, around the pointer.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const s: V2 = [e.clientX - r.left, e.clientY - r.top];
      if (e.ctrlKey || e.metaKey || e.deltaMode !== 0) {
        const k = Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.01));
        setView((v) => zoomAt(v, s, k, r.width, r.height));
      } else {
        setView((v) => ({ ...v, cx: v.cx + e.deltaX / v.scale, cy: v.cy - e.deltaY / v.scale }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setView]);

  const middle = useMemo<V2>(() => {
    if (!sk.points.length) return [0, 0];
    return [sk.points.reduce((s, p) => s + p.x, 0) / sk.points.length, sk.points.reduce((s, p) => s + p.y, 0) / sk.points.length];
  }, [sk.points]);

  // Space held: dragging pans, whatever the tool (as in most drawing apps).
  const space = useRef(false);
  const [panning, setPanning] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // (Not on a focused button or link: Space presses those.)
      if (e.code !== "Space" || isTyping(e.target) || (e.target instanceof HTMLElement && e.target.closest("button, a"))) return;
      e.preventDefault(); // not a page scroll, nor a click on a focused button
      if (!space.current) { space.current = true; setPanning(true); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") { space.current = false; setPanning(false); } };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  function onDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button !== 0 && e.pointerType === "mouse" && e.button !== 1) return;
    svg.current!.setPointerCapture(e.pointerId);
    const s = local(e);
    pointers.current.set(e.pointerId, s);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: "pinch", dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], view };
      useSketchUI.getState().set({ drag: null });
      return;
    }
    if (pointers.current.size > 2) return;
    const at = toWorld(s);
    if (e.button === 1 || !canDraw || space.current) { gesture.current = { kind: "pan", start: s, view }; return; }
    if (ui.tool === "select") {
      const hit = hitTest(sk, at, HIT_PX * px);
      // Empty space: a click clears the selection, a drag pans.
      if (!hit) { gesture.current = { kind: "click", start: s }; return; }
      if (!e.shiftKey && !ui.selected.includes(hit)) ui.select([hit]);
      const points = movable(sk, hit);
      // The origin and axes don't move: dragging from them pans, clicking selects.
      gesture.current = points.length ? { kind: "drag", start: at, points: points.map((p) => ({ point: p, from: pointAt(sk, p) })), moved: false } : { kind: "click", start: s };
      return;
    }
    gesture.current = { kind: "click", start: s };
  }

  function onMove(e: ReactPointerEvent<SVGSVGElement>) {
    const s = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, s);
    const g = gesture.current;
    const at = toWorld(s);
    if (g?.kind === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const v = zoomAt(g.view, g.mid, dist / Math.max(1, g.dist), size.w, size.h);
      setView({ ...v, cx: v.cx - (mid[0] - g.mid[0]) / v.scale, cy: v.cy + (mid[1] - g.mid[1]) / v.scale });
      return;
    }
    if (g?.kind === "click" && Math.hypot(s[0] - g.start[0], s[1] - g.start[1]) > CLICK_PX) {
      gesture.current = { kind: "pan", start: g.start, view };
    }
    const cur = gesture.current;
    if (cur?.kind === "pan") {
      setView({ ...cur.view, cx: cur.view.cx - (s[0] - cur.start[0]) / cur.view.scale, cy: cur.view.cy + (s[1] - cur.start[1]) / cur.view.scale });
      return;
    }
    if (cur?.kind === "drag") {
      const d: V2 = [at[0] - cur.start[0], at[1] - cur.start[1]];
      if (!cur.moved && Math.hypot(d[0], d[1]) * view.scale < CLICK_PX) return;
      cur.moved = true;
      const single = cur.points.length === 1 ? cur.points[0] : null;
      // A single point dropped on another one joins it: snap to it while over it (or to the grid).
      const snap = single ? snapAt([single.from[0] + d[0], single.from[1] + d[1]], new Set([single.point]), e.altKey) : null;
      // A whole shape moves in grid steps.
      const step: V2 = ui.snap && !e.altKey ? [onGrid(d[0]), onGrid(d[1])] : d;
      ui.set({ drag: cur.points.map((p) => ({ point: p.point, to: snap ? snap.at : [p.from[0] + step[0], p.from[1] + step[1]] })) });
      setHover({ at, item: null, snap: snap?.point ?? snap?.axis ?? null });
      return;
    }
    hoverAt.current = at;
    if (e.pointerType !== "touch") {
      const drawing = ["line", "rect", "circle", "arc"].includes(ui.tool);
      const snap = drawing ? snapAt(at, undefined, e.altKey) : null;
      setHover({ at: snap?.at ?? at, item: drawing ? null : hitTest(sk, at, HIT_PX * px), snap: snap?.point ?? snap?.axis ?? null });
    }
  }

  function onUp(e: ReactPointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size) { if (g?.kind === "pinch") gesture.current = null; return; }
    gesture.current = null;
    const s = local(e);
    const at = toWorld(s);
    if (g?.kind === "drag") {
      const drag = useSketchUI.getState().drag;
      ui.set({ drag: null });
      if (!g.moved || !drag) { click(at, e.shiftKey, e.altKey); return; }
      const point = g.points[0].point;
      const join = g.points.length === 1 ? snapAt(drag[0].to, new Set([point]), true) : null;
      const moved = solve(sk, { drag, quick: true }).sketch;
      // Dropped on another point (or an axis): attach to it, if the point really got there and the result solves.
      const got = moved.points.find((p) => p.id === point);
      let joined: Sketch | null = null;
      if (join && (join.point || join.axis) && got && Math.hypot(got.x - join.at[0], got.y - join.at[1]) < 1e-3) {
        const trial = structuredClone(moved);
        const attached = join.point ? mergePoints(trial, point, join.point) : (addConstraint(trial, "on_line", [point, join.axis!]), true);
        if (attached && solve(trial, { quick: true }).ok) joined = trial;
        else toast.error(join.point ? "Those two points can't be joined: it doesn't fit with the rest." : "That point can't go on the axis: it doesn't fit with the rest.");
      }
      props.onEdit((d) => {
        if (joined) Object.assign(d, joined);
        else take(d, moved);
      });
      return;
    }
    if (g?.kind !== "click") return;
    click(at, e.shiftKey, e.altKey);
  }

  /** The system took the touch (palm, a gesture): forget it, place nothing. */
  function onCancel(e: ReactPointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    gesture.current = null;
    ui.set({ drag: null });
  }

  function click(at: V2, shift: boolean, alt = false) {
    const { tool, anchors, picks, selected } = useSketchUI.getState();
    if (tool === "select") {
      const hit = hitTest(sk, at, HIT_PX * px);
      if (!hit) ui.select([]);
      else ui.select(shift ? (selected.includes(hit) ? selected.filter((x) => x !== hit) : [...selected, hit]) : [hit]);
      return;
    }
    if (tool === "dimension") {
      const hit = hitTest(sk, at, HIT_PX * px);
      if (!hit) {
        const single = dimensionFor(sk, picks);
        if (single && picks.length === 1) props.onDimension(single.kind, single.refs);
        ui.set({ picks: [] });
        return;
      }
      const next = picks.includes(hit) ? picks : [...picks, hit];
      // One line or circle waits for a second pick (an angle, a distance), or Enter for its own size.
      if (next.length === 2) {
        const dim = dimensionFor(sk, next);
        if (dim) props.onDimension(dim.kind, dim.refs);
        ui.set({ picks: dim ? [] : [hit] });
      } else ui.set({ picks: next });
      return;
    }
    const clamp = (v: number) => Math.max(-LIMIT, Math.min(LIMIT, v));
    const snap = snapAt(at, undefined, alt);
    const here: Anchor = snap ? { ...snap, at: [clamp(snap.at[0]), clamp(snap.at[1])] } : { at: [clamp(round(at[0])), clamp(round(at[1]))] };
    if (!anchors.length) { ui.set({ anchors: [here], typed: "" }); return; }
    const first = anchors[0];
    if (tool === "line") {
      if (first.point && first.point === here.point) { ui.set({ anchors: [] }); return; }
      // Landing where it started (the same grid spot): no zero-length line.
      if (Math.hypot(here.at[0] - first.at[0], here.at[1] - first.at[1]) * view.scale < 2) return;
      let end = "";
      props.onEdit((d) => { const a = place(d, first); end = place(d, here); addLine(d, a, end); });
      // Ending on a point that was already there closes the chain; otherwise it carries on.
      ui.set({ anchors: here.point ? [] : [{ point: end, at: here.at }], typed: "" });
    } else if (tool === "rect") {
      if (Math.abs(here.at[0] - first.at[0]) < px || Math.abs(here.at[1] - first.at[1]) < px) return;
      props.onEdit((d) => { rectangle(d, first, here); });
      ui.set({ anchors: [], typed: "" });
    } else if (tool === "circle") {
      const r = Math.hypot(here.at[0] - first.at[0], here.at[1] - first.at[1]);
      if (r * view.scale < 3) return;
      props.onEdit((d) => { addCircle(d, place(d, first), round(r)); });
      ui.set({ anchors: [], typed: "" });
    } else if (tool === "arc") {
      if (anchors.length === 1) {
        if (Math.hypot(here.at[0] - first.at[0], here.at[1] - first.at[1]) * view.scale < 3) return;
        ui.set({ anchors: [first, here] });
        return;
      }
      const start = anchors[1];
      const r = Math.hypot(start.at[0] - first.at[0], start.at[1] - first.at[1]);
      const t = Math.atan2(at[1] - first.at[1], at[0] - first.at[0]);
      const endAt: V2 = [first.at[0] + r * Math.cos(t), first.at[1] + r * Math.sin(t)];
      props.onEdit((d) => { const c = place(d, first); addArc(d, c, place(d, start), addPoint(d, endAt)); });
      ui.set({ anchors: [], typed: "" });
    }
  }

  /**
   * Typed while drawing: a line's length (along where the pointer points), a rectangle's
   * "width x height" or a circle's diameter. Enter places it, with those sizes pinned.
   */
  function placeTyped(text: string) {
    const { tool, anchors } = useSketchUI.getState();
    const first = anchors[0];
    if (!first) return;
    const sizes = text.split(/\s*[x*×]\s*|\s+/).filter(Boolean).map((t) => parseLength(t, props.units));
    if (!sizes.length || sizes.some((v) => v === null || v <= 0 || v > LIMIT)) { toast.error(`"${text}" isn't a size`); return; }
    const toward = hoverAt.current ?? [first.at[0] + 1, first.at[1]];
    if (tool === "line") {
      const length = sizes[0]!;
      let angle = Math.atan2(toward[1] - first.at[1], toward[0] - first.at[0]);
      // Close to level or plumb: exactly (the line gets that relation too).
      const quarter = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(angle - quarter) < (2 * Math.PI) / 180) angle = quarter;
      const end: V2 = [round(first.at[0] + length * Math.cos(angle)), round(first.at[1] + length * Math.sin(angle))];
      let endId = "";
      props.onEdit((d) => {
        const line = addLine(d, place(d, first), (endId = addPoint(d, end)));
        addConstraint(d, "distance", [line], length);
      });
      ui.set({ anchors: [{ point: endId, at: end }], typed: "" });
    } else if (tool === "rect") {
      const [w, h] = [sizes[0]!, sizes[1] ?? sizes[0]!];
      const sx = toward[0] < first.at[0] ? -1 : 1, sy = toward[1] < first.at[1] ? -1 : 1;
      props.onEdit((d) => {
        const lines = rectangle(d, first, { at: [first.at[0] + sx * w, first.at[1] + sy * h] });
        addConstraint(d, "distance", [lines[0]], w);
        addConstraint(d, "distance", [lines[1]], h);
      });
      ui.set({ anchors: [], typed: "" });
    } else if (tool === "circle") {
      const dia = sizes[0]!;
      props.onEdit((d) => {
        const c = addCircle(d, place(d, first), dia / 2);
        addConstraint(d, "diameter", [c], dia);
      });
      ui.set({ anchors: [], typed: "" });
    }
    // A typed size can reach past the screen: bring the drawing into view if it does.
    const now = useEditor.getState().content?.sketches.find((x) => x.id === sk.id);
    const b = now ? bounds(now) : null;
    if (b && [b.min, b.max].some((p) => { const q = toScreen(p); return q[0] < 0 || q[1] < 0 || q[0] > size.w || q[1] > size.h; })) props.onFit();
  }
  const placeTypedRef = useRef(placeTyped);
  useEffect(() => { placeTypedRef.current = placeTyped; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { tool, anchors, typed } = useSketchUI.getState();
      if (!anchors.length || !["line", "rect", "circle"].includes(tool) || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      // Digits; once started, a unit (cm, m, in, ft, ", ') and, for a rectangle, "x" between the sizes.
      const accepts = /^[0-9.,]$/.test(e.key) || (!!typed && (/^[cmintf"']$/i.test(e.key) || (tool === "rect" && /^[x*× ]$/i.test(e.key))));
      if (accepts) {
        useSketchUI.getState().set({ typed: typed + e.key });
        e.preventDefault();
        e.stopImmediatePropagation();
      } else if (e.key === "Backspace" && typed) {
        useSketchUI.getState().set({ typed: typed.slice(0, -1) });
        e.preventDefault();
        e.stopImmediatePropagation();
      } else if (e.key === "Enter" && typed.trim()) {
        placeTypedRef.current(typed.trim());
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    // Capture: ahead of the editor's own shortcuts (letters pick tools, Backspace deletes).
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // --- what to draw ---------------------------------------------------------------------------------

  const conflict = useMemo(() => {
    const ids = new Set<string>();
    for (const c of sk.constraints) if (status.conflicts.includes(c.id)) c.refs.forEach((r) => ids.add(r));
    return ids;
  }, [sk.constraints, status.conflicts]);
  const lit = new Set([...ui.selected, ...ui.picks, ...ui.hovered, ...(hover?.item ? [hover.item] : [])]);
  for (const c of sk.constraints) if (ui.selected.includes(c.id) || ui.hovered.includes(c.id)) c.refs.forEach((r) => lit.add(r));
  const tone = (id: string) => (conflict.has(id) ? "var(--kerf)" : status.free.has(id) ? "var(--info)" : "var(--ink)");

  const dims = sk.constraints.filter(isDimension);
  const dimensioned = new Set(dims.filter((c) => c.refs.length === 1).map((c) => c.refs[0]));
  // The Dimension tool shows every size there is to pin (click one to pin it).
  const measureAll = ui.showAll || ui.tool === "dimension";
  const shownMeasures = measurementsFor(sk, measureAll ? sk.shapes.map((s) => s.id) : ui.selected).filter((m) => !dimensioned.has(m.refs[0]));
  // What the Dimension tool would add with the next click: between the picks and what's under the pointer.
  const preview = (() => {
    if (ui.tool !== "dimension" || !hover?.item || !ui.picks.length || ui.picks.includes(hover.item)) return null;
    const dim = dimensionFor(sk, [...ui.picks, hover.item]);
    if (!dim) return null;
    const c = { ...dim, side: dim.kind === "angle" ? cornerSide(sk, dim.refs) : null };
    const marks = dimensionMarks(sk, c, px, middle);
    return marks ? { marks, value: measured(sk, c), kind: dim.kind } : null;
  })();
  const origin = toScreen([0, 0]);
  const marksOf = (c: Pick<Constraint, "kind" | "refs">) => dimensionMarks(sk, c, px, middle);

  return (
    <div className="absolute inset-0">
      <svg ref={svg} width={size.w} height={size.h} role="img" aria-label="Sketch"
        className={cn("block touch-none select-none", panning ? "cursor-grab active:cursor-grabbing" : ui.tool !== "select" && canDraw ? "cursor-crosshair" : hover?.item ? "cursor-pointer" : "cursor-grab")}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={(e) => {
          // Double-click a shape: select everything joined to it (all four sides of a rectangle).
          if (ui.tool !== "select" || !canDraw) return;
          const hit = hitTest(sk, toWorld(local(e)), HIT_PX * px);
          const group = hit ? connected(sk, hit) : [];
          if (group.length) ui.select(e.shiftKey ? [...new Set([...ui.selected, ...group])] : group);
        }}>
        <Grid view={view} w={size.w} h={size.h} step={grid.draw} />
        {/* The axes and the origin: fixed, to draw from and attach to. */}
        <g aria-hidden="true">
          {lit.has(X_AXIS) || hover?.snap === X_AXIS ? <path d={`M0,${origin[1]}H${size.w}`} stroke="var(--accent)" strokeWidth={5} opacity={0.6} /> : null}
          {lit.has(Y_AXIS) || hover?.snap === Y_AXIS ? <path d={`M${origin[0]},0V${size.h}`} stroke="var(--accent)" strokeWidth={5} opacity={0.6} /> : null}
          <path d={`M0,${origin[1]}H${size.w}M${origin[0]},0V${size.h}`} stroke="var(--ink-3)" strokeWidth={1} strokeDasharray="8 4 2 4" opacity={0.7} />
        </g>
        {sk.shapes.map((s) => {
          const color = tone(s.id);
          const on = lit.has(s.id);
          let d = "";
          if (s.kind === "line") {
            const [a, b] = [toScreen(pointAt(sk, s.a)), toScreen(pointAt(sk, s.b))];
            d = `M${a[0]},${a[1]}L${b[0]},${b[1]}`;
          } else if (s.kind === "circle") {
            const c = toScreen(pointAt(sk, s.c)), r = s.r * view.scale;
            d = `M${c[0] - r},${c[1]}a${r},${r} 0 1 0 ${2 * r},0a${r},${r} 0 1 0 ${-2 * r},0`;
          } else {
            const { sweep } = arcSweep(sk, s);
            const r = radiusOf(sk, s) * view.scale;
            const [a, b] = [toScreen(pointAt(sk, s.a)), toScreen(pointAt(sk, s.b))];
            d = `M${a[0]},${a[1]}A${r},${r} 0 ${sweep > Math.PI ? 1 : 0} 0 ${b[0]},${b[1]}`;
          }
          return (
            <g key={s.id}>
              {on ? <path d={d} fill="none" stroke="var(--accent)" strokeWidth={7} strokeLinecap="round" opacity={0.7} /> : null}
              <path d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
            </g>
          );
        })}
        {sk.shapes.flatMap((s) => {
          if (s.kind === "line") return [];
          const c = toScreen(pointAt(sk, s.c));
          return [<path key={`${s.id}-c`} d={`M${c[0] - 4},${c[1]}h8M${c[0]},${c[1] - 4}v8`} stroke={tone(s.id)} strokeWidth={1.2} />];
        })}
        {dims.map((c) => <DimensionLines key={c.id} marks={marksOf(c)} toScreen={toScreen} scale={view.scale}
          color={status.conflicts.includes(c.id) ? "var(--kerf)" : c.driving ? "var(--ink-2)" : "var(--ink-3)"} dashed={!c.driving} />)}
        {shownMeasures.map((m) => <DimensionLines key={`m-${m.refs[0]}`} marks={marksOf(m)} toScreen={toScreen} scale={view.scale} color="var(--ink-3)" dashed />)}
        {sk.points.map((p) => {
          const s = toScreen([p.x, p.y]);
          const on = lit.has(p.id) || hover?.snap === p.id;
          return (
            <g key={p.id}>
              {on ? <circle cx={s[0]} cy={s[1]} r={8} fill="var(--accent)" opacity={0.7} /> : null}
              <circle cx={s[0]} cy={s[1]} r={3.2} fill="var(--surface)" stroke={tone(p.id)} strokeWidth={1.6} />
            </g>
          );
        })}
        <g>
          {lit.has(ORIGIN) || hover?.snap === ORIGIN ? <circle cx={origin[0]} cy={origin[1]} r={10} fill="var(--accent)" opacity={0.7} /> : null}
          <circle cx={origin[0]} cy={origin[1]} r={5} fill="var(--surface)" stroke="var(--ink)" strokeWidth={1.5} />
          <circle cx={origin[0]} cy={origin[1]} r={1.6} fill="var(--ink)" />
        </g>
        {preview ? <DimensionLines marks={preview.marks} toScreen={toScreen} scale={view.scale} color="var(--info)" dashed /> : null}
        <Preview hover={hover} toScreen={toScreen} scale={view.scale} />
        {hover && !hover.snap && canDraw && ["line", "rect", "circle", "arc"].includes(ui.tool) ? (() => {
          // Where the next click lands (on the grid when snapping).
          const [x, y] = toScreen(hover.at);
          return <path d={`M${x - 6},${y}h12M${x},${y - 6}v12`} stroke="var(--info)" strokeWidth={1.2} pointerEvents="none" />;
        })() : null}
      </svg>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <Glyphs sketch={sk} toScreen={toScreen} conflicts={status.conflicts} middle={toScreen(middle)} />
        {[...props.parts].map(([line, part]) => {
          // A line cut as a part wears its label, a third of the way along.
          const s = sk.shapes.find((x) => x.id === line);
          if (s?.kind !== "line") return null;
          const [a, b] = [toScreen(pointAt(sk, s.a)), toScreen(pointAt(sk, s.b))];
          return (
            <span key={line} title={`Cut as ${part.label}${part.name ? ` · ${part.name}` : ""}`}
              className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: a[0] + (b[0] - a[0]) / 3, top: a[1] + (b[1] - a[1]) / 3 }}>
              <AsmChip letter={part.letter} className="h-5 min-w-5 px-1 text-[11px]">{part.label}</AsmChip>
            </span>
          );
        })}
        {dims.map((c) => {
          const m = marksOf(c);
          return m ? <DimensionLabel key={c.id} c={c} sketch={sk} at={toScreen(m.label)} units={props.units} canType={props.canType}
            conflict={status.conflicts.includes(c.id)} onSet={props.onSetDimension} /> : null;
        })}
        {preview ? (
          <span className="tnum absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-info px-1.5 py-0.5 text-[12px] font-semibold text-surface"
            style={{ left: toScreen(preview.marks.label)[0], top: toScreen(preview.marks.label)[1] }}>{fmt(preview.kind, preview.value, props.units)}</span>
        ) : null}
        {shownMeasures.map((m) => {
          const marks = marksOf(m);
          if (!marks) return null;
          const at = toScreen(marks.label);
          return (
            <button key={`m-${m.refs[0]}`} type="button" disabled={!props.canType}
              onClick={() => props.onDimension(m.kind, m.refs)} title={props.canType ? "Pin this value" : undefined}
              className="tnum pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-surface/85 px-1.5 py-0.5 text-[12px] italic text-ink-3 backdrop-blur hover:text-ink disabled:pointer-events-none"
              style={{ left: at[0], top: at[1] }}>
              {fmt(m.kind, measured(sk, m), props.units)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The point an anchor stands for: the one it snapped to, or a new one (on its axis, if it landed on one). */
function place(d: Sketch, a: Anchor): string {
  if (a.point && (a.point === ORIGIN || d.points.some((p) => p.id === a.point))) return a.point;
  const p = addPoint(d, a.at);
  if (a.axis) addConstraint(d, "on_line", [p, a.axis]);
  return p;
}

/** A rectangle between two corners; the second joins whatever it snapped to. */
function rectangle(d: Sketch, from: Anchor, to: Anchor): string[] {
  const lines = addRectangle(d, place(d, from), to.at);
  const corner = (d.shapes.find((x) => x.id === lines[1]) as { b: string }).b;
  if (to.point) mergePoints(d, corner, to.point);
  else if (to.axis) addConstraint(d, "on_line", [corner, to.axis]);
  return lines;
}

function zoomAt(v: View, s: V2, k: number, w: number, h: number): View {
  const scale = Math.max(0.005, Math.min(v.scale * k, 60));
  // Keep the sketch point under the pointer where it is.
  const wx = (s[0] - w / 2) / v.scale + v.cx, wy = (h / 2 - s[1]) / v.scale + v.cy;
  return { scale, cx: wx - (s[0] - w / 2) / scale, cy: wy - (h / 2 - s[1]) / scale };
}

export function fmt(kind: Constraint["kind"], v: number, units: Units): string {
  if (kind === "angle") return `${round(Math.abs(v))}°`;
  const prefix = kind === "radius" ? "R" : kind === "diameter" ? "⌀" : "";
  return `${prefix}${lengthInput(v, units) || "0"}`;
}

function Grid({ view, w, h, step }: { view: View; w: number; h: number; step: number }) {
  const lines: { d: string; major: boolean }[] = [];
  const x0 = view.cx - w / 2 / view.scale, x1 = view.cx + w / 2 / view.scale;
  const y0 = view.cy - h / 2 / view.scale, y1 = view.cy + h / 2 / view.scale;
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
    const sx = (x - view.cx) * view.scale + w / 2;
    lines.push({ d: `M${sx},0V${h}`, major: Math.round(x / step) % 5 === 0 });
  }
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
    const sy = h / 2 - (y - view.cy) * view.scale;
    lines.push({ d: `M0,${sy}H${w}`, major: Math.round(y / step) % 5 === 0 });
  }
  return (
    <g aria-hidden="true">
      <rect width={w} height={h} fill="var(--view-3d)" />
      <path d={lines.filter((l) => !l.major).map((l) => l.d).join("")} stroke="var(--grid-3d)" strokeWidth={0.6} />
      <path d={lines.filter((l) => l.major).map((l) => l.d).join("")} stroke="var(--grid-3d)" strokeWidth={1.2} />
    </g>
  );
}

function DimensionLines({ marks, toScreen, scale, color, dashed }: {
  marks: Marks | null; toScreen: (p: V2) => V2; scale: number; color: string; dashed?: boolean;
}) {
  if (!marks) return null;
  let arc = "";
  if (marks.arc) {
    const { c, r, start, sweep } = marks.arc;
    const a = toScreen([c[0] + r * Math.cos(start), c[1] + r * Math.sin(start)]);
    const b = toScreen([c[0] + r * Math.cos(start + sweep), c[1] + r * Math.sin(start + sweep)]);
    arc = `M${a[0]},${a[1]}A${r * scale},${r * scale} 0 ${sweep > Math.PI ? 1 : 0} 0 ${b[0]},${b[1]}`;
  }
  const d = marks.lines.map(([a, b]) => { const [p, q] = [toScreen(a), toScreen(b)]; return `M${p[0]},${p[1]}L${q[0]},${q[1]}`; }).join("") + arc;
  return <path d={d} fill="none" stroke={color} strokeWidth={0.9} strokeDasharray={dashed ? "3 3" : undefined} />;
}

/** What the next click would make: a line, rectangle, circle or arc from the clicks so far. */
function Preview({ hover, toScreen, scale }: {
  hover: { at: V2; snap: string | null } | null; toScreen: (p: V2) => V2; scale: number;
}) {
  const tool = useSketchUI((s) => s.tool);
  const anchors = useSketchUI((s) => s.anchors);
  if (!hover || !anchors.length) return null;
  // Where the pointer landed after snapping (a point, along an axis, or the grid).
  const to = hover.at;
  const [a, b] = [toScreen(anchors[0].at), toScreen(to)];
  const style = { fill: "none", stroke: "var(--info)", strokeWidth: 1.5, strokeDasharray: "5 4" };
  const length = Math.hypot(to[0] - anchors[0].at[0], to[1] - anchors[0].at[1]);
  let shape = null;
  let label = "";
  if (tool === "line") {
    const angle = Math.abs(Math.atan2(to[1] - anchors[0].at[1], to[0] - anchors[0].at[0]) * 180 / Math.PI);
    const level = Math.min(angle, 180 - angle) < 2 ? " · level" : Math.abs(angle - 90) < 2 ? " · plumb" : "";
    shape = <path d={`M${a[0]},${a[1]}L${b[0]},${b[1]}`} {...style} />;
    label = `${round(length)} mm${level}`;
  } else if (tool === "rect") {
    shape = <path d={`M${a[0]},${a[1]}H${b[0]}V${b[1]}H${a[0]}Z`} {...style} />;
    label = `${round(Math.abs(to[0] - anchors[0].at[0]))} × ${round(Math.abs(to[1] - anchors[0].at[1]))} mm`;
  } else if (tool === "circle") {
    const r = length * scale;
    shape = <circle cx={a[0]} cy={a[1]} r={r} {...style} />;
    label = `⌀${round(2 * length)} mm`;
  } else if (tool === "arc") {
    if (anchors.length === 1) {
      shape = <path d={`M${a[0]},${a[1]}L${b[0]},${b[1]}`} {...style} />;
      label = `R${round(length)} mm`;
    } else {
      const c = anchors[0].at, s = anchors[1].at;
      const r = Math.hypot(s[0] - c[0], s[1] - c[1]);
      const t0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
      let sweep = Math.atan2(to[1] - c[1], to[0] - c[0]) - t0;
      while (sweep <= 0) sweep += 2 * Math.PI;
      const [p, q] = [toScreen(s), toScreen([c[0] + r * Math.cos(t0 + sweep), c[1] + r * Math.sin(t0 + sweep)])];
      shape = <path d={`M${p[0]},${p[1]}A${r * scale},${r * scale} 0 ${sweep > Math.PI ? 1 : 0} 0 ${q[0]},${q[1]}`} {...style} />;
      label = `${round((sweep * 180) / Math.PI)}°`;
    }
  }
  return (
    <g pointerEvents="none">
      {shape}
      <text x={b[0] + 12} y={b[1] - 12} fontSize={12} fill="var(--info)" className="tnum">{label}</text>
    </g>
  );
}

const GLYPHS: Partial<Record<Constraint["kind"], string>> = {
  horizontal: "H", vertical: "V", parallel: "∥", perpendicular: "⟂", equal: "=", tangent: "T",
  on_line: "⊂", on_circle: "○", midpoint: "M", coincident: "●",
};

/** Small badges for the relations, beside the shapes they hold; click one to select it. */
function Glyphs({ sketch: sk, toScreen, conflicts, middle }: { sketch: Sketch; toScreen: (p: V2) => V2; conflicts: string[]; middle: V2 }) {
  const selected = useSketchUI((s) => s.selected);
  const tool = useSketchUI((s) => s.tool);
  const stack = new Map<string, number>();
  const shown = new Set<string>();
  const out: { key: string; c: Constraint; at: V2 }[] = [];
  for (const c of sk.constraints) {
    if (isDimension(c)) continue;
    // On every shape the relation ties (a point relation sits at its point).
    const on = c.kind === "on_line" || c.kind === "on_circle" || c.kind === "midpoint" ? [c.refs[0]] : c.refs;
    for (const ref of on) {
      // One badge per kind on a shape (copies made equal to it would stack a column of "=").
      const kind = `${ref}:${c.kind}`;
      if (shown.has(kind)) continue;
      shown.add(kind);
      const g = glyphAnchor(sk, ref);
      if (!g) continue;
      const i = stack.get(ref) ?? 0;
      stack.set(ref, i + 1);
      const s = toScreen(g.at);
      // Beside the shape on the inside (dimensions sit outside), then along it for each further badge.
      const along: V2 = [g.along[0], -g.along[1]];
      let across: V2 = [-along[1], along[0]];
      if ((middle[0] - s[0]) * across[0] + (middle[1] - s[1]) * across[1] < 0) across = [-across[0], -across[1]];
      out.push({ key: `${c.id}-${ref}`, c, at: [s[0] + across[0] * 14 + along[0] * 20 * i, s[1] + across[1] * 14 + along[1] * 20 * i] });
    }
  }
  return (
    <>
      {out.map(({ key, c, at }) => {
        const on = selected.includes(c.id);
        return (
          <button key={key} type="button" aria-label={c.kind.replace("_", " ")} title={c.kind.replace("_", " ")}
            onClick={() => { if (tool === "select") useSketchUI.getState().select([c.id]); }}
            onPointerEnter={() => useSketchUI.getState().set({ hovered: [c.id] })} onPointerLeave={() => useSketchUI.getState().set({ hovered: [] })}
            className={cn("pointer-events-auto absolute flex h-[18px] min-w-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[5px] px-1 text-[11px] font-semibold leading-none shadow-[var(--shadow-card)]",
              on ? "bg-accent text-accent-ink" : conflicts.includes(c.id) ? "bg-kerf-soft text-kerf" : "bg-surface text-ink-2")}
            style={{ left: at[0], top: at[1] }}>
            {c.kind === "fix" ? <Pin size={11} /> : GLYPHS[c.kind] ?? "?"}
          </button>
        );
      })}
    </>
  );
}

/** A dimension's value; click to type a new one. References (worked out) show in brackets. */
function DimensionLabel({ c, sketch, at, units, canType, conflict, onSet }: {
  c: Constraint; sketch: Sketch; at: V2; units: Units; canType: boolean; conflict: boolean; onSet: (id: string, v: number) => void;
}) {
  const editing = useSketchUI((s) => s.editing === c.id);
  const selected = useSketchUI((s) => s.selected.includes(c.id));
  const value = c.driving && c.value !== null ? c.value : measured(sketch, c);
  const text = fmt(c.kind, value, units);
  if (editing) {
    return (
      <DimensionInput kind={c.kind} value={value} units={units} at={at}
        onDone={(v) => { useSketchUI.getState().set({ editing: null }); if (v !== null) onSet(c.id, v); }} />
    );
  }
  return (
    <button type="button" disabled={!canType}
      onClick={() => useSketchUI.getState().set({ editing: c.id })}
      onContextMenu={(e) => { e.preventDefault(); useSketchUI.getState().select([c.id]); }}
      className={cn("tnum pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[13px] font-semibold shadow-[var(--shadow-card)] disabled:pointer-events-none",
        selected ? "bg-accent text-accent-ink" : conflict ? "bg-kerf-soft text-kerf" : c.driving ? "bg-surface text-ink hover:bg-surface-2" : "bg-surface/90 font-medium text-ink-3")}
      style={{ left: at[0], top: at[1] }} title={c.driving ? "Click to change" : "Worked out from the rest"}>
      {c.driving ? text : `(${text})`}
    </button>
  );
}

/** Type a dimension's value: over its label on the drawing (`at`), or in place in a list. */
export function DimensionInput({ kind, value, units, at, onDone }: {
  kind: Constraint["kind"]; value: number; units: Units; at?: V2; onDone: (v: number | null) => void;
}) {
  const angle = kind === "angle";
  const initial = angle ? String(round(value)) : lengthInput(Math.abs(value), units);
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (!commit || !text.trim() || text.trim() === initial) { onDone(null); return; }
    const v = angle ? Number(text.replace(",", ".").replace("°", "")) : parseLength(text, units);
    if (v === null || !Number.isFinite(v)) { onDone(null); return; }
    // Angles between lines are 0–180°; lengths above zero and within what a sketch can hold.
    onDone(angle ? Math.min(180, Math.abs(v)) : Math.max(0.1, Math.min(LIMIT, v)));
  };
  return (
    <input autoFocus inputMode="decimal" aria-label="Value" value={text} onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); e.stopPropagation(); }}
      className={cn("tnum h-8 w-24 rounded-lg bg-surface px-2 text-center text-[16px] font-semibold text-ink shadow-[0_0_0_2px_var(--accent),var(--shadow-pop)] outline-none",
        at && "pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2")}
      style={at ? { left: at[0], top: at[1] } : undefined} />
  );
}
