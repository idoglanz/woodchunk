"use client";

import { Line, PivotControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Matrix4, Raycaster, Vector2, Vector3 } from "three";
import { cn } from "@/lib/cn";
import { neighbours, nodePositions, type Endpoint } from "@/lib/frame/edit";
import type { MemberResult, Vec } from "@/lib/frame/kernel";
import { snapDrag, snapPoint, typedEnd, type Axis, type DragSnap, type DrawPlane, type Projector, type Snap } from "@/lib/frame/snap";
import type { Frame } from "@/lib/frame/types";
import { FLAT, flatPlane, useFrameUI, type DrawStart } from "@/lib/frame/ui";

/** Frames are Z-up; three.js is Y-up (the scene group is turned -90° about X). */
export const toThree = ([x, y, z]: Vec): [number, number, number] => [x, z, -y];
const fromThree = (v: Vector3): Vec => [v.x, -v.z, v.y];

const AXIS_COLORS = ["#e5484d", "#30a46c", "#3b82f6"];

/**
 * Editor shortcuts act when focus is on the page, the 3D view or an element that opts in
 * (cut-list rows: pick a bar there, press Delete); never in fields, menus or other buttons.
 */
/** Focus is somewhere you type or pick from a list: no single-key shortcuts there. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  return !!target.closest('[role="menu"], [role="listbox"], [role="dialog"], [role="combobox"]');
}

export function onCanvasOrPage(target: EventTarget | null): boolean {
  if (!target || target === document.body || target instanceof HTMLCanvasElement) return true;
  return target instanceof HTMLElement && !!target.closest("[data-frame-shortcuts]");
}
const DRAG_STEP = 5;

/**
 * Arrows on the selected joint, or on both ends of the selected bar: drag along X, Y or Z (or,
 * in flat views, freely in the plane). The joint snaps to other joints (joined on release), to
 * bars (a T-joint) and their midpoints, else moves in 5 mm steps, lined up with joints nearby.
 */
export function NodeHandle({ frame, onMove }: { frame: Frame; onMove: (node: string, at: Vec, join?: string) => void }) {
  const selected = useFrameUI((s) => s.selected);
  const tool = useFrameUI((s) => s.tool);
  if (tool !== "select" || !selected) return null;
  const member = selected.kind === "member" ? frame.members.find((m) => m.id === selected.id) : undefined;
  const ids = selected.kind === "node" ? [selected.id] : member ? [member.a, member.b] : [];
  return <>{ids.map((id) => <Handle key={id} id={id} frame={frame} onMove={onMove} />)}</>;
}

type DragStart = { base: Vec; free: Axis[]; nodes: Map<string, Vec>; members: { id: string; a: Vec; b: Vec }[]; alignWith: Vec[] };

function Handle({ id, frame, onMove }: { id: string; frame: Frame; onMove: (node: string, at: Vec, join?: string) => void }) {
  const drag = useFrameUI((s) => s.drag);
  const set = useFrameUI((s) => s.set);
  const mode = useFrameUI((s) => s.mode);
  // Flat views: only the two in-plane arrows, plus a square to drag freely within the plane.
  const active: [boolean, boolean, boolean] = mode === "3d" ? [true, true, true] : [0, 1, 2].map((i) => i !== FLAT[mode].normal) as [boolean, boolean, boolean];
  const base = useMemo(() => nodePositions(frame).get(id), [frame, id]);
  const getState = useThree((s) => s.get);
  const frameReq = useRef<number | null>(null);
  const start = useRef<DragStart | null>(null);

  // If the handle goes away mid-drag (Esc, a tool switch, undo), drop the preview and give the
  // camera back: drei only re-enables the controls on the arrow's own pointer-up.
  useEffect(() => () => {
    if (frameReq.current) cancelAnimationFrame(frameReq.current);
    if (useFrameUI.getState().drag?.node === id) useFrameUI.getState().set({ drag: null });
    const controls = getState().controls as { enabled?: boolean } | null;
    if (controls && controls.enabled === false) controls.enabled = true;
  }, [id, getState]);

  if (!base) return null;
  const mine = drag?.node === id ? drag : null;
  return (
    <>
      <PivotControls matrix={new Matrix4().makeTranslation(...(mine?.at ?? base))} autoTransform={false} fixed scale={90} lineWidth={3}
        depthTest={false} disableRotations disableScaling disableSliders={mode === "3d"} activeAxes={active}
        axisColors={AXIS_COLORS as [string, string, string]}
        onDragStart={({ component, axis }) => {
          // What it can snap to, fixed for the whole drag (the preview moves joints tied to a size).
          const pos = nodePositions(frame);
          const near = neighbours(frame, id);
          start.current = {
            base,
            free: component === "Slider" ? ([0, 1, 2] as Axis[]).filter((a) => a !== axis) : [axis],
            nodes: new Map([...pos].filter(([n]) => n !== id && !near.has(n))),
            members: frame.members.filter((m) => m.a !== id && m.b !== id)
              .flatMap((m) => { const a = pos.get(m.a), b = pos.get(m.b); return a && b ? [{ id: m.id, a, b }] : []; }),
            alignWith: [...pos].filter(([n]) => n !== id).map(([, p]) => p),
          };
        }}
        onDrag={(l) => {
          const st = start.current;
          if (!st) return;
          const p = new Vector3().setFromMatrixPosition(l);
          const { camera, size } = getState();
          const toScreen = (q: Vec): [number, number] | null => {
            const v = new Vector3(...toThree(q)).project(camera);
            return v.z > 1 ? null : [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height];
          };
          const snap = snapDrag({ ...st, raw: [p.x, p.y, p.z], toScreen, step: DRAG_STEP });
          // At most one preview per frame: each re-solves and re-meshes the frame.
          if (frameReq.current) cancelAnimationFrame(frameReq.current);
          frameReq.current = requestAnimationFrame(() => { frameReq.current = null; set({ drag: { node: id, at: snap.at, snap } }); });
        }}
        onDragEnd={() => {
          if (frameReq.current) { cancelAnimationFrame(frameReq.current); frameReq.current = null; }
          const d = useFrameUI.getState().drag;
          set({ drag: null });
          start.current = null;
          if (d) onMove(d.node, d.at, d.snap?.kind === "node" ? d.snap.node : undefined);
        }} />
      {mine?.snap ? <SnapMark snap={mine.snap} /> : null}
    </>
  );
}

/** What a dragged joint snapped to: a dot on the joint or bar, or guides to the joints it lines up with. */
function SnapMark({ snap }: { snap: DragSnap }) {
  if (snap.kind === "free") {
    return <>{snap.aligned.map((g) => (
      <Line key={g.axis} points={[g.to, snap.at]} color={AXIS_COLORS[g.axis]} lineWidth={1} dashed dashSize={20} gapSize={14} depthTest={false} renderOrder={4} />
    ))}</>;
  }
  return (
    <mesh position={snap.at} renderOrder={6}>
      <sphereGeometry args={[snap.kind === "node" ? 18 : 14, 16, 12]} />
      <meshBasicMaterial color="#ffcc00" depthTest={false} transparent opacity={0.9} />
    </mesh>
  );
}

/**
 * The draw tool: click to start, click to place each joint (the chain continues from it), type a
 * length + Enter to place it exactly, Shift to lock the current axis, Esc to stop.
 */
export function DrawLayer({ frame, members, onAdd }: {
  frame: Frame; members: MemberResult[];
  onAdd: (from: DrawStart, to: Endpoint) => { node: string; at: Vec } | null;
}) {
  const { gl, camera, invalidate } = useThree();
  const tool = useFrameUI((s) => s.tool);
  const start = useFrameUI((s) => s.drawStart);
  const typed = useFrameUI((s) => s.typed);
  const set = useFrameUI((s) => s.set);
  const [hover, setHover] = useState<Snap | null>(null);
  const hoverRef = useRef<Snap | null>(null);
  // Read through refs, so placing a point (which changes the frame) doesn't re-subscribe the
  // listeners and drop the hover point or a click in progress.
  const nodes = useRef(nodePositions(frame));
  const segs = useRef(members.map((m) => ({ id: m.id, a: m.a, b: m.b })));
  const add = useRef(onAdd);
  useEffect(() => {
    nodes.current = nodePositions(frame);
    segs.current = members.map((m) => ({ id: m.id, a: m.a, b: m.b }));
    add.current = onAdd;
  }, [frame, members, onAdd]);

  useEffect(() => {
    if (tool !== "draw") return;
    const el = gl.domElement;
    const raycaster = new Raycaster();
    let down: [number, number] | null = null;

    const locate = (e: PointerEvent): Snap => {
      const r = el.getBoundingClientRect();
      const cursor: [number, number] = [e.clientX - r.left, e.clientY - r.top];
      raycaster.setFromCamera(new Vector2((cursor[0] / r.width) * 2 - 1, -(cursor[1] / r.height) * 2 + 1), camera);
      const proj: Projector = {
        toScreen: (p) => {
          const v = new Vector3(...toThree(p)).project(camera);
          return v.z > 1 ? null : [((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height];
        },
        ray: { origin: fromThree(raycaster.ray.origin), dir: fromThree(raycaster.ray.direction) },
      };
      const s = useFrameUI.getState();
      const start = s.drawStart?.at ?? null;
      // 3D: lines start on the floor (or the start point's level). Flat views: their drawing plane,
      // at the start point's depth once a line is started, following only the two in-plane axes.
      const plane: DrawPlane = s.mode === "3d" ? { axis: 2, at: start?.[2] ?? 0 }
        : start ? { axis: FLAT[s.mode].normal, at: start[FLAT[s.mode].normal] } : flatPlane(s.mode, s.depth[s.mode], nodes.current.values());
      const axes = s.mode === "3d" ? undefined : FLAT[s.mode].inPlane;
      return snapPoint({ cursor, proj, nodes: nodes.current, members: segs.current, start, lockAxis: s.lockAxis, plane, axes, grid: 10 });
    };
    const show = (snap: Snap | null) => {
      hoverRef.current = snap;
      setHover(snap);
      const st = useFrameUI.getState().drawStart;
      set({ drawHover: snap ? { kind: snap.kind, len: st ? Math.round(Math.hypot(...([0, 1, 2].map((i) => snap.at[i] - st.at[i]) as Vec))) : 0 } : null });
      invalidate();
    };
    const place = (snap: Snap) => {
      const s = useFrameUI.getState();
      const point: DrawStart = snap.kind === "node" ? { node: snap.node, at: snap.at } : { at: snap.at };
      if (!s.drawStart) { set({ drawStart: point, typed: "" }); return; }
      const end = add.current(s.drawStart, snap.kind === "node" ? { node: snap.node } : { at: snap.at });
      set({ drawStart: end ? { node: end.node, at: end.at } : s.drawStart, typed: "" });
    };

    const onMove = (e: PointerEvent) => show(locate(e));
    const onDown = (e: PointerEvent) => { if (e.button === 0) down = [e.clientX, e.clientY]; };
    // A click places a point; a drag still orbits the camera.
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
      down = null;
      if (moved < 5) place(locate(e));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const s = useFrameUI.getState();
      if (e.key === "Escape") {
        if (s.drawStart) set({ drawStart: null, typed: "" });
        else useFrameUI.getState().setTool("select");
      } else if (e.key === "Enter" && s.drawStart && s.typed && hoverRef.current) {
        const end = typedEnd(s.drawStart.at, hoverRef.current.at, Number(s.typed.replace(",", ".")));
        if (end) place({ kind: "plane", at: end, aligned: [] });
      } else if (/^[\d.,]$/.test(e.key) && s.drawStart) {
        set({ typed: s.typed + e.key });
      } else if (e.key === "Backspace" && s.typed) {
        set({ typed: s.typed.slice(0, -1) });
      } else if (e.key === "Shift" && hoverRef.current?.kind === "axis") {
        set({ lockAxis: hoverRef.current.axis });
      } else return;
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === "Shift") set({ lockAxis: null }); };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      show(null);
    };
  }, [tool, gl, camera, set, invalidate]);

  if (tool !== "draw" || !hover) return null;
  const end = start && typed ? typedEnd(start.at, hover.at, Number(typed.replace(",", "."))) ?? hover.at : hover.at;
  const color = hover.kind === "axis" || hover.kind === "meet" ? AXIS_COLORS[hover.axis] : hover.kind === "plane" ? "#8e8e93" : "#ffcc00";
  return (
    <group>
      {start ? <Line points={[start.at, end]} color={color} lineWidth={2.5} depthTest={false} renderOrder={5} /> : null}
      {hover.kind === "plane" ? hover.aligned.map((g) => (
        <Line key={g.axis} points={[g.to, end]} color={AXIS_COLORS[g.axis]} lineWidth={1} dashed dashSize={20} gapSize={14} depthTest={false} renderOrder={4} />
      )) : null}
      <mesh position={end} renderOrder={6}>
        <sphereGeometry args={[hover.kind === "plane" ? 8 : 14, 16, 12]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

const DIM_LABELS: Record<string, string> = { W: "Width", D: "Depth", H: "Height" };


/** A label on the model: a frame size (W, D, H) or, in flat views, a bar's length. */
export type DimAnchor = {
  key: string; // "param:W" | "bar:<member id>"
  short: string; // shown before the number ("W"), or "" for bar lengths
  label: string; // for screen readers ("Width", "Bar 3 length")
  mm: number;
  at: Vec;
  span?: [Vec, Vec]; // bar labels hide when the bar is too short on screen
};

/** Where the frame's main sizes are written on the model: beside its bounding box. */
export function dimensionAnchors(frame: Frame): DimAnchor[] {
  const pos = [...nodePositions(frame).values()];
  if (!pos.length) return [];
  const min = [0, 1, 2].map((i) => Math.min(...pos.map((p) => p[i])));
  const max = [0, 1, 2].map((i) => Math.max(...pos.map((p) => p[i])));
  const off = 140;
  const at: Record<string, Vec> = {
    W: [(min[0] + max[0]) / 2, min[1] - off, min[2]],
    D: [max[0] + off, (min[1] + max[1]) / 2, min[2]],
    H: [min[0] - off, min[1], (min[2] + max[2]) / 2],
  };
  return (frame.params ?? []).filter((p) => p.name in DIM_LABELS)
    .map((p) => ({ key: `param:${p.name}`, short: p.name, label: p.label || DIM_LABELS[p.name], mm: p.mm, at: at[p.name] }));
}

/**
 * In a flat view: every bar that isn't pointing at the viewer gets its length (joint to joint).
 * Bars that line up in this view (a front and a back rail) get one label: the one nearest `depth`.
 */
export function barAnchors(frame: Frame, normal: number, depth: number): DimAnchor[] {
  const pos = nodePositions(frame);
  const out: DimAnchor[] = [];
  const seen = new Set<string>();
  const near = frame.members.map((m, i) => ({ m, i, a: pos.get(m.a), b: pos.get(m.b) }))
    .filter((x): x is { m: typeof x.m; i: number; a: Vec; b: Vec } => !!x.a && !!x.b)
    .sort((p, q) => Math.abs((p.a[normal] + p.b[normal]) / 2 - depth) - Math.abs((q.a[normal] + q.b[normal]) / 2 - depth));
  near.forEach(({ m, i, a, b }) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...d);
    if (len < 1 || Math.abs(d[normal]) / len > 0.99) return;
    const flat = [a, b].map((p) => [0, 1, 2].filter((k) => k !== normal).map((k) => Math.round(p[k])).join(",")).sort().join("|");
    if (seen.has(flat)) return;
    seen.add(flat);
    out.push({ key: `bar:${m.id}`, short: "", label: `${m.name || `Bar ${i + 1}`} length`, mm: Math.round(len * 10) / 10,
      at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], span: [a, b] });
  });
  return out;
}

/** Moves DOM labels (outside the canvas) to their 3D anchors on every rendered frame. */
export function LabelProjector({ anchors, labels }: { anchors: DimAnchor[]; labels: RefObject<Map<string, HTMLElement>> }) {
  const v = useMemo(() => new Vector3(), []);
  const w = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const a of anchors) {
      const el = labels.current?.get(a.key);
      if (!el) continue;
      v.set(...toThree(a.at)).project(camera);
      let visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      if (visible && a.span) {
        v.set(...toThree(a.span[0])).project(camera);
        w.set(...toThree(a.span[1])).project(camera);
        visible = Math.hypot((v.x - w.x) * size.width / 2, (v.y - w.y) * size.height / 2) > 70;
        v.set(...toThree(a.at)).project(camera);
      }
      el.style.visibility = visible ? "visible" : "hidden";
      el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
    }
  });
  return null;
}

/** The labels themselves (rendered over the canvas); click one to type a new value. */
export function DimensionLabels({ anchors, labels, onCommit }: {
  anchors: DimAnchor[]; labels: RefObject<Map<string, HTMLElement>>; onCommit: (key: string, mm: number) => void;
}) {
  return (
    <>
      {anchors.map((a) => (
        <div key={a.key} ref={(el) => { if (el) labels.current?.set(a.key, el); else labels.current?.delete(a.key); }}
          className="pointer-events-auto absolute start-0 top-0 z-[5]" style={{ visibility: "hidden" }}>
          <DimLabel a={a} onCommit={(mm) => onCommit(a.key, mm)} />
        </div>
      ))}
    </>
  );
}

function DimLabel({ a, onCommit }: { a: DimAnchor; onCommit: (mm: number) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input autoFocus defaultValue={String(a.mm)} aria-label={a.label} inputMode="decimal"
        className="ring-on-parent tnum w-20 rounded-lg bg-surface px-2 py-1 text-center text-[13px] font-semibold shadow-[0_0_0_2px_var(--accent)] outline-none"
        onBlur={(e) => { const v = Number(e.target.value.replace(",", ".")); if (v > 0 && v !== a.mm) onCommit(v); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
          e.stopPropagation();
        }} />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} aria-label={`${a.label} ${a.mm} mm, click to change`}
      className={cn("tnum whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold text-ink backdrop-blur hover:bg-accent-soft",
        a.short ? "bg-surface/90 shadow-[var(--shadow-card)]" : "bg-surface/75 px-2 py-0.5 text-[11px] text-ink-2 shadow-[0_0_0_1px_var(--line)]")}>
      {a.short ? <span className="text-ink-3">{a.short} </span> : null}{a.mm}
    </button>
  );
}
