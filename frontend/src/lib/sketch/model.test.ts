import { describe, expect, it } from "vitest";
import { addDimension, addLine, addPoint, addRectangle, addRelation, deleteItems, dimensionFor, mergePoints, newSketch, relationOptions, setDimension, tidy } from "./model";
import { measure, solve } from "./solve";
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
});
