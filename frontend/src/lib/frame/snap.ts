/**
 * Where the pointer "is" while drawing, SketchUp-style: joints first; then bar midpoints, the
 * point where an axis from the start meets a bar, and the foot of a square line to a bar; then
 * the colored axes through the start point or a point along a bar (whichever is closer on
 * screen), else the grid on the drawing plane, lined up with other joints when close. Dragging a
 * joint snaps the same way along the handle's axis or plane (`snapDrag`). Pure: the canvas passes
 * a projector, tests pass a stub.
 */

import { add, dot, length, scale, sub, type Vec } from "./kernel";

export type Projector = {
  /** Screen pixels of a world point, or null when it's behind the camera. */
  toScreen: (p: Vec) => [number, number] | null;
  /** The pointer's ray in world space. */
  ray: { origin: Vec; dir: Vec };
};

export type Axis = 0 | 1 | 2;
export type Snap =
  | { kind: "node"; at: Vec; node: string }
  | { kind: "mid"; at: Vec; member: string }
  | { kind: "on-bar"; at: Vec; member: string }
  | { kind: "meet"; at: Vec; member: string; axis: Axis } // an axis from the start reaches a bar
  | { kind: "square"; at: Vec; member: string } // the start's square (shortest) line to a bar
  | { kind: "axis"; at: Vec; axis: Axis }
  | { kind: "plane"; at: Vec; aligned: { axis: Axis; to: Vec }[] };

/** The plane points land on when nothing else is near: axis 2 at z = 400 is the horizontal plane at 400 mm. */
export type DrawPlane = { axis: Axis; at: number };

export type SnapInput = {
  cursor: [number, number];
  proj: Projector;
  nodes: Map<string, Vec>;
  members: { id: string; a: Vec; b: Vec }[];
  start?: Vec | null;
  lockAxis?: Axis | null;
  plane: DrawPlane;
  /** Axes a line may follow from the start point (2D views: only the two in the plane). */
  axes?: Axis[];
  grid: number;
};

const NODE_PX = 12;
const AXIS_PX = 16;
const BAR_PX = 10;
const ALIGN_PX = 8;
/** Within this, a point is on a bar's line (the kernel's T-joint tolerance). */
const ON_LINE_MM = 0.5;
const UNIT: [Vec, Vec, Vec] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

const round = (v: number, step: number) => (Math.round(v / step) * step) || 0;

function screenDist(proj: Projector, p: Vec, c: [number, number]): number {
  const s = proj.toScreen(p);
  return s ? Math.hypot(s[0] - c[0], s[1] - c[1]) : Infinity;
}

/** Closest point on the line `p + t·u` to the ray; returns t (null if they're parallel). */
export function closestOnLine(ray: Projector["ray"], p: Vec, u: Vec): number | null {
  const d = ray.dir;
  const w0 = sub(ray.origin, p);
  const a = dot(d, d), b = dot(d, u), c = dot(u, u), dd = dot(d, w0), e = dot(u, w0);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-9) return null;
  return (a * e - b * dd) / denom;
}

/** Closest points of the lines p + t·u and q + s·w: [t, s], or null when they're parallel. */
export function linesClosest(p: Vec, u: Vec, q: Vec, w: Vec): [number, number] | null {
  const r = sub(p, q);
  const a = dot(u, u), b = dot(u, w), c = dot(w, w), d = dot(u, r), e = dot(w, r);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-9 * a * c) return null;
  return [(b * e - c * d) / denom, (a * e - b * d) / denom];
}

type Seg = { id: string; a: Vec; b: Vec };
const spanOf = (m: Seg) => { const d = sub(m.b, m.a); const len = length(d); return { len, u: len > 0 ? scale(d, 1 / len) : d }; };
/** Strictly inside a bar (its ends are joints, found separately). */
const inside = (s: number, len: number) => s > ON_LINE_MM && s < len - ON_LINE_MM;
const isAlong = (d: Vec, axis: Axis) => length(d) > 0 && Math.abs(d[axis]) / length(d) > 0.9999;

/** Keeps the candidate nearest the pointer on screen, within each candidate's own reach. */
class Nearest<T> {
  d = Infinity;
  best: T | null = null;
  offer(d: number, value: T, px: number) {
    if (d <= px && d < this.d) { this.d = d; this.best = value; }
  }
}

export function snapPoint(inp: SnapInput): Snap {
  const { cursor, proj, grid } = inp;
  const dist = (p: Vec) => screenDist(proj, p, cursor);
  const axes: Axis[] = inp.lockAxis != null ? [inp.lockAxis] : inp.axes ?? [0, 1, 2];

  const joint = new Nearest<Snap>();
  for (const [id, p] of inp.nodes) joint.offer(dist(p), { kind: "node", at: p, node: id }, NODE_PX);
  if (joint.best) return joint.best;

  // Exact points on bars: midpoints, where an axis from the start meets a bar, and the foot of
  // the square line from the start (a brace or rail at right angles).
  const exact = new Nearest<Snap>();
  for (const m of inp.members) {
    const mid = scale(add(m.a, m.b), 0.5);
    exact.offer(dist(mid), { kind: "mid", at: mid, member: m.id }, NODE_PX);
    const start = inp.start;
    const { len, u } = spanOf(m);
    if (!start || len < 1) continue;
    for (const axis of axes) {
      const ts = linesClosest(start, UNIT[axis], m.a, u);
      if (!ts || Math.abs(ts[0]) < 1 || !inside(ts[1], len)) continue;
      const at = add(start, scale(UNIT[axis], ts[0]));
      if (length(sub(at, add(m.a, scale(u, ts[1])))) > ON_LINE_MM) continue;
      exact.offer(dist(at), { kind: "meet", at, member: m.id, axis }, AXIS_PX);
    }
    const s = dot(sub(start, m.a), u);
    const foot = add(m.a, scale(u, s));
    if (inside(s, len) && length(sub(foot, start)) >= 1 && (inp.lockAxis == null || isAlong(sub(foot, start), inp.lockAxis))) {
      exact.offer(dist(foot), { kind: "square", at: foot, member: m.id }, NODE_PX);
    }
  }
  if (exact.best) return exact.best;

  // Axes through the start point, and points along bars: the closest on screen wins.
  const line = new Nearest<Snap>();
  if (inp.start) {
    for (const axis of axes) {
      const t = closestOnLine(proj.ray, inp.start, UNIT[axis]);
      if (t === null) continue;
      const at = add(inp.start, scale(UNIT[axis], round(t, grid)));
      line.offer(inp.lockAxis != null ? 0 : dist(at), { kind: "axis", at, axis }, AXIS_PX);
    }
  }
  for (const m of inp.members) {
    const { len, u } = spanOf(m);
    if (len < 1) continue;
    const t = closestOnLine(proj.ray, m.a, u);
    if (t === null || t <= 1 || t >= len - 1) continue;
    const at = add(m.a, scale(u, Math.min(len - 1, Math.max(1, round(t, grid)))));
    line.offer(dist(at), { kind: "on-bar", at, member: m.id }, BAR_PX);
  }
  if (line.best) return line.best;

  // The drawing plane: intersect, round to the grid, then line up with joints that are close.
  const { origin, dir } = proj.ray;
  const k = inp.plane.axis;
  if (Math.abs(dir[k]) > 1e-6) {
    const t = (inp.plane.at - origin[k]) / dir[k];
    if (t > 0) {
      const hit = add(origin, scale(dir, t));
      const at = [0, 1, 2].map((i) => (i === k ? inp.plane.at : round(hit[i], grid))) as Vec;
      const free = ([0, 1, 2] as Axis[]).filter((a) => a !== k);
      return { kind: "plane", ...alignTo(at, free, inp.nodes.values(), dist) };
    }
  }
  return { kind: "plane", at: inp.start ?? ([0, 1, 2].map((i) => (i === k ? inp.plane.at : 0)) as Vec), aligned: [] };
}

/** On each free axis, take a joint's coordinate when lining up with it is close on screen. */
function alignTo(at: Vec, free: Axis[], nodes: Iterable<Vec>, dist: (p: Vec) => number) {
  const out = [...at] as Vec;
  const aligned: { axis: Axis; to: Vec }[] = [];
  const all = [...nodes];
  for (const axis of free) {
    const near = new Nearest<Vec>();
    for (const p of all) {
      const q = [...out] as Vec;
      q[axis] = p[axis];
      near.offer(dist(q), p, ALIGN_PX);
    }
    if (near.best) { out[axis] = near.best[axis]; aligned.push({ axis, to: near.best }); }
  }
  return { at: out, aligned };
}

export type DragSnap =
  | { kind: "node"; at: Vec; node: string }
  | { kind: "mid"; at: Vec; member: string }
  | { kind: "on-bar"; at: Vec; member: string }
  | { kind: "free"; at: Vec; aligned: { axis: Axis; to: Vec }[] };

export type DragInput = {
  /** Where the handle is now: the joint's start position moved along `free` only. */
  raw: Vec;
  /** Where the joint was when the drag started. */
  base: Vec;
  /** The axes the handle moves along (one for an arrow, two for a plane square). */
  free: Axis[];
  toScreen: Projector["toScreen"];
  /** Joints it may land on (not itself, nor the joints at the other ends of its own bars). */
  nodes: Map<string, Vec>;
  /** Bars it may land on (not its own). */
  members: Seg[];
  /** Joints to line up with (default: `nodes`). Its own bars' other ends belong here too. */
  alignWith?: Iterable<Vec>;
  step: number;
};

/**
 * Where a dragged joint goes: onto a joint (joined on release), a bar's midpoint or anywhere on a
 * bar (a T-joint), when that's close on screen and reachable along the handle's axis or plane;
 * else whole steps from where it started, lined up with joints that are close.
 */
export function snapDrag(inp: DragInput): DragSnap {
  const { raw, base, free } = inp;
  const cursor = inp.toScreen(raw);
  const dist = (p: Vec) => {
    const q = inp.toScreen(p);
    return cursor && q ? Math.hypot(q[0] - cursor[0], q[1] - cursor[1]) : Infinity;
  };
  const fixed = ([0, 1, 2] as Axis[]).filter((a) => !free.includes(a));
  const reachable = (q: Vec) => fixed.every((k) => Math.abs(q[k] - base[k]) <= ON_LINE_MM);
  // Keep the fixed coordinates exactly as they were.
  const pin = (q: Vec) => [0, 1, 2].map((i) => (fixed.includes(i as Axis) ? base[i] : q[i])) as Vec;

  const joint = new Nearest<DragSnap>();
  for (const [id, p] of inp.nodes) if (reachable(p)) joint.offer(dist(p), { kind: "node", at: p, node: id }, NODE_PX);
  if (joint.best) return joint.best;

  const mid = new Nearest<DragSnap>();
  for (const m of inp.members) {
    const c = scale(add(m.a, m.b), 0.5);
    if (reachable(c)) mid.offer(dist(c), { kind: "mid", at: pin(c), member: m.id }, NODE_PX);
  }
  if (mid.best) return mid.best;

  const bar = new Nearest<DragSnap>();
  for (const m of inp.members) {
    const { len, u } = spanOf(m);
    if (len < 1) continue;
    let s: number | null = null;
    if (free.length === 1) {
      const ts = linesClosest(base, UNIT[free[0]], m.a, u);
      if (ts && length(sub(add(base, scale(UNIT[free[0]], ts[0])), add(m.a, scale(u, ts[1])))) <= ON_LINE_MM) s = ts[1];
    } else if (fixed.length === 1) {
      const k = fixed[0];
      if (Math.abs(u[k]) > 1e-6) s = (base[k] - m.a[k]) / u[k]; // the bar crosses the plane here
      else if (Math.abs(m.a[k] - base[k]) <= ON_LINE_MM) s = dot(sub(raw, m.a), u); // it lies in the plane
    } else {
      s = dot(sub(raw, m.a), u);
    }
    if (s === null || !inside(s, len)) continue;
    const at = pin(add(m.a, scale(u, s)));
    bar.offer(dist(at), { kind: "on-bar", at, member: m.id }, BAR_PX);
  }
  if (bar.best) return bar.best;

  const stepped = [0, 1, 2].map((i) => (free.includes(i as Axis) ? base[i] + round(raw[i] - base[i], inp.step) : base[i])) as Vec;
  return { kind: "free", ...alignTo(stepped, free, inp.alignWith ?? inp.nodes.values(), dist) };
}

/** Where a typed length puts the end: along the current direction from the start. */
export function typedEnd(start: Vec, toward: Vec, mm: number): Vec | null {
  const d = sub(toward, start);
  const n = length(d);
  if (n < 1e-6 || !(mm > 0)) return null;
  return add(start, scale(d, mm / n));
}
