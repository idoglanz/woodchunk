/**
 * Changing a sketch: adding shapes, relations and dimensions, deleting, and keeping it consistent.
 * Everything here mutates the sketch it's given (the editor hands a copy), then re-solves it.
 */

import { LIMIT, measure, solve, type SolveResult, type V2 } from "./solve";
import { AXES, DIMENSIONS, isBuiltIn, ORIGIN, X_AXIS, Y_AXIS, type Constraint, type ConstraintKind, type Shape, type Sketch } from "./types";

const newId = () => crypto.randomUUID().replace(/-/g, "");
const id = () => newId().slice(0, 10);

export function newSketch(existing: { name: string }[]): Sketch {
  const names = new Set(existing.map((s) => s.name));
  let n = existing.length + 1;
  while (names.has(`Sketch ${n}`)) n++;
  return { id: newId(), name: `Sketch ${n}`, points: [], shapes: [], constraints: [] };
}

/** Uses of a shape's points: line ends, a circle's centre, an arc's centre and ends. */
export function pointsOf(s: Shape): string[] {
  return s.kind === "line" ? [s.a, s.b] : s.kind === "circle" ? [s.c] : [s.c, s.a, s.b];
}

/**
 * Drop what refers to something that's gone: shapes whose points were removed, constraints on
 * removed points or shapes. (Two people's changes, combined, can leave such leftovers.) Returns
 * the same sketch when nothing needed dropping.
 */
export function tidy(sk: Sketch): Sketch {
  const points = new Set([ORIGIN, ...sk.points.map((p) => p.id)]);
  const shapes = sk.shapes.filter((s) => pointsOf(s).every((p) => points.has(p)));
  const known = new Set([...points, ...AXES, ...shapes.map((s) => s.id)]);
  const constraints = sk.constraints.filter((c) => c.refs.every((r) => known.has(r)));
  if (shapes.length === sk.shapes.length && constraints.length === sk.constraints.length) return sk;
  return { ...sk, shapes, constraints };
}

export function addPoint(sk: Sketch, [x, y]: V2): string {
  const p = { id: id(), x, y };
  sk.points.push(p);
  return p.id;
}

/** Where a point is (the origin is at 0, 0). */
export function pointAt(sk: Sketch, pid: string): V2 {
  const p = sk.points.find((q) => q.id === pid);
  return p ? [p.x, p.y] : [0, 0];
}

/** A line's two ends, or two points along an axis; null when `id` isn't a line. */
export function lineOf(sk: Sketch, id: string): [V2, V2] | null {
  if (id === X_AXIS) return [[0, 0], [1000, 0]];
  if (id === Y_AXIS) return [[0, 0], [0, 1000]];
  const s = shapeById(sk, id);
  return s?.kind === "line" ? [pointAt(sk, s.a), pointAt(sk, s.b)] : null;
}

export function shapeById(sk: Sketch, sid: string): Shape | undefined {
  return sk.shapes.find((s) => s.id === sid);
}

export function addConstraint(sk: Sketch, kind: ConstraintKind, refs: string[], value: number | null = null, side: number | null = null): Constraint {
  const c: Constraint = { id: id(), kind, refs, value, driving: true, side };
  sk.constraints.push(c);
  return c;
}

/** A line drawn close to level or plumb (within 2°) is made exactly so, as you'd mean it. */
const SNAP_ANGLE = (2 * Math.PI) / 180;

export function addLine(sk: Sketch, a: string, b: string, auto = true): string {
  const line: Shape = { id: id(), kind: "line", a, b };
  sk.shapes.push(line);
  if (auto) {
    const [pa, pb] = [pointAt(sk, a), pointAt(sk, b)];
    const angle = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]);
    const off = (t: number) => Math.abs(Math.atan2(Math.sin(angle - t), Math.cos(angle - t)));
    if (Math.min(off(0), off(Math.PI)) < SNAP_ANGLE) addConstraint(sk, "horizontal", [line.id]);
    else if (Math.min(off(Math.PI / 2), off(-Math.PI / 2)) < SNAP_ANGLE) addConstraint(sk, "vertical", [line.id]);
  }
  return line.id;
}

/** Four lines, level and plumb, from two opposite corners (points that exist, or new ones). */
export function addRectangle(sk: Sketch, from: string, to: V2): string[] {
  const [x0, y0] = pointAt(sk, from);
  const b = addPoint(sk, [to[0], y0]);
  const c = addPoint(sk, to);
  const d = addPoint(sk, [x0, to[1]]);
  const lines = [addLine(sk, from, b, false), addLine(sk, b, c, false), addLine(sk, c, d, false), addLine(sk, d, from, false)];
  addConstraint(sk, "horizontal", [lines[0]]);
  addConstraint(sk, "vertical", [lines[1]]);
  addConstraint(sk, "horizontal", [lines[2]]);
  addConstraint(sk, "vertical", [lines[3]]);
  return lines;
}

export function addCircle(sk: Sketch, c: string, r: number): string {
  const s: Shape = { id: id(), kind: "circle", c, r: Math.max(1, r) };
  sk.shapes.push(s);
  return s.id;
}

/** An arc around `c`, counter-clockwise from `a`; `b` lands on its radius. */
export function addArc(sk: Sketch, c: string, a: string, b: string): string {
  const s: Shape = { id: id(), kind: "arc", c, a, b };
  sk.shapes.push(s);
  return s.id;
}

/**
 * Delete points and shapes (and constraints, by id). A deleted shape takes its points with it
 * unless something else still uses them; whatever then refers to a deleted thing goes too.
 */
export function deleteItems(sk: Sketch, ids: Iterable<string>) {
  const gone = new Set([...ids].filter((x) => !isBuiltIn(x))); // the origin and axes stay
  sk.constraints = sk.constraints.filter((c) => !gone.has(c.id));
  const dropped = sk.shapes.filter((s) => gone.has(s.id) || pointsOf(s).some((p) => gone.has(p)));
  sk.shapes = sk.shapes.filter((s) => !dropped.includes(s));
  const used = new Set(sk.shapes.flatMap(pointsOf));
  const orphan = new Set(dropped.flatMap(pointsOf).filter((p) => !used.has(p)));
  sk.points = sk.points.filter((p) => !gone.has(p.id) && !orphan.has(p.id));
  Object.assign(sk, tidy(sk));
}

const isFixed = (sk: Sketch, pid: string) => pid === ORIGIN || sk.constraints.some((c) => c.kind === "fix" && c.refs[0] === pid);

/**
 * Join two points into one: everything using either uses the one left, which stays where it is.
 * That's `into`, unless only `from` is fixed (a fixed point doesn't move). Two fixed points in
 * different places can't be joined: false, and nothing changes.
 */
export function mergePoints(sk: Sketch, from: string, into: string): boolean {
  if (from === into) return true;
  if (isFixed(sk, from)) {
    if (isFixed(sk, into)) {
      const [p, q] = [pointAt(sk, from), pointAt(sk, into)];
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) return false;
    } else [from, into] = [into, from];
  }
  for (const s of sk.shapes) {
    if (s.kind === "line") { if (s.a === from) s.a = into; if (s.b === from) s.b = into; }
    else if (s.kind === "circle") { if (s.c === from) s.c = into; }
    else { if (s.c === from) s.c = into; if (s.a === from) s.a = into; if (s.b === from) s.b = into; }
  }
  for (const c of sk.constraints) c.refs = c.refs.map((r) => (r === from ? into : r));
  sk.points = sk.points.filter((p) => p.id !== from);
  // A line from a point to itself, or a relation of a point with itself, means nothing now; nor
  // does the same relation twice (both points were fixed).
  sk.shapes = sk.shapes.filter((s) => s.kind !== "line" || s.a !== s.b);
  const seen = new Set<string>();
  sk.constraints = sk.constraints.filter((c) => {
    const key = `${c.kind}:${c.refs.join(",")}`;
    if (new Set(c.refs).size !== c.refs.length || (c.kind === "fix" && seen.has(key))) return false;
    seen.add(key);
    return true;
  });
  Object.assign(sk, tidy(sk));
  return true;
}

/** The points that move when something is dragged or nudged: a point, or all of a shape's. Not the origin. */
export function movable(sk: Sketch, id: string): string[] {
  if (sk.points.some((p) => p.id === id)) return [id];
  const s = shapeById(sk, id);
  return s ? pointsOf(s).filter((p) => p !== ORIGIN) : [];
}

/** Every shape joined to this one through shared points (a whole rectangle from one side). */
export function connected(sk: Sketch, id: string): string[] {
  const start = shapeById(sk, id);
  if (!start) return [];
  const seen = new Set([start.id]);
  const points = new Set(pointsOf(start).filter((p) => p !== ORIGIN));
  for (let grew = true; grew;) {
    grew = false;
    for (const s of sk.shapes) {
      if (seen.has(s.id) || !pointsOf(s).some((p) => points.has(p))) continue;
      seen.add(s.id);
      pointsOf(s).filter((p) => p !== ORIGIN).forEach((p) => points.add(p));
      grew = true;
    }
  }
  return sk.shapes.filter((s) => seen.has(s.id)).map((s) => s.id);
}

/** Copy solved positions and radii into the sketch. */
export function take(sk: Sketch, solved: Sketch) {
  sk.points = solved.points;
  sk.shapes = solved.shapes;
}

// --- relations and dimensions for a selection -------------------------------------------------------

export type Picked = { points: string[]; lines: string[]; round: string[] };

export function picked(sk: Sketch, ids: string[]): Picked {
  const out: Picked = { points: [], lines: [], round: [] };
  for (const x of ids) {
    if (x === ORIGIN || sk.points.some((p) => p.id === x)) out.points.push(x);
    else if (AXES.includes(x)) out.lines.push(x);
    else {
      const s = shapeById(sk, x);
      if (s?.kind === "line") out.lines.push(x);
      else if (s) out.round.push(x);
    }
  }
  return out;
}

export type RelationOption = { kind: ConstraintKind; label: string; refs: string[]; side?: number };

/** The relations that make sense for what's selected (each needs exactly that selection). */
export function relationOptions(sk: Sketch, ids: string[]): RelationOption[] {
  const { points: P, lines: L, round: R } = picked(sk, ids);
  const n = P.length + L.length + R.length;
  const out: RelationOption[] = [];
  // An axis can be the other line of a relation (parallel to it, a point on it), not the one changed.
  const axis = L.some((x) => AXES.includes(x));
  if (n === L.length && L.length >= 1 && !(L.length === 1 && axis) && !L.every((x) => AXES.includes(x))) {
    if (L.length === 1) out.push({ kind: "horizontal", label: "Horizontal", refs: L }, { kind: "vertical", label: "Vertical", refs: L });
    if (L.length === 2) {
      out.push({ kind: "parallel", label: "Parallel", refs: L }, { kind: "perpendicular", label: "Perpendicular", refs: L });
      if (!axis) out.push({ kind: "equal", label: "Equal length", refs: L });
    }
  }
  if (n === 2 && P.length === 2) {
    out.push({ kind: "coincident", label: P.includes(ORIGIN) ? "Join to origin" : "Join", refs: P });
  }
  if (n === 2 && P.length === 1 && L.length === 1 && P[0] !== ORIGIN) {
    out.push({ kind: "on_line", label: AXES.includes(L[0]) ? "On axis" : "On line", refs: [P[0], L[0]] });
    if (!axis) out.push({ kind: "midpoint", label: "Midpoint", refs: [P[0], L[0]] });
  }
  if (n === 2 && P.length === 1 && R.length === 1 && P[0] !== ORIGIN) out.push({ kind: "on_circle", label: "On circle", refs: [P[0], R[0]] });
  if (n === 2 && L.length === 1 && R.length === 1) {
    out.push({ kind: "tangent", label: "Tangent", refs: [L[0], R[0]], side: tangentSide(sk, L[0], R[0]) });
  }
  if (n === 2 && R.length === 2) {
    out.push({ kind: "equal", label: "Equal radius", refs: R }, { kind: "tangent", label: "Tangent", refs: R, side: circlesSide(sk, R[0], R[1]) });
  }
  if (n >= 1 && n === P.length) {
    const loose = P.filter((p) => !isFixed(sk, p));
    if (loose.length) out.push({ kind: "fix", label: n > 1 ? "Fix in place" : "Fix", refs: loose });
  }
  // Not the ones already there (the same relation on the same things, either way round).
  const key = (kind: string, refs: string[]) => `${kind}:${[...refs].sort().join(",")}`;
  const have = new Set(sk.constraints.map((c) => key(c.kind, c.refs)));
  return out.filter((o) => o.kind === "fix" || !have.has(key(o.kind, o.refs)));
}

/** Which side of the line the circle's centre is on, as drawn (+1 left of a→b, −1 right). */
function tangentSide(sk: Sketch, lineId: string, roundId: string): number {
  const l = lineOf(sk, lineId), r = shapeById(sk, roundId);
  if (!l || !r || r.kind === "line") return 1;
  const [a, b, c] = [l[0], l[1], pointAt(sk, r.c)];
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) >= 0 ? 1 : -1;
}

/** Touching outside (+1) or one inside the other (−1), whichever is closer to the drawing. */
function circlesSide(sk: Sketch, r0: string, r1: string): number {
  const g = (sid: string) => {
    const s = shapeById(sk, sid);
    if (!s || s.kind === "line") return { c: [0, 0] as V2, r: 0 };
    const c = pointAt(sk, s.c);
    const r = s.kind === "circle" ? s.r : Math.hypot(...(pointAt(sk, s.a).map((v, i) => v - c[i]) as V2));
    return { c, r };
  };
  const [A, B] = [g(r0), g(r1)];
  const d = Math.hypot(A.c[0] - B.c[0], A.c[1] - B.c[1]);
  return Math.abs(d - (A.r + B.r)) <= Math.abs(d - Math.abs(A.r - B.r)) ? 1 : -1;
}

/** The dimension that fits what's selected, or null. */
export function dimensionFor(sk: Sketch, ids: string[]): { kind: ConstraintKind; refs: string[] } | null {
  const { points: P, lines: L, round: R } = picked(sk, ids);
  const n = P.length + L.length + R.length;
  if (n === 1 && L.length === 1) return { kind: "distance", refs: L };
  if (n === 1 && R.length === 1) return { kind: shapeById(sk, R[0])?.kind === "circle" ? "diameter" : "radius", refs: R };
  if (n === 2 && P.length === 2) return { kind: "distance", refs: P };
  if (n === 2 && P.length === 1 && L.length === 1) return { kind: "point_line_distance", refs: [P[0], L[0]] };
  if (n === 2 && L.length === 2) {
    const c = { kind: "angle" as const, refs: L };
    const a = measure(sk, { id: "", kind: "angle", refs: L, value: null, driving: true, side: null });
    // Parallel lines have no angle to speak of: their gap instead (from one line's end to the other).
    if (Math.abs(Math.sin((a * Math.PI) / 180)) < 1e-3) {
      const [line, other] = AXES.includes(L[0]) ? [L[1], L[0]] : [L[0], L[1]];
      const first = shapeById(sk, line);
      return first?.kind === "line" ? { kind: "point_line_distance", refs: [first.a, other] } : null;
    }
    return c;
  }
  return null;
}

/**
 * Add a dimension at its current value. If the rest already decides it (or it would contradict
 * them), it's added as a reference: it shows the worked-out value instead of driving it.
 */
export function addDimension(sk: Sketch, kind: ConstraintKind, refs: string[]): { constraint: Constraint; driving: boolean } {
  const before = solve(sk);
  const c = addConstraint(sk, kind, refs, null, kind === "angle" ? cornerSide(sk, refs) : null);
  c.value = Math.round(measure(sk, c)); // whole mm (or degrees): what you'd mark out
  const after = solve(sk);
  if (!after.ok || (before.ok && after.dof >= before.dof)) {
    c.driving = false;
    c.value = null;
    return { constraint: c, driving: false };
  }
  take(sk, after.sketch);
  return { constraint: c, driving: true };
}

/**
 * Which corner an angle between two lines means: the one you see where they meet (or would),
 * between the longer part of each line. −1 when that needs the second line turned round.
 */
export function cornerSide(sk: Sketch, refs: string[]): number {
  const [l1, l2] = refs.map((r) => lineOf(sk, r));
  if (!l1 || !l2) return 1;
  const [[a1, b1], [a2, b2]] = [l1, l2];
  const d1: V2 = [b1[0] - a1[0], b1[1] - a1[1]], d2: V2 = [b2[0] - a2[0], b2[1] - a2[1]];
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-9) return 1;
  const t = ((a2[0] - a1[0]) * d2[1] - (a2[1] - a1[1]) * d2[0]) / den;
  const u = ((a2[0] - a1[0]) * d1[1] - (a2[1] - a1[1]) * d1[0]) / den;
  // Along each line from the meeting point toward its farther end: forward when that's past the middle.
  return (t < 0.5 ? 1 : -1) * (u < 0.5 ? 1 : -1);
}

const failed = (sk: Sketch): SolveResult => ({ sketch: sk, ok: false, dof: 0, free: new Set(), conflicts: [] });

/** Add a relation; refused (and nothing changed) if the sketch can't satisfy it with the rest. */
export function addRelation(sk: Sketch, opt: RelationOption): SolveResult {
  const trial = structuredClone(sk);
  if (opt.kind === "fix") for (const p of opt.refs) addConstraint(trial, "fix", [p]);
  else if (opt.kind === "coincident") { if (!mergePoints(trial, opt.refs[1], opt.refs[0])) return failed(sk); }
  else addConstraint(trial, opt.kind, opt.refs, null, opt.side ?? null);
  const r = solve(trial);
  if (r.ok) { Object.assign(sk, trial); take(sk, r.sketch); }
  return r;
}

/** Change a dimension's value; refused (and nothing changed) if the rest can't follow. */
export function setDimension(sk: Sketch, cid: string, value: number): SolveResult {
  const trial = structuredClone(sk);
  const c = trial.constraints.find((x) => x.id === cid);
  if (!c || !(Math.abs(value) <= LIMIT)) return failed(sk);
  // Angles are shown without their sign (which way round they turn): keep it.
  c.value = c.kind === "angle" && dimensionValue(sk, c) < 0 ? -Math.abs(value) : value;
  c.driving = true;
  const r = solve(trial);
  if (r.ok) { sk.constraints = trial.constraints; take(sk, r.sketch); }
  return r;
}

/** Shown values: whole mm and tenths of a degree are what a woodworker can cut. */
export function round(v: number): number {
  return Math.round(v * 10) / 10;
}

export function isDimension(c: Constraint): boolean {
  return DIMENSIONS.includes(c.kind);
}

/** A dimension's value: what it drives to, or for a reference, what it measures now. */
export function dimensionValue(sk: Sketch, c: Constraint): number {
  return c.driving && c.value !== null ? c.value : measure(sk, c);
}

// --- names -------------------------------------------------------------------------------------------

/** "Line 2", "Circle 1", "Point 4": numbered by kind, in drawing order. */
export function itemNames(sk: Sketch): Map<string, string> {
  const out = new Map<string, string>();
  const count: Record<string, number> = {};
  const name = (kind: string) => `${kind} ${(count[kind] = (count[kind] ?? 0) + 1)}`;
  for (const s of sk.shapes) out.set(s.id, name(s.kind === "line" ? "Line" : s.kind === "circle" ? "Circle" : "Arc"));
  for (const p of sk.points) out.set(p.id, name("Point"));
  out.set(ORIGIN, "Origin").set(X_AXIS, "X axis").set(Y_AXIS, "Y axis");
  return out;
}

const RELATION_NAMES: Partial<Record<ConstraintKind, string>> = {
  coincident: "joined", horizontal: "horizontal", vertical: "vertical", parallel: "parallel", perpendicular: "perpendicular",
  equal: "equal", tangent: "tangent", on_line: "on", on_circle: "on", midpoint: "midpoint of", fix: "fixed",
};

/** "Line 3 length", "Angle Line 1 → Line 2", "Line 1 ∥ Line 2"… */
export function constraintName(c: Constraint, names: Map<string, string>): string {
  const [a, b] = c.refs.map((r) => names.get(r) ?? "?");
  switch (c.kind) {
    case "distance": return c.refs.length === 1 ? `${a} length` : `${a} to ${b}`;
    case "point_line_distance": return `${a} to ${b}`;
    case "angle": return `Angle ${a} → ${b}`;
    case "radius": return `${a} radius`;
    case "diameter": return `${a} diameter`;
    default: return b ? `${a} ${RELATION_NAMES[c.kind]} ${b}` : `${a} ${RELATION_NAMES[c.kind]}`;
  }
}
