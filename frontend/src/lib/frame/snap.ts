/**
 * Where the pointer "is" while drawing, SketchUp-style: joints and bar midpoints first, then the
 * colored axes through the start point or a point along a bar (whichever is closer on screen),
 * else the grid on the drawing plane, lined up with other joints when close. Pure: the canvas
 * passes a projector, tests pass a stub.
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

export function snapPoint(inp: SnapInput): Snap {
  const { cursor, proj, grid } = inp;

  let best: { d: number; snap: Snap } | null = null;
  for (const [id, p] of inp.nodes) {
    const d = screenDist(proj, p, cursor);
    if (d <= NODE_PX && (!best || d < best.d)) best = { d, snap: { kind: "node", at: p, node: id } };
  }
  if (best) return best.snap;
  for (const m of inp.members) {
    const mid = scale(add(m.a, m.b), 0.5);
    const d = screenDist(proj, mid, cursor);
    if (d <= NODE_PX && (!best || d < best.d)) best = { d, snap: { kind: "mid", at: mid, member: m.id } };
  }
  if (best) return best.snap;

  // Axes through the start point, and points along bars: the closest on screen wins.
  if (inp.start) {
    const axes: Axis[] = inp.lockAxis != null ? [inp.lockAxis] : inp.axes ?? [0, 1, 2];
    for (const axis of axes) {
      const t = closestOnLine(proj.ray, inp.start, UNIT[axis]);
      if (t === null) continue;
      const at = add(inp.start, scale(UNIT[axis], round(t, grid)));
      const d = inp.lockAxis != null ? 0 : screenDist(proj, at, cursor);
      if (d <= AXIS_PX && (!best || d < best.d)) best = { d, snap: { kind: "axis", at, axis } };
    }
  }
  for (const m of inp.members) {
    const span = sub(m.b, m.a);
    const len = length(span);
    if (len < 1) continue;
    const u = scale(span, 1 / len);
    const t = closestOnLine(proj.ray, m.a, u);
    if (t === null || t <= 1 || t >= len - 1) continue;
    const at = add(m.a, scale(u, Math.min(len - 1, Math.max(1, round(t, grid)))));
    const d = screenDist(proj, at, cursor);
    if (d <= BAR_PX && (!best || d < best.d)) best = { d, snap: { kind: "on-bar", at, member: m.id } };
  }
  if (best) return best.snap;

  // The drawing plane: intersect, round to the grid, then line up with joints that are close.
  const { origin, dir } = proj.ray;
  const k = inp.plane.axis;
  if (Math.abs(dir[k]) > 1e-6) {
    const t = (inp.plane.at - origin[k]) / dir[k];
    if (t > 0) {
      const hit = add(origin, scale(dir, t));
      const at = [0, 1, 2].map((i) => (i === k ? inp.plane.at : round(hit[i], grid))) as Vec;
      const aligned: { axis: Axis; to: Vec }[] = [];
      for (const axis of [0, 1, 2] as Axis[]) {
        if (axis === k) continue;
        let near: { d: number; to: Vec } | null = null;
        for (const p of inp.nodes.values()) {
          const q = [...at] as Vec;
          q[axis] = p[axis];
          const d = screenDist(proj, q, cursor);
          if (d <= ALIGN_PX && (!near || d < near.d)) near = { d, to: p };
        }
        if (near) { at[axis] = near.to[axis]; aligned.push({ axis, to: near.to }); }
      }
      return { kind: "plane", at, aligned };
    }
  }
  return { kind: "plane", at: inp.start ?? ([0, 1, 2].map((i) => (i === k ? inp.plane.at : 0)) as Vec), aligned: [] };
}

/** Where a typed length puts the end: along the current direction from the start. */
export function typedEnd(start: Vec, toward: Vec, mm: number): Vec | null {
  const d = sub(toward, start);
  const n = length(d);
  if (n < 1e-6 || !(mm > 0)) return null;
  return add(start, scale(d, mm / n));
}
