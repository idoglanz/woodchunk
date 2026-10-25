"use client";

import { Line, PivotControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Matrix4, Raycaster, Vector2, Vector3 } from "three";
import { nodePositions, snapTo, type Endpoint } from "@/lib/frame/edit";
import type { MemberResult, Vec } from "@/lib/frame/kernel";
import { snapPoint, typedEnd, type Projector, type Snap } from "@/lib/frame/snap";
import type { Frame } from "@/lib/frame/types";
import { useFrameUI, type DrawStart } from "@/lib/frame/ui";

/** Frames are Z-up; three.js is Y-up (the scene group is turned -90° about X). */
export const toThree = ([x, y, z]: Vec): [number, number, number] => [x, z, -y];
const fromThree = (v: Vector3): Vec => [v.x, -v.z, v.y];

const AXIS_COLORS = ["#e5484d", "#30a46c", "#3b82f6"];

/**
 * Editor shortcuts act when focus is on the page, the 3D view or an element that opts in
 * (cut-list rows: pick a bar there, press Delete); never in fields, menus or other buttons.
 */
export function onCanvasOrPage(target: EventTarget | null): boolean {
  if (!target || target === document.body || target instanceof HTMLCanvasElement) return true;
  return target instanceof HTMLElement && !!target.closest("[data-frame-shortcuts]");
}
const DRAG_STEP = 5;

/** Arrows on the selected joint: drag along X, Y or Z (snapped to 5 mm), saved on release. */
export function NodeHandle({ frame, onMove }: { frame: Frame; onMove: (node: string, at: Vec) => void }) {
  const selected = useFrameUI((s) => s.selected);
  const tool = useFrameUI((s) => s.tool);
  const drag = useFrameUI((s) => s.drag);
  const set = useFrameUI((s) => s.set);
  const id = selected?.kind === "node" && tool === "select" ? selected.id : null;
  const base = useMemo(() => (id ? nodePositions(frame).get(id) : undefined), [frame, id]);
  const getState = useThree((s) => s.get);
  const frameReq = useRef<number | null>(null);

  // If the handle goes away mid-drag (Esc, a tool switch, undo), drop the preview and give the
  // camera back: drei only re-enables the controls on the arrow's own pointer-up.
  useEffect(() => () => {
    if (frameReq.current) cancelAnimationFrame(frameReq.current);
    if (useFrameUI.getState().drag) useFrameUI.getState().set({ drag: null });
    const controls = getState().controls as { enabled?: boolean } | null;
    if (controls && controls.enabled === false) controls.enabled = true;
  }, [id, getState]);

  if (!id || !base) return null;
  const at = drag?.node === id ? drag.at : base;
  return (
    <PivotControls matrix={new Matrix4().makeTranslation(...at)} autoTransform={false} fixed scale={90} lineWidth={3}
      depthTest={false} disableRotations disableScaling disableSliders axisColors={AXIS_COLORS as [string, string, string]}
      onDrag={(l) => {
        const p = new Vector3().setFromMatrixPosition(l);
        // Only the dragged axis moves (in 5 mm steps); the others stay exactly where they were.
        const next = [p.x, p.y, p.z].map((v, i) => (Math.abs(v - base[i]) > 0.5 ? base[i] + snapTo(v - base[i], DRAG_STEP) : base[i])) as Vec;
        // At most one preview per frame: each re-solves and re-meshes the frame.
        if (frameReq.current) cancelAnimationFrame(frameReq.current);
        frameReq.current = requestAnimationFrame(() => { frameReq.current = null; set({ drag: { node: id, at: next } }); });
      }}
      onDragEnd={() => {
        if (frameReq.current) { cancelAnimationFrame(frameReq.current); frameReq.current = null; }
        const d = useFrameUI.getState().drag;
        set({ drag: null });
        if (d) onMove(d.node, d.at);
      }} />
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
      return snapPoint({ cursor, proj, nodes: nodes.current, members: segs.current, start: s.drawStart?.at ?? null, lockAxis: s.lockAxis, planeZ: s.drawStart?.at[2] ?? 0, grid: 10 });
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
      if (e.metaKey || e.ctrlKey || e.altKey || !onCanvasOrPage(e.target)) return;
      const s = useFrameUI.getState();
      if (e.key === "Escape") {
        if (s.drawStart) set({ drawStart: null, typed: "" });
        else useFrameUI.getState().setTool("select");
      } else if (e.key === "Enter" && s.drawStart && s.typed && hoverRef.current) {
        const end = typedEnd(s.drawStart.at, hoverRef.current.at, Number(s.typed.replace(",", ".")));
        if (end) place({ kind: "plane", at: end });
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
  const color = hover.kind === "axis" ? AXIS_COLORS[hover.axis] : hover.kind === "plane" ? "#8e8e93" : "#ffcc00";
  return (
    <group>
      {start ? <Line points={[start.at, end]} color={color} lineWidth={2.5} depthTest={false} renderOrder={5} /> : null}
      <mesh position={end} renderOrder={6}>
        <sphereGeometry args={[hover.kind === "plane" ? 8 : 14, 16, 12]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

const DIM_LABELS: Record<string, string> = { W: "Width", D: "Depth", H: "Height" };


export type DimAnchor = { name: string; label: string; mm: number; at: Vec };

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
  return (frame.params ?? []).filter((p) => p.name in DIM_LABELS).map((p) => ({ name: p.name, label: DIM_LABELS[p.name], mm: p.mm, at: at[p.name] }));
}

/** Moves DOM labels (outside the canvas) to their 3D anchors on every rendered frame. */
export function LabelProjector({ anchors, labels }: { anchors: DimAnchor[]; labels: RefObject<Map<string, HTMLElement>> }) {
  const v = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const a of anchors) {
      const el = labels.current?.get(a.name);
      if (!el) continue;
      v.set(...toThree(a.at)).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.visibility = visible ? "visible" : "hidden";
      el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
    }
  });
  return null;
}

/** The size labels themselves (rendered over the canvas); click one to type a new value. */
export function DimensionLabels({ anchors, labels, onParam }: {
  anchors: DimAnchor[]; labels: RefObject<Map<string, HTMLElement>>; onParam: (name: string, mm: number) => void;
}) {
  return (
    <>
      {anchors.map((a) => (
        <div key={a.name} ref={(el) => { if (el) labels.current?.set(a.name, el); else labels.current?.delete(a.name); }}
          className="pointer-events-auto absolute start-0 top-0 z-[5]" style={{ visibility: "hidden" }}>
          <DimLabel name={a.name} label={a.label} mm={a.mm} onCommit={(mm) => onParam(a.name, mm)} />
        </div>
      ))}
    </>
  );
}

function DimLabel({ name, label, mm, onCommit }: { name: string; label: string; mm: number; onCommit: (mm: number) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input autoFocus defaultValue={String(mm)} aria-label={label} inputMode="decimal"
        className="ring-on-parent tnum w-20 rounded-lg bg-surface px-2 py-1 text-center text-[13px] font-semibold shadow-[0_0_0_2px_var(--accent)] outline-none"
        onBlur={(e) => { const v = Number(e.target.value.replace(",", ".")); if (v > 0 && v !== mm) onCommit(v); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
          e.stopPropagation();
        }} />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} aria-label={`${label} ${mm} mm, click to change`}
      className="tnum whitespace-nowrap rounded-full bg-surface/90 px-2.5 py-1 text-[12px] font-semibold text-ink shadow-[var(--shadow-card)] backdrop-blur hover:bg-accent-soft">
      <span className="text-ink-3">{name}</span> {mm}
    </button>
  );
}
