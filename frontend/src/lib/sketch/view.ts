/**
 * Geometry for showing a sketch: fitting it on screen, what's under the pointer, and where each
 * dimension's lines and label go. Everything is in sketch millimetres (y up); `px` is how many
 * millimetres one screen pixel covers, for offsets that should look the same at any zoom.
 */

import { measure, type V2 } from "./solve";
import { lineOf, pointAt, shapeById } from "./model";
import { ORIGIN, X_AXIS, Y_AXIS, type Constraint, type Shape, type Sketch } from "./types";

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
const len = (a: V2) => Math.hypot(a[0], a[1]);
const unit = (a: V2): V2 => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const perp = (a: V2): V2 => [-a[1], a[0]];

export type View = { cx: number; cy: number; scale: number }; // centre (mm) and pixels per mm

export function bounds(sk: Sketch): { min: V2; max: V2 } | null {
  const xs: number[] = [], ys: number[] = [];
  for (const p of sk.points) { xs.push(p.x); ys.push(p.y); }
  // The origin, when the drawing is attached to it.
  if (sk.shapes.some((s) => (s.kind === "line" ? [s.a, s.b] : [s.c]).includes(ORIGIN))) { xs.push(0); ys.push(0); }
  for (const s of sk.shapes) {
    if (s.kind === "line") continue;
    const c = pointAt(sk, s.c), r = radiusOf(sk, s);
    xs.push(c[0] - r, c[0] + r); ys.push(c[1] - r, c[1] + r);
  }
  if (!xs.length) return null;
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}

/** A view that shows the whole sketch in a w × h box, with a margin; 2 m across when empty. */
export function fit(sk: Sketch, w: number, h: number, margin = 64): View {
  const b = bounds(sk);
  if (!b) return { cx: 0, cy: 0, scale: Math.max(0.05, Math.min(w, h) / 2000) };
  const size = sub(b.max, b.min);
  const scale = Math.min((w - 2 * margin) / Math.max(size[0], 1), (h - 2 * margin) / Math.max(size[1], 1));
  return { cx: (b.min[0] + b.max[0]) / 2, cy: (b.min[1] + b.max[1]) / 2, scale: Math.max(0.005, Math.min(scale, 40)) };
}

export function radiusOf(sk: Sketch, s: Shape): number {
  if (s.kind === "circle") return s.r;
  if (s.kind === "arc") return len(sub(pointAt(sk, s.a), pointAt(sk, s.c)));
  return 0;
}

/** Counter-clockwise angle from an arc's start to its end, 0 to 2π. */
export function arcSweep(sk: Sketch, s: Shape & { kind: "arc" }): { start: number; sweep: number } {
  const c = pointAt(sk, s.c);
  const [a, b] = [sub(pointAt(sk, s.a), c), sub(pointAt(sk, s.b), c)];
  const start = Math.atan2(a[1], a[0]);
  let sweep = Math.atan2(b[1], b[0]) - start;
  while (sweep <= 0) sweep += 2 * Math.PI;
  return { start, sweep };
}

function distToSegment(p: V2, a: V2, b: V2): number {
  const d = sub(b, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / Math.max(1e-12, d[0] ** 2 + d[1] ** 2)));
  return len(sub(p, add(a, mul(d, t))));
}

export function distToShape(sk: Sketch, s: Shape, p: V2): number {
  if (s.kind === "line") return distToSegment(p, pointAt(sk, s.a), pointAt(sk, s.b));
  const c = pointAt(sk, s.c), r = radiusOf(sk, s);
  const ring = Math.abs(len(sub(p, c)) - r);
  if (s.kind === "circle") return ring;
  const { start, sweep } = arcSweep(sk, s);
  let t = Math.atan2(p[1] - c[1], p[0] - c[0]) - start;
  while (t < 0) t += 2 * Math.PI;
  if (t <= sweep) return ring;
  return Math.min(len(sub(p, pointAt(sk, s.a))), len(sub(p, pointAt(sk, s.b))));
}

/**
 * The point (the origin too), else the shape, else an axis, within `tol` mm of `at`: points win
 * because they sit on shapes, and shapes win over the axes they're often drawn along.
 */
export function hitTest(sk: Sketch, at: V2, tol: number, skip: Set<string> = new Set(), builtIn = true): string | null {
  let best: string | null = null, bestD = tol;
  const pts: [string, V2][] = sk.points.map((p) => [p.id, [p.x, p.y]]);
  if (builtIn) pts.push([ORIGIN, [0, 0]]);
  for (const [id, p] of pts) {
    if (skip.has(id)) continue;
    const d = len(sub(p, at));
    if (d <= bestD) { best = id; bestD = d; }
  }
  if (best) return best;
  bestD = tol;
  for (const s of sk.shapes) {
    if (skip.has(s.id)) continue;
    const d = distToShape(sk, s, at);
    if (d <= bestD) { best = s.id; bestD = d; }
  }
  if (best || !builtIn) return best;
  if (Math.abs(at[1]) <= tol * 0.8 && !skip.has(X_AXIS)) return X_AXIS;
  if (Math.abs(at[0]) <= tol * 0.8 && !skip.has(Y_AXIS)) return Y_AXIS;
  return null;
}

/** Where a shape's relation glyphs sit: the middle of a line, the top of a circle or an arc's middle. */
export function glyphAnchor(sk: Sketch, id: string): { at: V2; along: V2 } | null {
  if (id === X_AXIS || id === Y_AXIS) return null; // the axes don't carry badges
  if (id === ORIGIN) return { at: [0, 0], along: [1, 0] };
  const s = shapeById(sk, id);
  if (!s) {
    const p = sk.points.find((q) => q.id === id);
    return p ? { at: [p.x, p.y], along: [1, 0] } : null;
  }
  if (s.kind === "line") {
    const [a, b] = [pointAt(sk, s.a), pointAt(sk, s.b)];
    return { at: mul(add(a, b), 0.5), along: unit(sub(b, a)) };
  }
  const c = pointAt(sk, s.c), r = radiusOf(sk, s);
  if (s.kind === "circle") return { at: add(c, [0, r]), along: [1, 0] };
  const { start, sweep } = arcSweep(sk, s);
  const t = start + sweep / 2;
  return { at: add(c, [r * Math.cos(t), r * Math.sin(t)]), along: [-Math.sin(t), Math.cos(t)] };
}

/** How a dimension is drawn: thin lines, an optional arc (angles), and where its label goes. */
export type Marks = { lines: [V2, V2][]; arc?: { c: V2; r: number; start: number; sweep: number }; label: V2 };

/**
 * A dimension's marks. Lengths sit beside the line, on the side away from the sketch's middle;
 * angles as an arc where the two lines meet (or would); radii as a leader from the centre.
 */
export function dimensionMarks(sk: Sketch, c: Pick<Constraint, "kind" | "refs"> & { side?: number | null }, px: number, middle: V2): Marks | null {
  const gap = 22 * px;
  try {
    switch (c.kind) {
      case "distance": {
        let a: V2, b: V2;
        if (c.refs.length === 1) {
          const s = shapeById(sk, c.refs[0]);
          if (s?.kind !== "line") return null;
          [a, b] = [pointAt(sk, s.a), pointAt(sk, s.b)];
        } else [a, b] = [pointAt(sk, c.refs[0]), pointAt(sk, c.refs[1])];
        return offsetMarks(a, b, gap, middle);
      }
      case "point_line_distance": {
        const p = pointAt(sk, c.refs[0]);
        const l = lineOf(sk, c.refs[1]);
        if (!l) return null;
        const [a, b] = l;
        const d = unit(sub(b, a));
        const t = (p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1];
        const foot = add(a, mul(d, t));
        // Out to the line, extended if the foot falls beyond its ends.
        // (The axes run on forever: nothing to extend.)
        const axis = c.refs[1] === X_AXIS || c.refs[1] === Y_AXIS;
        const ext: [V2, V2][] = axis ? [] : t < 0 ? [[a, foot]] : t > len(sub(b, a)) ? [[b, foot]] : [];
        return { lines: [[p, foot], ...ext], label: mul(add(p, foot), 0.5) };
      }
      case "angle": {
        const [l1, l2] = [lineOf(sk, c.refs[0]), lineOf(sk, c.refs[1])];
        if (!l1 || !l2) return null;
        const [[a1, b1], [a2, b2]] = [l1, l2];
        const d1 = sub(b1, a1), d2 = sub(b2, a2);
        const den = d1[0] * d2[1] - d1[1] * d2[0];
        // Parallel (0° or 180°): no corner to draw, the value sits between the two lines.
        if (Math.abs(den) < 1e-9 * len(d1) * len(d2)) return { lines: [], label: mul(add(add(a1, b1), add(a2, b2)), 0.25) };
        const t = ((a2[0] - a1[0]) * d2[1] - (a2[1] - a1[1]) * d2[0]) / den;
        const meet = add(a1, mul(d1, t));
        // From the meeting point along line 1's longer part, and line 2 the way the dimension
        // measures it (its `side`), so the arc spans the angle shown.
        const u1 = unit(sub(len(sub(a1, meet)) > len(sub(b1, meet)) ? a1 : b1, meet));
        const forward = u1[0] * d1[0] + u1[1] * d1[1] > 0 ? 1 : -1;
        const u2 = unit(mul(d2, forward * ((c.side ?? 1) < 0 ? -1 : 1)));
        const r = Math.min(48 * px, len(d1) * 0.4, len(d2) * 0.4) || 48 * px;
        let start = Math.atan2(u1[1], u1[0]), sweep = Math.atan2(u2[1], u2[0]) - start;
        while (sweep <= -Math.PI) sweep += 2 * Math.PI;
        while (sweep > Math.PI) sweep -= 2 * Math.PI;
        if (sweep < 0) { start += sweep; sweep = -sweep; }
        const mid = start + sweep / 2;
        const ext: [V2, V2][] = [];
        for (const [a, b, ref] of [[a1, b1, c.refs[0]], [a2, b2, c.refs[1]]] as [V2, V2, string][]) {
          if (ref !== X_AXIS && ref !== Y_AXIS && Math.min(len(sub(a, meet)), len(sub(b, meet))) > 1e-6 && distToSegment(meet, a, b) > 1e-6) {
            ext.push([len(sub(a, meet)) < len(sub(b, meet)) ? a : b, meet]);
          }
        }
        return { lines: ext, arc: { c: meet, r, start, sweep }, label: add(meet, mul([Math.cos(mid), Math.sin(mid)], r + 16 * px)) };
      }
      case "radius":
      case "diameter": {
        const s = shapeById(sk, c.refs[0]);
        if (!s || s.kind === "line") return null;
        const ctr = pointAt(sk, s.c), r = radiusOf(sk, s);
        const dir: V2 = s.kind === "arc" ? (() => { const { start, sweep } = arcSweep(sk, s); const t = start + sweep / 2; return [Math.cos(t), Math.sin(t)] as V2; })() : unit([1, 1]);
        const rim = add(ctr, mul(dir, r));
        const from = c.kind === "diameter" ? sub(ctr, mul(dir, r)) : ctr;
        return { lines: [[from, rim]], label: add(rim, mul(dir, 18 * px)) };
      }
      default: return null;
    }
  } catch {
    return null;
  }
}

function offsetMarks(a: V2, b: V2, gap: number, middle: V2): Marks {
  if (len(sub(b, a)) < 1e-9) return { lines: [], label: a };
  let n = perp(unit(sub(b, a)));
  const mid = mul(add(a, b), 0.5);
  // Away from the middle of the sketch, so labels sit outside the shape.
  if ((mid[0] - middle[0]) * n[0] + (mid[1] - middle[1]) * n[1] < 0) n = mul(n, -1);
  const [oa, ob] = [add(a, mul(n, gap)), add(b, mul(n, gap))];
  return { lines: [[a, add(a, mul(n, gap * 1.25))], [b, add(b, mul(n, gap * 1.25))], [oa, ob]], label: mul(add(oa, ob), 0.5) };
}

/** A measurement of something not dimensioned (shown on selection, or for every shape). */
export function measurementsFor(sk: Sketch, ids: string[]): Pick<Constraint, "kind" | "refs">[] {
  const out: Pick<Constraint, "kind" | "refs">[] = [];
  for (const x of ids) {
    const s = shapeById(sk, x);
    if (s?.kind === "line") out.push({ kind: "distance", refs: [x] });
    else if (s?.kind === "circle") out.push({ kind: "diameter", refs: [x] });
    else if (s?.kind === "arc") out.push({ kind: "radius", refs: [x] });
  }
  return out;
}

export function measured(sk: Sketch, m: Pick<Constraint, "kind" | "refs">): number {
  return measure(sk, { id: "", kind: m.kind, refs: m.refs, value: null, driving: false, side: null });
}

/** Grid spacing (mm) at least `minPx` apart on screen, in 1-2-5 steps. */
export function gridStep(scale: number, minPx = 18): number {
  for (const s of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]) if (s * scale >= minPx) return s;
  return 20000;
}
