/**
 * Where the pointer "is" while drawing, SketchUp-style: joints and bar midpoints first, then the
 * colored axes through the start point or a point along a bar (whichever is closer on screen),
 * else the grid on the drawing level. Pure: the canvas passes a projector, tests pass a stub.
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
  | { kind: "plane"; at: Vec };

export type SnapInput = {
  cursor: [number, number];
  proj: Projector;
  nodes: Map<string, Vec>;
  members: { id: string; a: Vec; b: Vec }[];
  start?: Vec | null;
  lockAxis?: Axis | null;
  planeZ: number;
  grid: number;
};

const NODE_PX = 12;
const AXIS_PX = 16;
const BAR_PX = 10;
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
    const axes: Axis[] = inp.lockAxis != null ? [inp.lockAxis] : [0, 1, 2];
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

  // The drawing level: a horizontal plane through the start point (or the floor).
  const { origin, dir } = proj.ray;
  if (Math.abs(dir[2]) > 1e-6) {
    const t = (inp.planeZ - origin[2]) / dir[2];
    if (t > 0) {
      const p = add(origin, scale(dir, t));
      return { kind: "plane", at: [round(p[0], grid), round(p[1], grid), inp.planeZ] };
    }
  }
  return { kind: "plane", at: inp.start ?? [0, 0, inp.planeZ] };
}

/** Where a typed length puts the end: along the current direction from the start. */
export function typedEnd(start: Vec, toward: Vec, mm: number): Vec | null {
  const d = sub(toward, start);
  const n = length(d);
  if (n < 1e-6 || !(mm > 0)) return null;
  return add(start, scale(d, mm / n));
}
