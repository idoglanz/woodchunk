import { describe, expect, it } from "vitest";
import { addCircle, addConstraint, addDimension, addLine, addPoint, addRectangle, addRelation, deleteItems, dimensionFor, mergePoints, newSketch, pointAt, relationOptions, setConstruction, setDimension, tidy } from "./model";
import { LIMIT, measure, solve } from "./solve";
import { midOf, ORIGIN, X_AXIS, Y_AXIS, type Sketch } from "./types";
import { hitTest } from "./view";

function rectangle() {
  const sk = newSketch([]);
  const a = addPoint(sk, [0, 0]);
  const lines = addRectangle(sk, a, [1150, 610]);
  return { sk, a, lines };
}

const lengthOf = (sk: Sketch, id: string) => measure(sk, { id: "", kind: "distance", refs: [id], value: null, driving: true, side: null });

describe("sketch editing", () => {
  it("names new sketches after the ones there are", () => {
    expect(newSketch([{ name: "Sketch 1" }, { name: "Sketch 2" }]).name).toBe("Sketch 3");
    expect(newSketch([{ name: "Sketch 2" }]).name).toBe("Sketch 3");
  });

  it("makes a line drawn nearly level exactly level", () => {
    const sk = newSketch([]);
    const l = addLine(sk, addPoint(sk, [0, 0]), addPoint(sk, [500, 8]));
    expect(sk.constraints.map((c) => [c.kind, c.refs[0]])).toEqual([["horizontal", l]]);
    const steep = addLine(sk, addPoint(sk, [0, 0]), addPoint(sk, [300, 400]));
    expect(sk.constraints.some((c) => c.refs[0] === steep)).toBe(false);
  });

  it("works out what a dimension adds, and shows the rest as measured", () => {
    const { sk, lines } = rectangle();
    const width = addDimension(sk, "distance", [lines[0]]);
    expect(width.driving).toBe(true);
    expect(setDimension(sk, width.constraint.id, 1200).ok).toBe(true);
    expect(lengthOf(sk, lines[2])).toBeCloseTo(1200, 6); // the top follows
    // The top's length is already decided by the bottom: a reference, showing 1200.
    const top = addDimension(sk, "distance", [lines[2]]);
    expect(top.driving).toBe(false);
    expect(top.constraint.value).toBeNull();
    expect(measure(sk, top.constraint)).toBeCloseTo(1200, 6);
  });

  it("refuses a value the rest can't meet, leaving the sketch as it was", () => {
    const sk = newSketch([]);
    const [a, b, c] = [addPoint(sk, [0, 0]), addPoint(sk, [300, 10]), addPoint(sk, [100, 300])];
    const ab = addLine(sk, a, b, false), bc = addLine(sk, b, c, false), ca = addLine(sk, c, a, false);
    const d1 = addDimension(sk, "distance", [ab]).constraint;
    const d2 = addDimension(sk, "distance", [bc]).constraint;
    addDimension(sk, "distance", [ca]);
    expect(setDimension(sk, d1.id, 300).ok).toBe(true);
    expect(setDimension(sk, d2.id, 300).ok).toBe(true);
    const before = structuredClone(sk);
    const r = setDimension(sk, sk.constraints[2].id, 700); // longer than the other two together
    expect(r.ok).toBe(false);
    expect(sk).toEqual(before);
  });

  it("offers the relations and dimension that fit the selection", () => {
    const { sk, a, lines } = rectangle();
    expect(relationOptions(sk, [lines[0], lines[2]]).map((o) => o.kind)).toEqual(["parallel", "perpendicular", "equal", "collinear"]);
    expect(relationOptions(sk, [a]).map((o) => o.kind)).toEqual(["fix"]);
    expect(dimensionFor(sk, [lines[0]])?.kind).toBe("distance");
    expect(dimensionFor(sk, [lines[0], lines[1]])?.kind).toBe("angle");
    // Parallel lines: the gap between them.
    expect(dimensionFor(sk, [lines[0], lines[2]])?.kind).toBe("point_line_distance");
  });

  it("joins two points into one", () => {
    const sk = newSketch([]);
    const l1 = addLine(sk, addPoint(sk, [0, 0]), addPoint(sk, [100, 50]), false);
    const p = addPoint(sk, [102, 49]);
    const l2 = addLine(sk, p, addPoint(sk, [200, 200]), false);
    const end = (sk.shapes[0] as { b: string }).b;
    expect(addRelation(sk, { kind: "coincident", label: "", refs: [end, p] }).ok).toBe(true);
    expect(sk.points.some((q) => q.id === p)).toBe(false);
    expect((sk.shapes.find((s) => s.id === l2) as { a: string }).a).toBe(end);
    expect(sk.shapes.map((s) => s.id)).toEqual([l1, l2]);
    mergePoints(sk, end, (sk.shapes[0] as { a: string }).a); // a line squashed to a point goes
    expect(sk.shapes.map((s) => s.id)).toEqual([l2]);
  });

  it("deletes a line with its loose ends and its relations, keeping shared corners", () => {
    const { sk, lines } = rectangle();
    deleteItems(sk, [lines[0]]);
    expect(sk.shapes).toHaveLength(3);
    expect(sk.points).toHaveLength(4); // every corner is still used by another side
    expect(sk.constraints.some((c) => c.refs.includes(lines[0]))).toBe(false);
    deleteItems(sk, [lines[1], lines[2]]);
    expect(sk.points).toHaveLength(2);
    expect(solve(sk).ok).toBe(true);
  });

  it("drops leftovers that refer to deleted things", () => {
    const { sk, a } = rectangle();
    const broken = { ...sk, points: sk.points.filter((p) => p.id !== a) };
    const clean = tidy(broken);
    expect(clean.shapes).toHaveLength(2);
    expect(clean.constraints.every((c) => c.refs.every((r) => clean.shapes.some((s) => s.id === r) || clean.points.some((p) => p.id === r)))).toBe(true);
    expect(tidy(sk)).toBe(sk);
  });

  it("measures the corner you see where chained lines meet, not its supplement", () => {
    const sk = newSketch([]);
    const [a, b, c] = [addPoint(sk, [0, 0]), addPoint(sk, [100, 0]), addPoint(sk, [50, 86.6])];
    const ab = addLine(sk, a, b), bc = addLine(sk, b, c, false);
    const angle = addDimension(sk, "angle", [ab, bc]).constraint;
    expect(Math.abs(angle.value!)).toBe(60);
    expect(setDimension(sk, angle.id, 90).ok).toBe(true);
    const [pb, pc] = [sk.points[1], sk.points[2]];
    expect(Math.abs(pc.x - pb.x)).toBeLessThan(1e-6); // square to the base now
    expect(Math.abs(measure(sk, sk.constraints.find((x) => x.id === angle.id)!))).toBeCloseTo(90, 6);
  });

  it("never solves a circle to a negative radius (a drag across its tangent line is held)", () => {
    const sk = newSketch([]);
    const [a, b] = [addPoint(sk, [0, 0]), addPoint(sk, [400, 0])];
    const l = addLine(sk, a, b);
    addConstraint(sk, "fix", [a]);
    addConstraint(sk, "fix", [b]);
    const o = addPoint(sk, [150, 50]);
    const circ = addCircle(sk, o, 50);
    addConstraint(sk, "tangent", [l, circ], null, 1);
    const r = solve(sk, { drag: [{ point: o, to: [150, -80] }] });
    expect(r.ok).toBe(true);
    expect((r.sketch.shapes.find((s) => s.id === circ) as { r: number }).r).toBeGreaterThan(0);
    expect(r.sketch.points.find((p) => p.id === o)!.y).toBeGreaterThan(0);
  });

  it("joins onto a fixed point without moving it, and refuses two fixed points apart", () => {
    const sk = newSketch([]);
    const [p, q, r] = [addPoint(sk, [0, 0]), addPoint(sk, [100, 50]), addPoint(sk, [300, 0])];
    addLine(sk, q, r, false);
    addConstraint(sk, "fix", [p]);
    expect(addRelation(sk, { kind: "coincident", label: "", refs: [q, p] }).ok).toBe(true);
    expect(sk.points.map((x) => [x.id, x.x, x.y])).toContainEqual([p, 0, 0]);
    expect(sk.points.some((x) => x.id === q)).toBe(false);
    addConstraint(sk, "fix", [r]);
    const before = structuredClone(sk);
    expect(mergePoints(sk, r, p)).toBe(false);
    expect(sk).toEqual(before);
  });

  it("refuses sizes past what a sketch can hold", () => {
    const { sk, lines } = rectangle();
    const w = addDimension(sk, "distance", [lines[0]]).constraint;
    expect(setDimension(sk, w.id, LIMIT * 1.5).ok).toBe(false);
  });

  it("handles big sketches", () => {
    const sk = newSketch([]);
    for (let i = 0; i < 55; i++) {
      const a = addPoint(sk, [i * 300, 0]);
      for (const l of addRectangle(sk, a, [i * 300 + 200, 100]).slice(0, 2)) addConstraint(sk, "distance", [l], 200);
    }
    expect(sk.points.length).toBeGreaterThan(200);
    const t = performance.now();
    expect(solve(sk).ok).toBe(true);
    expect(solve(sk, { quick: true, drag: [{ point: sk.points[5].id, to: [1000, 300] }] }).ok).toBe(true);
    expect(performance.now() - t).toBeLessThan(1000); // separate pieces are solved one by one
  });

  it("counts where separate pieces sit relative to each other as free", () => {
    const sk = newSketch([]);
    const pieces = [0, 2000].map((x0) => {
      const lines = addRectangle(sk, addPoint(sk, [x0, 0]), [x0 + 1000, 500]);
      addConstraint(sk, "distance", [lines[0]], 1000);
      addConstraint(sk, "distance", [lines[1]], 500);
      return lines;
    });
    const r = solve(sk);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(2); // the second rectangle can slide anywhere (both stay level)
    expect(pieces[0].some((l) => r.free.has(l))).toBe(false);
    expect(pieces[1].every((l) => r.free.has(l))).toBe(true);
  });

  it("holds a drawing attached to the origin: a dimensioned rectangle from it is fully defined", () => {
    const sk = newSketch([]);
    const lines = addRectangle(sk, ORIGIN, [1150, 610]);
    addDimension(sk, "distance", [lines[0]]);
    addDimension(sk, "distance", [lines[1]]);
    const r = solve(sk);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(0); // no longer free to slide or turn
    expect(r.free.size).toBe(0);
    // Dragging a corner can't move it now.
    const corner = sk.points[1].id;
    const held = solve(sk, { drag: [{ point: corner, to: [2000, 2000] }] });
    expect(held.sketch.points[1]).toEqual(sk.points[1]);
  });

  it("measures from the axes and keeps a point on one", () => {
    const sk = newSketch([]);
    const p = addPoint(sk, [300, 7]);
    expect(dimensionFor(sk, [p, X_AXIS])).toEqual({ kind: "point_line_distance", refs: [p, X_AXIS] });
    expect(addRelation(sk, { kind: "on_line", label: "", refs: [p, X_AXIS] }).ok).toBe(true);
    expect(Math.abs(sk.points[0].y)).toBeLessThan(1e-9);
    // The origin and axes can't be deleted, and a point joined to the origin goes to it.
    deleteItems(sk, [ORIGIN, X_AXIS]);
    expect(sk.constraints).toHaveLength(1);
    const q = addPoint(sk, [5, 5]);
    expect(addRelation(sk, { kind: "coincident", label: "", refs: [ORIGIN, q] }).ok).toBe(true);
    expect(sk.points.some((x) => x.id === q)).toBe(false);
  });
});

describe("relations like a sketch tool has them", () => {
  const relate = (sk: Sketch, ids: string[], label: string) => {
    const o = relationOptions(sk, ids).find((x) => x.label === label);
    expect(o, `${label} offered`).toBeDefined();
    expect(addRelation(sk, o!).ok).toBe(true);
  };

  it("lines up two lines' midpoints, and joins a point to one", () => {
    const sk = newSketch([]);
    const top = addLine(sk, addPoint(sk, [0, 300]), addPoint(sk, [800, 300]));
    const shelf = addLine(sk, addPoint(sk, [60, 0]), addPoint(sk, [500, 0]));
    relate(sk, [midOf(top), midOf(shelf)], "Align vertically");
    expect(pointAt(sk, midOf(shelf))[0]).toBeCloseTo(pointAt(sk, midOf(top))[0], 6);
    // Still level, still its own length: only slid along.
    expect(lengthOf(sk, shelf)).toBeCloseTo(440, 6);
    const p = addPoint(sk, [390, 160]);
    const o = relationOptions(sk, [p, midOf(top)]).find((x) => x.label === "Join to midpoint")!;
    expect(o.refs).toEqual([p, top]);
    expect(addRelation(sk, o).ok).toBe(true);
    expect(pointAt(sk, p)).toEqual(pointAt(sk, midOf(top)).map((v) => expect.closeTo(v, 6)));
    // Deleting the line drops what referred to its midpoint.
    deleteItems(sk, [shelf]);
    expect(sk.constraints.some((c) => c.refs.includes(midOf(shelf)))).toBe(false);
  });

  it("picks a line's midpoint only right at its middle, and attaches to points, midpoints and axes", () => {
    const sk = newSketch([]);
    const l = addLine(sk, addPoint(sk, [100, 100]), addPoint(sk, [500, 100]));
    expect(hitTest(sk, [302, 103], 10)).toBe(midOf(l));
    expect(hitTest(sk, [380, 103], 10)).toBe(l);
    // Attaching (no shapes): the midpoint, else an axis, never the line itself.
    expect(hitTest(sk, [300, 95], 10, new Set(), true, false)).toBe(midOf(l));
    expect(hitTest(sk, [380, 103], 10, new Set(), true, false)).toBeNull();
    expect(hitTest(sk, [380, 4], 10, new Set(), true, false)).toBe(X_AXIS);
  });

  it("puts lines in line, and mirrors points about a line or an axis", () => {
    const sk = newSketch([]);
    const a = addLine(sk, addPoint(sk, [0, 0]), addPoint(sk, [100, 100]), false);
    const b = addLine(sk, addPoint(sk, [300, 260]), addPoint(sk, [400, 410]), false);
    relate(sk, [a, b], "Collinear");
    // All four ends on one straight line (both lines moved as little as they could to get there).
    const [o, d, p, q] = sk.points.map((x) => pointAt(sk, x.id));
    const across = (r: number[]) => ((d[0] - o[0]) * (r[1] - o[1]) - (d[1] - o[1]) * (r[0] - o[0])) / Math.hypot(d[0] - o[0], d[1] - o[1]);
    expect(across(p)).toBeCloseTo(0, 6);
    expect(across(q)).toBeCloseTo(0, 6);

    const m = newSketch([]);
    const [u, v] = [addPoint(m, [-210, 50]), addPoint(m, [190, 70])];
    relate(m, [u, v, Y_AXIS], "Symmetric about axis");
    expect(pointAt(m, u)[0]).toBeCloseTo(-pointAt(m, v)[0], 6);
    expect(pointAt(m, u)[1]).toBeCloseTo(pointAt(m, v)[1], 6);
  });

  it("mirrors two lines about a centre line, the shared end on it", () => {
    const sk = newSketch([]);
    const apex = addPoint(sk, [10, 300]);
    const left = addLine(sk, addPoint(sk, [-400, 0]), apex, false);
    const right = addLine(sk, apex, addPoint(sk, [380, 20]), false);
    const centre = addLine(sk, addPoint(sk, [0, -50]), addPoint(sk, [0, 400]), false);
    addConstraint(sk, "vertical", [centre]);
    setConstruction(sk, [centre], true);
    // The helper is the mirror, whichever order they were picked in.
    relate(sk, [centre, left, right], "Symmetric");
    const r = solve(sk);
    expect(r.ok).toBe(true);
    const x0 = pointAt(sk, sk.points[3].id)[0];
    expect(pointAt(sk, apex)[0]).toBeCloseTo(x0, 6);
    expect(lengthOf(sk, left)).toBeCloseTo(lengthOf(sk, right), 6);
  });

  it("makes several lines parallel or equal to the first, and circles concentric", () => {
    const sk = newSketch([]);
    const ls = [0, 1, 2].map((i) => addLine(sk, addPoint(sk, [i * 100, 0]), addPoint(sk, [i * 100 + 50 + i * 20, 300 - i * 40]), false));
    const par = relationOptions(sk, ls).find((o) => o.kind === "parallel")!;
    expect(par.each).toEqual([[ls[0], ls[1]], [ls[0], ls[2]]]);
    relate(sk, ls, "Equal length");
    expect(lengthOf(sk, ls[2])).toBeCloseTo(lengthOf(sk, ls[0]), 6);
    // Already equal: not offered again.
    expect(relationOptions(sk, ls).some((o) => o.label === "Equal length")).toBe(false);

    const c = newSketch([]);
    const [c1, c2] = [addCircle(c, addPoint(c, [0, 0]), 40), addCircle(c, addPoint(c, [12, 9]), 70)];
    relate(c, [c1, c2], "Concentric");
    expect(c.points).toHaveLength(1);
  });

  it("aligns any number of points with the first", () => {
    const sk = newSketch([]);
    const ps = [addPoint(sk, [0, 0]), addPoint(sk, [100, 20]), addPoint(sk, [300, -15])];
    relate(sk, ps, "Align horizontally");
    expect(sk.points.every((p) => Math.abs(p.y - sk.points[0].y) < 1e-6)).toBe(true);
  });
});

describe("helpers and driven lengths", () => {
  it("doesn't count what helper lines can do as freedom", () => {
    const sk = newSketch([]);
    const lines = addRectangle(sk, ORIGIN, [1200, 600]);
    addDimension(sk, "distance", [lines[0]]);
    addDimension(sk, "distance", [lines[1]]);
    expect(solve(sk).dof).toBe(0);
    // A centre line hanging off the top, free to swing: still fully defined.
    const top = sk.shapes.find((s) => s.id === lines[2]) as { a: string };
    const centre = addLine(sk, addPoint(sk, [600, 600]), addPoint(sk, [600, 900]), false);
    setConstruction(sk, [centre], true);
    expect(addRelation(sk, { kind: "midpoint", label: "", refs: [(sk.shapes.find((s) => s.id === centre) as { a: string }).a, lines[2]] }).ok).toBe(true);
    expect(solve(sk).dof).toBe(0);
    // And one off on its own.
    setConstruction(sk, [addLine(sk, addPoint(sk, [-500, -500]), addPoint(sk, [-100, -300]), false)], true);
    expect(solve(sk).dof).toBe(0);
    // As drawing, the same line is two more things to pin (where it ends): no longer defined.
    setConstruction(sk, [centre], false);
    expect(solve(sk).dof).toBeGreaterThan(0);
    expect(top.a).toBeTruthy();
  });

  it("knows which lines' lengths the rest decides", () => {
    const sk = newSketch([]);
    const lines = addRectangle(sk, ORIGIN, [1200, 600]);
    const corner = (sk.shapes.find((s) => s.id === lines[1]) as { b: string }).b;
    const brace = addLine(sk, ORIGIN, corner, false);
    expect(solve(sk).driven.has(brace)).toBe(false);
    addDimension(sk, "distance", [lines[0]]);
    addDimension(sk, "distance", [lines[1]]);
    const r = solve(sk);
    expect([...r.driven].sort()).toEqual([...lines, brace].sort());
    // Sliding but square: a free rectangle's width is decided by its dimension, not its place.
    const free = newSketch([]);
    const fl = addRectangle(free, addPoint(free, [100, 100]), [300, 200]);
    addDimension(free, "distance", [fl[0]]);
    expect(solve(free).driven).toEqual(new Set([fl[0], fl[2]]));
  });

  it("swings a dragged line round where it's held, as far as it can", () => {
    const sk = newSketch([]);
    const end = addPoint(sk, [100, 0]);
    const l = addLine(sk, ORIGIN, end, false);
    addConstraint(sk, "distance", [l], 100);
    const r = solve(sk, { drag: [{ point: end, to: [0, 250] }], quick: true });
    expect(r.ok).toBe(true);
    const p = pointAt(r.sketch, end);
    expect(p[0]).toBeCloseTo(0, 3);
    expect(p[1]).toBeCloseTo(100, 3);
  });
});

