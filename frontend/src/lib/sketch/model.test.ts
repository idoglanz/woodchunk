import { describe, expect, it } from "vitest";
import { addCircle, addConstraint, addDimension, addLine, addPoint, addRectangle, addRelation, deleteItems, dimensionFor, mergePoints, newSketch, relationOptions, setDimension, tidy } from "./model";
import { LIMIT, measure, solve } from "./solve";
import type { Sketch } from "./types";

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
    expect(relationOptions(sk, [lines[0], lines[2]]).map((o) => o.kind)).toEqual(["parallel", "perpendicular", "equal"]);
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
});
