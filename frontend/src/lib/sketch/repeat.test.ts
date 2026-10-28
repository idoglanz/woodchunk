import { describe, expect, it } from "vitest";
import { addCircle, addConstraint, addLine, addPoint, addRectangle, newSketch, pointAt } from "./model";
import { extent, planSpacing, repeat, spacing } from "./repeat";
import { solve } from "./solve";

let n = 0;
const newId = () => `r${++n}`;

/** Two fixed upright sides 1200 apart, and one 50 × 500 slat between them, drawn roughly. */
function frame() {
  const sk = newSketch([]);
  const [a, b, c, d] = [addPoint(sk, [0, 0]), addPoint(sk, [0, 600]), addPoint(sk, [1200, 0]), addPoint(sk, [1200, 600])];
  for (const p of [a, b, c, d]) addConstraint(sk, "fix", [p]);
  const left = addLine(sk, a, b), right = addLine(sk, c, d);
  const slat = addRectangle(sk, addPoint(sk, [310, 40]), [362, 540]);
  addConstraint(sk, "distance", [slat[0]], 50);
  addConstraint(sk, "distance", [slat[1]], 500);
  const r = solve(sk);
  Object.assign(sk, { points: r.sketch.points, shapes: r.sketch.shapes });
  return { sk, left, right, slat };
}

describe("repeat with even gaps", () => {
  it("works out the gap", () => {
    expect(spacing(7, 50, 1200, "equal")).toEqual({ gap: 106.25, end: 106.25 });
    expect(spacing(7, 50, 1200, "flush")!.gap).toBeCloseTo(850 / 6, 9);
    expect(spacing(7, 50, 1200, 20)!.gap).toBeCloseTo(810 / 6, 9);
    expect(spacing(30, 50, 1200, "equal")).toBeNull(); // 1500 mm of slats in 1200
  });

  it("fills between two lines, each slat pinned in its place", () => {
    const { sk, left, right, slat } = frame();
    const before = sk.shapes.length;
    const r = repeat(sk, slat, { axis: "x", count: 7, span: { between: [left, right] }, ends: "equal" }, newId);
    expect(r).toEqual({ ok: true, gap: 106.25, end: 106.25 });
    expect(sk.shapes.length).toBe(before + 6 * 4);
    // Every slat's left edge where it belongs (and its right edge 50 further).
    const xs = sk.points.map((p) => Math.round(p.x * 100) / 100).filter((x) => x > 0 && x < 1200);
    const starts = [...new Set(xs)].sort((p, q) => p - q).filter((_, i) => i % 2 === 0);
    expect(starts).toEqual([0, 1, 2, 3, 4, 5, 6].map((i) => 106.25 + i * 156.25));
    const s = solve(sk);
    expect(s.ok).toBe(true);
    // Pinned: the slats can't slide (only their height position is free, 7 of them).
    expect(s.dof).toBe(7);
  });

  it("refuses what doesn't fit, changing nothing", () => {
    const { sk, left, right, slat } = frame();
    const before = structuredClone(sk);
    const r = repeat(sk, slat, { axis: "x", count: 30, span: { between: [left, right] }, ends: "equal" }, newId);
    expect(r.ok).toBe(false);
    expect(sk).toEqual(before);
    // Level lines aren't a boundary for a repeat across X.
    expect(planSpacing(sk, slat, { axis: "x", count: 3, span: { between: [slat[0], slat[2]] }, ends: "equal" }).ok).toBe(false);
  });

  it("steps by a set gap from where the group is", () => {
    const sk = newSketch([]);
    const lines = addRectangle(sk, addPoint(sk, [0, 0]), [100, 20]);
    const r = repeat(sk, lines, { axis: "y", count: 4, span: { gap: 30 }, ends: "flush" }, newId);
    expect(r.ok).toBe(true);
    const e = extent(sk, sk.shapes.map((s) => s.id), "y")!;
    expect(e.max - e.min).toBeCloseTo(4 * 20 + 3 * 30, 6);
    expect(pointAt(sk, sk.points[0].id)[1]).toBeCloseTo(0, 6); // the original stays put
  });

  it("places circles by their edges, not their centres", () => {
    const { sk, left, right } = frame();
    const dowel = addCircle(sk, addPoint(sk, [100, 300]), 25);
    addConstraint(sk, "diameter", [dowel], 50);
    const r = repeat(sk, [dowel], { axis: "x", count: 3, span: { between: [left, right] }, ends: "equal" }, newId);
    expect(r.ok).toBe(true);
    const s = solve(sk);
    expect(s.ok).toBe(true);
    const centres = s.sketch.shapes.filter((x) => x.kind === "circle").map((c) => pointAt(s.sketch, (c as { c: string }).c)[0]).sort((a, b) => a - b);
    [287.5, 600, 912.5].forEach((x, i) => expect(centres[i]).toBeCloseTo(x, 6));
  });

  it("doesn't pin copies to where the original is held across the repeat", () => {
    const sk = newSketch([]);
    const lines = addRectangle(sk, addPoint(sk, [310, 0]), [360, 500]);
    const corner = sk.points[0].id;
    addConstraint(sk, "point_line_distance", [corner, "y_axis"], 310);
    addConstraint(sk, "on_line", [corner, "x_axis"]);
    // A set gap leaves the original where it is: copies keep standing on the X axis, and nothing else.
    const r = repeat(sk, lines, { axis: "x", count: 3, span: { gap: 30 }, ends: "flush" }, newId);
    expect(r.ok).toBe(true);
    const s = solve(sk);
    expect(s.ok).toBe(true);
    const xs = [...new Set(s.sketch.points.map((p) => Math.round(p.x)))].sort((a, b) => a - b);
    expect(xs).toEqual([310, 360, 390, 440, 470, 520]);
    expect(s.sketch.points.every((p) => Math.abs(p.y) < 1e-6 || Math.abs(p.y - 500) < 1e-6)).toBe(true);
  });

  it("explains when the original is held where it can't move to fill a span", () => {
    const sk = newSketch([]);
    const lines = addRectangle(sk, addPoint(sk, [310, 0]), [360, 500]);
    addConstraint(sk, "point_line_distance", [sk.points[0].id, "y_axis"], 310);
    const r = repeat(sk, lines, { axis: "x", count: 3, span: { length: 1000 }, ends: "equal" }, newId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/held in place/);
  });
});
