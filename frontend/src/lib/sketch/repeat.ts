/**
 * Repeat a group of shapes along X or Y with even gaps: slats across a frame, shelves up a side,
 * pickets along a fence. Work out the gap from what has to fit, then place the copies (each with
 * the group's own relations and dimensions), and pin each one to the boundary when there is one.
 */

import { addConstraint, lineOf, pointAt, pointsOf, shapeById } from "./model";
import { solve, type V2 } from "./solve";
import { ORIGIN, type Constraint, type Sketch } from "./types";

export type Axis = "x" | "y";

/** Dimensions of one shape's size: on copies they become "equal to the original". */
const SIZES: Constraint["kind"][] = ["distance", "radius", "diameter"];

/** How the ends are spaced: like the gaps between ("equal"), touching ("flush"), or a set distance (mm). */
export type Ends = "equal" | "flush" | number;

/** The gap between neighbours, and at each end, for `count` items `width` wide in `span`; null if they don't fit. */
export function spacing(count: number, width: number, span: number, ends: Ends): { gap: number; end: number } | null {
  if (count < 1 || span <= 0) return null;
  const free = span - count * width;
  let gap: number, end: number;
  if (ends === "equal") { gap = free / (count + 1); end = gap; }
  else {
    end = ends === "flush" ? 0 : ends;
    gap = count > 1 ? (free - 2 * end) / (count - 1) : 0;
    if (count === 1) end = (free) / 2; // one item: centred
  }
  return gap < -1e-9 || end < -1e-9 ? null : { gap, end };
}

const coord = (p: V2, axis: Axis) => (axis === "x" ? p[0] : p[1]);

/** The group's shapes and the points they use (the origin can't be copied). */
function groupOf(sk: Sketch, ids: string[]) {
  const shapes = ids.map((id) => shapeById(sk, id)).filter((s) => !!s);
  const points = [...new Set(shapes.flatMap(pointsOf))];
  return { shapes, points };
}

/** Where the group starts and ends along the axis (circles and arcs by their radius). */
export function extent(sk: Sketch, ids: string[], axis: Axis): { min: number; max: number } | null {
  const { shapes, points } = groupOf(sk, ids);
  if (!shapes.length) return null;
  const vals = points.map((p) => coord(pointAt(sk, p), axis));
  for (const s of shapes) {
    if (s.kind === "line") continue;
    const c = coord(pointAt(sk, s.c), axis);
    const r = s.kind === "circle" ? s.r : Math.hypot(...(pointAt(sk, s.a).map((v, i) => v - pointAt(sk, s.c)[i]) as V2));
    vals.push(c - r, c + r);
  }
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

/** Where a boundary line (or axis) sits along the repeat axis: a line square to it. */
export function boundaryAt(sk: Sketch, lineId: string, axis: Axis): number | null {
  const l = lineOf(sk, lineId);
  if (!l) return null;
  const [a, b] = l;
  // Square to the repeat: a line across it (X repeats need upright lines, Y repeats level ones).
  const along = axis === "x" ? Math.abs(b[0] - a[0]) : Math.abs(b[1] - a[1]);
  const across = axis === "x" ? Math.abs(b[1] - a[1]) : Math.abs(b[0] - a[0]);
  if (along > 1e-6 * Math.max(1, across)) return null;
  return (coord(a, axis) + coord(b, axis)) / 2;
}

export type RepeatPlan = {
  axis: Axis;
  count: number;
  /** Fill between two lines, a length from where the group starts, or step by a set gap. */
  span: { between: [string, string] } | { length: number } | { gap: number };
  ends: Ends;
};

export type RepeatResult = { ok: true; gap: number; end: number } | { ok: false; reason: string };

/** The spacing a plan comes to, without changing anything. */
export function planSpacing(sk: Sketch, ids: string[], plan: RepeatPlan): RepeatResult {
  const ext = extent(sk, ids, plan.axis);
  if (!ext) return { ok: false, reason: "Select the shapes to repeat." };
  const width = ext.max - ext.min;
  if ("gap" in plan.span) return plan.span.gap < 0 ? { ok: false, reason: "The gap can't be negative." } : { ok: true, gap: plan.span.gap, end: 0 };
  let span: number;
  if ("between" in plan.span) {
    const [a, b] = plan.span.between.map((l) => boundaryAt(sk, l, plan.axis));
    if (a === null || b === null) return { ok: false, reason: `Pick two ${plan.axis === "x" ? "upright" : "level"} lines to fit between.` };
    span = Math.abs(b - a);
  } else span = plan.span.length;
  const s = spacing(plan.count, width, span, plan.ends);
  return s ? { ok: true, ...s } : { ok: false, reason: `${plan.count} of them don't fit: they need ${Math.round(plan.count * width)} mm.` };
}

/**
 * Repeat the group: the original moves into the first place and copies fill the rest. Between
 * two lines, each one's start is dimensioned from the first line, so they stay put. Refused (and
 * nothing changed) when it doesn't fit or the result doesn't solve.
 */
export function repeat(sk: Sketch, ids: string[], plan: RepeatPlan, newId: () => string): RepeatResult {
  const res = planSpacing(sk, ids, plan);
  if (!res.ok) return res;
  const { shapes, points } = groupOf(sk, ids);
  if (points.includes(ORIGIN)) return { ok: false, reason: "That's attached to the origin: repeat a copy of it instead." };
  const ext = extent(sk, ids, plan.axis)!;
  const width = ext.max - ext.min;
  const step = width + res.gap;

  // Where the first one starts.
  let start = ext.min;
  let first: { line: string; at: number } | null = null; // the boundary the copies are dimensioned from
  if ("between" in plan.span) {
    const [a, b] = plan.span.between.map((l) => boundaryAt(sk, l, plan.axis)!);
    first = a <= b ? { line: plan.span.between[0], at: a } : { line: plan.span.between[1], at: b };
    start = first.at + res.end;
  } else if ("length" in plan.span) start = ext.min + res.end;

  const trial: Sketch = structuredClone(sk);
  const shift = (p: V2, by: number): V2 => (plan.axis === "x" ? [p[0] + by, p[1]] : [p[0], p[1] + by]);
  const group = new Set([...points, ...shapes.map((s) => s.id)]);
  // The group's own relations and dimensions (also to the axes): copied with each copy.
  const own = sk.constraints.filter((c) => c.refs.some((r) => group.has(r)) && c.refs.every((r) => group.has(r) || r === "x_axis" || r === "y_axis"));
  // The point each copy is placed (and dimensioned) by: where the group starts along the axis.
  const lead = points.reduce((best, p) => (coord(pointAt(sk, p), plan.axis) < coord(pointAt(sk, best), plan.axis) ? p : best), points[0]);
  // The group's far edge, if it has one square to the axis (a slat's right side): the next one's
  // gap is dimensioned from it, so the gaps read between the copies.
  const trailing = shapes.find((s) => s.kind === "line" && Math.abs((boundaryAt(sk, s.id, plan.axis) ?? NaN) - ext.max) < 1e-6)?.id;
  let previous: Map<string, string> | null = null;

  for (let i = 0; i < plan.count; i++) {
    const by = start + i * step - ext.min;
    let map = new Map<string, string>();
    if (i === 0) {
      // The original moves into the first place.
      for (const p of trial.points) if (points.includes(p.id)) [p.x, p.y] = shift([p.x, p.y], by);
      map = new Map([...group].map((id) => [id, id]));
    } else {
      for (const pid of points) {
        const id = newId();
        map.set(pid, id);
        const [x, y] = shift(pointAt(sk, pid), by);
        trial.points.push({ id, x, y });
      }
      for (const s of shapes) {
        const id = newId();
        map.set(s.id, id);
        const m = (p: string) => map.get(p)!;
        trial.shapes.push(s.kind === "line" ? { ...s, id, a: m(s.a), b: m(s.b) } : s.kind === "circle" ? { ...s, id, c: m(s.c) } : { ...s, id, c: m(s.c), a: m(s.a), b: m(s.b) });
      }
      for (const c of own) {
        if (SIZES.includes(c.kind) && c.refs.length === 1 && c.driving) {
          // A size (a side's length, a radius): equal to the original's, so there's one number to change.
          addConstraint(trial, "equal", [c.refs[0], map.get(c.refs[0])!]);
        } else trial.constraints.push({ ...c, id: newId(), refs: c.refs.map((r) => map.get(r) ?? r) } as Constraint);
      }
    }
    // Pinned in place (exact values: rounding would unbalance the gaps): the first from the
    // boundary, the rest by their gap from the one before (or from the boundary, without a far edge).
    if (first && i > 0 && trailing && previous) addConstraint(trial, "point_line_distance", [map.get(lead)!, previous.get(trailing)!], res.gap);
    else if (first) addConstraint(trial, "point_line_distance", [map.get(lead)!, first.line], start + i * step - first.at);
    previous = map;
  }

  const solved = solve(trial, { quick: true });
  if (!solved.ok) return { ok: false, reason: "That doesn't fit with the rest of the sketch." };
  Object.assign(sk, trial, { points: solved.sketch.points, shapes: solved.sketch.shapes });
  return res;
}
