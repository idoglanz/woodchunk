/**
 * The sketch solver. Unknowns are point coordinates and circle radii; every driving constraint is
 * one or more residuals that are zero when it holds. A damped Gauss–Newton loop takes the
 * minimum-norm step each time, so whatever the constraints leave free moves as little as possible
 * from where it was drawn (or dragged). Afterwards the Jacobian's null space says what is still
 * free: moving or turning the whole sketch doesn't count, the shape itself is what matters.
 */

import { nullSpace, orthonormal, reject, solveLinear, type Matrix } from "./linalg";
import { baseOf, isMid, ORIGIN, X_AXIS, Y_AXIS, type Constraint, type Shape, type Sketch } from "./types";

const BUILT_IN = new Set([ORIGIN, X_AXIS, Y_AXIS]);

export type V2 = [number, number];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const cross = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];
const dotv = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const len = (a: V2) => Math.hypot(a[0], a[1]);
const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;
const TINY = 1e-12;

/** Reads positions and radii, from the unknowns where they are unknown. */
type Get = { p: (id: string) => V2; r: (shapeId: string) => number };

function shapeOf(sk: Sketch, id: string): Shape | undefined {
  return sk.shapes.find((s) => s.id === id);
}

/** A point's position, or a line's midpoint ("mid:<line>") from its ends. */
function withMids(sk: Sketch, p: (id: string) => V2): (id: string) => V2 {
  const at = (id: string): V2 => {
    if (!isMid(id)) return p(id);
    const s = shapeOf(sk, baseOf(id));
    if (s?.kind !== "line") return [0, 0];
    const [a, b] = [p(s.a), p(s.b)];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  return at;
}

/** Points that only helpers (construction shapes) use: how they move isn't the drawing's freedom. */
function helperPoints(sk: Sketch): Set<string> {
  const real = new Set<string>(), helper = new Set<string>();
  for (const s of sk.shapes) for (const p of s.kind === "line" ? [s.a, s.b] : s.kind === "circle" ? [s.c] : [s.c, s.a, s.b]) (s.construction ? helper : real).add(p);
  return new Set([...helper].filter((p) => !real.has(p)));
}

function lineEnds(sk: Sketch, g: Get, id: string): [V2, V2] {
  if (id === X_AXIS) return [[0, 0], [1000, 0]];
  if (id === Y_AXIS) return [[0, 0], [0, 1000]];
  const s = shapeOf(sk, id);
  if (s?.kind !== "line") throw new Error(`not a line: ${id}`);
  return [g.p(s.a), g.p(s.b)];
}

function centreOf(sk: Sketch, g: Get, id: string): V2 {
  const s = shapeOf(sk, id);
  if (!s || s.kind === "line") throw new Error(`not a circle or arc: ${id}`);
  return g.p(s.c);
}

/**
 * The two directions an angle is measured between: each line from its start to its end, the
 * second one turned round when `side` is −1 (so the angle is the corner as drawn, not its supplement).
 */
function angleDirections(sk: Sketch, g: Get, c: Constraint): [V2, V2] {
  const [a1, b1] = lineEnds(sk, g, c.refs[0]);
  const [a2, b2] = lineEnds(sk, g, c.refs[1]);
  const d2 = sub(b2, a2);
  return [sub(b1, a1), (c.side ?? 1) < 0 ? [-d2[0], -d2[1]] : d2];
}

// --- measurements (also what reference dimensions and labels show) --------------------------------

/** The current value of a dimension (mm or degrees), whether or not it's driving. */
export function measure(sk: Sketch, c: Constraint, g: Get = staticGet(sk)): number {
  switch (c.kind) {
    case "distance": {
      const [a, b] = c.refs.length === 1 ? lineEnds(sk, g, c.refs[0]) : [g.p(c.refs[0]), g.p(c.refs[1])];
      return len(sub(b, a));
    }
    case "point_line_distance": {
      const p = g.p(c.refs[0]);
      const [a, b] = lineEnds(sk, g, c.refs[1]);
      return Math.abs(cross(sub(b, a), sub(p, a))) / Math.max(TINY, len(sub(b, a)));
    }
    case "angle": {
      const [d1, d2] = angleDirections(sk, g, c);
      return deg(Math.atan2(cross(d1, d2), dotv(d1, d2)));
    }
    case "radius": return g.r(c.refs[0]);
    case "diameter": return 2 * g.r(c.refs[0]);
    default: return NaN;
  }
}

/** Positions and radii as stored in the sketch. */
export function staticGet(sk: Sketch): Get {
  const pts = new Map(sk.points.map((p) => [p.id, [p.x, p.y] as V2]));
  return {
    p: withMids(sk, (id) => pts.get(id) ?? [0, 0]), // the origin is at 0, 0
    r: (id) => {
      const s = shapeOf(sk, id);
      if (s?.kind === "circle") return s.r;
      if (s?.kind === "arc") return len(sub(pts.get(s.a) ?? [0, 0], pts.get(s.c) ?? [0, 0]));
      return 0;
    },
  };
}

// --- residuals ---------------------------------------------------------------------------------------

type Residual = { constraint: string; f: (g: Get) => number };

/**
 * The residuals of the driving constraints (and each arc's own: start and end at one radius).
 * Dimensionless ones (parallel, angle…) are scaled by `L`, the sketch's size, to weigh like lengths.
 */
function residuals(sk: Sketch, L: number, skip?: string): Residual[] {
  const out: Residual[] = [];
  const add = (id: string, f: (g: Get) => number) => out.push({ constraint: id, f });
  for (const s of sk.shapes) {
    if (s.kind === "arc") add(`arc:${s.id}`, (g) => len(sub(g.p(s.a), g.p(s.c))) - len(sub(g.p(s.b), g.p(s.c))));
  }
  for (const c of sk.constraints) {
    if (c.id === skip || c.kind === "fix") continue;
    if (c.driving === false && ["distance", "point_line_distance", "angle", "radius", "diameter"].includes(c.kind)) continue;
    const [r0, r1] = c.refs;
    const v = c.value ?? 0;
    switch (c.kind) {
      case "coincident":
        add(c.id, (g) => g.p(r0)[0] - g.p(r1)[0]);
        add(c.id, (g) => g.p(r0)[1] - g.p(r1)[1]);
        break;
      // A line level (plumb), or two points level with (above) each other.
      case "horizontal": add(c.id, (g) => { const [a, b] = r1 ? [g.p(r0), g.p(r1)] : lineEnds(sk, g, r0); return a[1] - b[1]; }); break;
      case "vertical": add(c.id, (g) => { const [a, b] = r1 ? [g.p(r0), g.p(r1)] : lineEnds(sk, g, r0); return a[0] - b[0]; }); break;
      case "collinear":
        // Both ends of the second line on the first, extended.
        for (const end of [0, 1]) {
          add(c.id, (g) => {
            const [a, b] = lineEnds(sk, g, r0);
            const q = lineEnds(sk, g, r1)[end];
            return cross(sub(b, a), sub(q, a)) / Math.max(TINY, len(sub(b, a)));
          });
        }
        break;
      case "symmetric":
        // Two points mirrored about a line: halfway between them is on it, and it's square to them.
        add(c.id, (g) => {
          const [a, b] = lineEnds(sk, g, c.refs[2]);
          const p = g.p(r0), q = g.p(r1);
          return cross(sub(b, a), sub([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], a)) / Math.max(TINY, len(sub(b, a)));
        });
        add(c.id, (g) => {
          const [a, b] = lineEnds(sk, g, c.refs[2]);
          return dotv(sub(b, a), sub(g.p(r1), g.p(r0))) / Math.max(TINY, len(sub(b, a)));
        });
        break;
      case "parallel":
      case "perpendicular":
        add(c.id, (g) => {
          const [a1, b1] = lineEnds(sk, g, r0), [a2, b2] = lineEnds(sk, g, r1);
          const d1 = sub(b1, a1), d2 = sub(b2, a2);
          const k = Math.max(TINY, len(d1) * len(d2));
          return (L * (c.kind === "parallel" ? cross(d1, d2) : dotv(d1, d2))) / k;
        });
        break;
      case "equal":
        add(c.id, (g) => {
          const s0 = shapeOf(sk, r0), s1 = shapeOf(sk, r1);
          if (s0?.kind === "line" && s1?.kind === "line") {
            const [a1, b1] = lineEnds(sk, g, r0), [a2, b2] = lineEnds(sk, g, r1);
            return len(sub(b1, a1)) - len(sub(b2, a2));
          }
          return g.r(r0) - g.r(r1);
        });
        break;
      case "tangent":
        add(c.id, (g) => {
          const s0 = shapeOf(sk, r0);
          const side = c.side ?? 1;
          if (s0?.kind === "line") {
            const [a, b] = lineEnds(sk, g, r0);
            const d = sub(b, a);
            return cross(d, sub(centreOf(sk, g, r1), a)) / Math.max(TINY, len(d)) - side * g.r(r1);
          }
          const apart = len(sub(centreOf(sk, g, r0), centreOf(sk, g, r1)));
          return side > 0 ? apart - (g.r(r0) + g.r(r1)) : apart - Math.abs(g.r(r0) - g.r(r1));
        });
        break;
      case "on_line":
        add(c.id, (g) => {
          const [a, b] = lineEnds(sk, g, r1);
          return cross(sub(b, a), sub(g.p(r0), a)) / Math.max(TINY, len(sub(b, a)));
        });
        break;
      case "on_circle": add(c.id, (g) => len(sub(g.p(r0), centreOf(sk, g, r1))) - g.r(r1)); break;
      case "midpoint":
        add(c.id, (g) => { const [a, b] = lineEnds(sk, g, r1); return g.p(r0)[0] - (a[0] + b[0]) / 2; });
        add(c.id, (g) => { const [a, b] = lineEnds(sk, g, r1); return g.p(r0)[1] - (a[1] + b[1]) / 2; });
        break;
      case "distance":
      case "point_line_distance":
      case "radius":
      case "diameter":
        add(c.id, (g) => measure(sk, c, g) - v);
        break;
      case "angle":
        add(c.id, (g) => {
          const [d1, d2] = angleDirections(sk, g, c);
          const k = Math.max(TINY, len(d1) * len(d2));
          // sin(θ − v): zero at the wanted angle; starting near it, the solver doesn't jump by 180°.
          return (L * (cross(d1, d2) * Math.cos(rad(v)) - dotv(d1, d2) * Math.sin(rad(v)))) / k;
        });
        break;
    }
  }
  return out;
}

// --- unknowns ----------------------------------------------------------------------------------------

type Unknowns = { names: string[]; index: Map<string, number> };

function unknownsOf(sk: Sketch, pinned: Set<string>): Unknowns {
  const names: string[] = [];
  for (const p of sk.points) if (!pinned.has(p.id)) names.push(`${p.id}:x`, `${p.id}:y`);
  for (const s of sk.shapes) if (s.kind === "circle") names.push(`${s.id}:r`);
  return { names, index: new Map(names.map((n, i) => [n, i])) };
}

function getter(sk: Sketch, u: Unknowns, x: number[], pinnedAt: Map<string, V2>): Get {
  const base = staticGet(sk);
  const p = withMids(sk, (id: string): V2 => {
    const pin = pinnedAt.get(id);
    if (pin) return pin;
    const i = u.index.get(`${id}:x`);
    return i === undefined ? base.p(id) : [x[i], x[i + 1]];
  });
  return {
    p,
    r: (id) => {
      const s = shapeOf(sk, id);
      if (s?.kind === "circle") { const i = u.index.get(`${id}:r`); return i === undefined ? s.r : x[i]; }
      if (s?.kind === "arc") return len(sub(p(s.a), p(s.c)));
      return 0;
    },
  };
}

// --- solving -----------------------------------------------------------------------------------------

export type SolveResult = {
  /** The solved sketch (unchanged when it couldn't be solved). */
  sketch: Sketch;
  ok: boolean;
  /** How far the shape can still change (moving or turning the whole sketch doesn't count). */
  dof: number;
  /** Points and shapes the constraints don't pin down yet. */
  free: Set<string>;
  /** Lines whose length the rest decides (whether or not they can still move). */
  driven: Set<string>;
  /** Constraints that disagree (when not ok): without any one of them it solves. */
  conflicts: string[];
};

export type SolveOptions = {
  /**
   * Hold points at spots (dragging them), if the constraints allow; otherwise as close to them as
   * the constraints allow.
   */
  drag?: { point: string; to: V2 }[];
  /** A constraint to leave out (finding conflicts). */
  skip?: string;
  /** Only whether it solves: no freedom analysis, no conflict search. */
  quick?: boolean;
};

const TOL = 1e-9;
const MAX_ITER = 60;

function sizeOf(sk: Sketch): number {
  if (!sk.points.length) return 100;
  const xs = sk.points.map((p) => p.x), ys = sk.points.map((p) => p.y);
  return Math.max(100, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
}

/**
 * Solve the unknowns in place; true when every residual is (near) zero. `w` weighs how readily
 * each unknown changes (the step minimises Σ (Δx/w)²): radii less readily than positions, so a
 * free circle moves to fit rather than swelling.
 */
function iterate(F: (x: number[]) => number[], x: number[], w: number[]): boolean {
  const m = F(x).length;
  if (!m) return true;
  const norm = (v: number[]) => Math.max(0, ...v.map(Math.abs));
  let f = F(x);
  let lambda = 1e-9;
  const w2 = w.map((v) => v * v);
  for (let it = 0; it < MAX_ITER; it++) {
    if (norm(f) < TOL) return true;
    const J = jacobian(F, x, f.length);
    let accepted = false;
    for (let tries = 0; tries < 12 && !accepted; tries++) {
      // Minimum (weighted) norm step: Δ = −W² Jᵀ (J W² Jᵀ + λI)⁻¹ F.
      const A: Matrix = J.map((ri, i) => J.map((rj, j) => ri.reduce((s, v, k) => s + v * rj[k] * w2[k], 0) + (i === j ? lambda : 0)));
      const y = solveLinear(A, f);
      if (!y) { lambda = Math.max(lambda * 10, 1e-9); continue; }
      const step = x.map((_, k) => -w2[k] * J.reduce((s, row, i) => s + row[k] * y[i], 0));
      const trial = x.map((v, k) => v + step[k]);
      const ft = F(trial);
      if (ft.every(Number.isFinite) && norm(ft) < norm(f)) {
        for (let k = 0; k < x.length; k++) x[k] = trial[k];
        f = ft;
        lambda = Math.max(lambda / 10, 1e-12);
        accepted = true;
      } else {
        lambda *= 10;
      }
    }
    if (!accepted) break;
  }
  return norm(f) < 1e-6;
}

function jacobian(F: (x: number[]) => number[], x: number[], m: number): Matrix {
  const J: Matrix = Array.from({ length: m }, () => new Array(x.length).fill(0));
  for (let k = 0; k < x.length; k++) {
    const h = 1e-6 * Math.max(1, Math.abs(x[k]));
    const keep = x[k];
    x[k] = keep + h; const fp = F(x);
    x[k] = keep - h; const fm = F(x);
    x[k] = keep;
    for (let i = 0; i < m; i++) J[i][k] = (fp[i] - fm[i]) / (2 * h);
  }
  return J;
}

/** How far out a sketch may reach (mm), as the server checks: further is a typo. */
export const LIMIT = 100_000;

/** A solution that can be saved: radii above zero, everything within the limit. */
function sane(sk: Sketch, u: Unknowns, x: number[], pinnedAt: Map<string, V2>): boolean {
  const g = getter(sk, u, x, pinnedAt);
  for (const p of sk.points) if (g.p(p.id).some((v) => !Number.isFinite(v) || Math.abs(v) > LIMIT)) return false;
  for (const s of sk.shapes) if (s.kind !== "line" && !(g.r(s.id) > 0.05 && g.r(s.id) <= LIMIT)) return false;
  return true;
}

/** The result when it doesn't solve. */
const unsolved = (sk: Sketch, conflicts: string[] = []): SolveResult => ({ sketch: sk, ok: false, dof: 0, free: new Set(), driven: new Set(), conflicts });

/**
 * Solve a sketch. Geometry that's free stays as close as it can to where it is. Pieces that
 * nothing joins (two separate rectangles) are solved one by one: much quicker on big sketches.
 */
export function solve(sk: Sketch, opts: SolveOptions = {}): SolveResult {
  const parts = pieces(sk, opts.skip);
  if (parts.length <= 1) return solvePiece(sk, opts).result;
  const solved = parts.map((part) => {
    const ids = new Set(part.points.map((p) => p.id));
    return solvePiece(part, { ...opts, drag: opts.drag?.filter((d) => ids.has(d.point)) });
  });
  if (solved.some((r) => !r.result.ok)) return unsolved(sk, solved.flatMap((r) => r.result.conflicts));
  const points = new Map(solved.flatMap((r) => r.result.sketch.points.map((p) => [p.id, p] as const)));
  const shapes = new Map(solved.flatMap((r) => r.result.sketch.shapes.map((x) => [x.id, x] as const)));
  const sketch: Sketch = { ...sk, points: sk.points.map((p) => points.get(p.id) ?? p), shapes: sk.shapes.map((x) => shapes.get(x.id) ?? x) };
  if (opts.quick) return { sketch, ok: true, dof: 0, free: new Set(), driven: new Set(), conflicts: [] };

  // Each piece left its own moving and turning out of its count. Between pieces that's real
  // freedom (where one sits relative to another), except for the moving and turning of the whole
  // sketch, which the first piece stands for. Pieces of helpers only don't count: where a centre
  // line sits on its own doesn't change the drawing.
  const counted = solved.map((r, i) => ({ ...r, i })).filter(({ i }) => parts[i].shapes.some((x) => !x.construction) || !parts[i].shapes.length);
  const gauges = counted.map((r) => r.gauge);
  const whole = gauges.length && gauges.every((g) => g >= 2) ? (gauges.every((g) => g === 3) ? 3 : 2) : 0;
  let dof = -whole;
  const free = new Set<string>(), driven = new Set<string>();
  solved.forEach((r) => { r.result.free.forEach((id) => free.add(id)); r.result.driven.forEach((id) => driven.add(id)); });
  counted.forEach((r, k) => {
    dof += r.result.dof + r.gauge;
    if (r.gauge - (k === 0 ? whole : 0) > 0) {
      for (const p of parts[r.i].points) free.add(p.id);
      for (const x of parts[r.i].shapes) free.add(x.id);
    }
  });
  return { sketch, ok: true, dof, free, driven, conflicts: [] };
}

/** The sketch split into pieces that no shape or driving constraint joins. */
function pieces(sk: Sketch, skip?: string): Sketch[] {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(a, r);
    return r;
  };
  const join = (a: string, b: string) => parent.set(find(a), find(b));
  for (const p of sk.points) parent.set(p.id, p.id);
  for (const x of sk.shapes) {
    parent.set(x.id, x.id);
    for (const p of x.kind === "line" ? [x.a, x.b] : x.kind === "circle" ? [x.c] : [x.c, x.a, x.b]) if (parent.has(p)) join(x.id, p);
  }
  for (const c of sk.constraints) {
    if (c.id === skip || c.driving === false) continue;
    // (A line's midpoint is the line's.)
    const refs = c.refs.map(baseOf).filter((r) => parent.has(r));
    for (const r of refs.slice(1)) join(refs[0], r);
  }
  const groups = new Map<string, Set<string>>();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, new Set());
    groups.get(root)!.add(id);
  }
  if (groups.size <= 1) return [sk];
  return [...groups.values()].map((ids) => ({
    ...sk,
    points: sk.points.filter((p) => ids.has(p.id)),
    shapes: sk.shapes.filter((x) => ids.has(x.id)),
    // Its own constraints, including ones to the origin and axes (they're in every piece's reach).
    constraints: sk.constraints.filter((c) => c.refs.some((r) => ids.has(baseOf(r))) && c.refs.every((r) => ids.has(baseOf(r)) || BUILT_IN.has(r))),
  }));
}

/**
 * Solve one piece; `gauge` is how much moving and turning all of it was left out of its freedom.
 * Dragged points are held where they're dragged to; if the constraints won't let them be there,
 * they start there and are pulled back only as far as they must (`soft`), so a dragged line
 * swings round where it's attached rather than staying put.
 */
function solvePiece(sk: Sketch, opts: SolveOptions, soft = false): { result: SolveResult; gauge: number } {
  const fixed = new Set(sk.constraints.filter((c) => c.kind === "fix" && c.id !== opts.skip).map((c) => c.refs[0]));
  const pinnedAt = new Map<string, V2>();
  for (const p of sk.points) if (fixed.has(p.id)) pinnedAt.set(p.id, [p.x, p.y]);
  const dragged = new Map((opts.drag ?? []).filter((d) => !fixed.has(d.point) && d.point !== ORIGIN).map((d) => [d.point, d.to] as const));
  if (!soft) for (const [id, to] of dragged) pinnedAt.set(id, to);

  const L = sizeOf(sk);
  const res = residuals(sk, L, opts.skip);
  const u = unknownsOf(sk, new Set(pinnedAt.keys()));
  const start = u.names.map((n) => {
    const [id, axis] = n.split(":");
    if (axis === "r") { const s = shapeOf(sk, id); return s?.kind === "circle" ? s.r : 0; }
    const to = soft ? dragged.get(id) : undefined;
    if (to) return axis === "x" ? to[0] : to[1];
    const p = sk.points.find((q) => q.id === id)!;
    return axis === "x" ? p.x : p.y;
  });
  const x = [...start];
  const F = (v: number[]) => { const g = getter(sk, u, v, pinnedAt); return res.map((r) => r.f(g)); };
  // Radii change less readily than positions; dragged points (soft) much less than the rest.
  const weight = u.names.map((n) => (n.endsWith(":r") ? 0.3 : soft && dragged.has(n.split(":")[0]) ? 0.05 : 1));
  const ok = iterate(F, x, weight);

  const solvedOk = ok && sane(sk, u, x, pinnedAt);
  if (!solvedOk && dragged.size) {
    // Can't go there: as near as it can, else not dragged at all.
    return soft ? solvePiece(sk, { skip: opts.skip, quick: opts.quick }) : solvePiece(sk, opts, true);
  }
  if (!solvedOk) return { result: unsolved(sk, opts.quick ? [] : findConflicts(sk)), gauge: 0 };

  const g = getter(sk, u, x, pinnedAt);
  const solved: Sketch = {
    ...sk,
    points: sk.points.map((p) => { const [px, py] = g.p(p.id); return { ...p, x: px, y: py }; }),
    shapes: sk.shapes.map((s) => (s.kind === "circle" ? { ...s, r: g.r(s.id) } : s)),
  };
  if (opts.quick) return { result: { sketch: solved, ok: true, dof: 0, free: new Set(), driven: new Set(), conflicts: [] }, gauge: 0 };
  const { dof, free, driven, gauge } = freedom(solved, u, x, F);
  return { result: { sketch: solved, ok: true, dof, free, driven, conflicts: [] }, gauge };
}

/**
 * What can still move at the solution: the null space of the Jacobian, mapped back to points and
 * shapes. When nothing anchors the sketch, moving or turning all of it doesn't count: one point is
 * held (and, if it can turn, the direction to the farthest point), so what's left is the shape.
 * Helpers (construction shapes) don't count either: only how far the drawing itself can change.
 */
function freedom(sk: Sketch, u: Unknowns, x: number[], F: (v: number[]) => number[]) {
  const n = x.length;
  const free = new Set<string>();
  const lines = sk.shapes.filter((s) => s.kind === "line");
  if (!n) return { dof: 0, free, driven: new Set(lines.map((l) => l.id)), gauge: 0 };
  const f = F(x);
  const J = f.length ? jacobian(F, [...x], f.length) : [];
  const ON = orthonormal(nullSpace(J, n));
  const inNull = (m: number[]) => {
    const k = Math.hypot(...m);
    return k > 0 && Math.hypot(...reject(m, ON)) < 1e-6 * k;
  };
  const helpers = helperPoints(sk);
  const helperShapes = new Set(sk.shapes.filter((s) => s.construction).map((s) => s.id));
  const real = u.names.map((name) => !helpers.has(name.split(":")[0]) && !helperShapes.has(name.split(":")[0]));

  const hold: number[][] = [];
  // Held by a point of the drawing (not a helper's), so its own moving and turning is what's left out.
  const isX = (name: string, i: number) => name.endsWith(":x") && real[i];
  let ax = u.names.findIndex(isX);
  if (ax < 0) ax = u.names.findIndex((name) => name.endsWith(":x"));
  if (ax >= 0) {
    const pos = (i: number): V2 => [x[i], x[i + 1]];
    const A = pos(ax);
    const axis = (k: 0 | 1) => u.names.map((name) => (name.endsWith(k ? ":y" : ":x") ? 1 : 0));
    const turn = u.names.map((name, i) => {
      if (name.endsWith(":x")) return -(x[i + 1] - A[1]);
      if (name.endsWith(":y")) return x[i - 1] - A[0];
      return 0;
    });
    const row = (entries: [number, number][]) => {
      const r = new Array(n).fill(0);
      for (const [i, v] of entries) r[i] = v;
      return r;
    };
    if (inNull(axis(0)) && inNull(axis(1))) {
      hold.push(row([[ax, 1]]), row([[ax + 1, 1]]));
      if (inNull(turn)) {
        let far = -1, best = 0;
        u.names.forEach((name, i) => {
          if (!name.endsWith(":x") || (real[ax] && !real[i])) return;
          const d = len(sub(pos(i), A));
          if (d > best) { best = d; far = i; }
        });
        if (far >= 0) {
          const [dx, dy] = sub(pos(far), A).map((v) => v / best);
          hold.push(row([[far, -dy], [far + 1, dx], [ax, dy], [ax + 1, -dx]]));
        }
      }
    }
  }
  const shape = orthonormal(nullSpace([...J, ...hold], n), 1e-6);
  for (const v of shape) v.forEach((c, i) => { if (Math.abs(c) > 1e-6) free.add(u.names[i].split(":")[0]); });
  // A shape is free when any of its points (or its radius) is.
  for (const s of sk.shapes) {
    const parts = s.kind === "line" ? [s.a, s.b] : s.kind === "circle" ? [s.c, s.id] : [s.c, s.a, s.b];
    if (parts.some((id) => free.has(id))) free.add(s.id);
  }
  // How many ways the drawing can change: the freedom seen on its own points and radii.
  const dof = real.every(Boolean) ? shape.length : orthonormal(shape.map((v) => v.map((c, i) => (real[i] ? c : 0))), 1e-6).length;
  // A line's length is decided when no way it can still change stretches it.
  const driven = new Set<string>();
  for (const l of lines) {
    const [a, b] = [x2(sk, u, x, l.a), x2(sk, u, x, l.b)];
    const d = sub(b.at, a.at), k = Math.max(TINY, len(d));
    const stretch = (v: number[]) => {
      const move = (p: typeof a): V2 => (p.i === undefined ? [0, 0] : [v[p.i], v[p.i + 1]]);
      return Math.abs(dotv(d, sub(move(b), move(a)))) / k;
    };
    if (shape.every((v) => stretch(v) < 1e-6)) driven.add(l.id);
  }
  return { dof, free, driven, gauge: hold.length };
}

/** A point at the solution, and where its x is among the unknowns (none when it's held or the origin). */
function x2(sk: Sketch, u: Unknowns, x: number[], id: string): { at: V2; i?: number } {
  const i = u.index.get(`${id}:x`);
  if (i !== undefined) return { at: [x[i], x[i + 1]], i };
  const p = sk.points.find((q) => q.id === id);
  return { at: p ? [p.x, p.y] : [0, 0] };
}

/** Which driving constraints disagree: the ones without which the sketch solves (newest first). */
function findConflicts(sk: Sketch): string[] {
  const candidates = sk.constraints.filter((c) => c.driving !== false).slice(-40).reverse();
  return candidates.filter((c) => solve(sk, { skip: c.id, quick: true }).ok).map((c) => c.id);
}
