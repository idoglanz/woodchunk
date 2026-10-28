import { describe, expect, it } from "vitest";
import { measure, solve } from "./solve";
import type { Constraint, ConstraintKind, Shape, Sketch, SketchPoint } from "./types";

let n = 0;
const P = (x: number, y: number, id = `p${++n}`): SketchPoint => ({ id, x, y });
const line = (id: string, a: string, b: string): Shape => ({ id, kind: "line", a, b });
const C = (kind: ConstraintKind, refs: string[], value: number | null = null, extra: Partial<Constraint> = {}): Constraint =>
  ({ id: `c${++n}`, kind, refs, value, driving: true, side: null, ...extra });
const sketch = (points: SketchPoint[], shapes: Shape[], constraints: Constraint[]): Sketch => ({ id: "s", name: "s", assembly_id: null, points, shapes, constraints });
const lengthOf = (sk: Sketch, lineId: string) => measure(sk, C("distance", [lineId]));
const near = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);

/** A triangle drawn roughly: A at the origin, B to the right, C up and to the left of B. */
function triangle(constraints: (ids: { ab: string; ac: string; bc: string; A: string }) => Constraint[]) {
  const pts = [P(0, 0, "A"), P(280, 15, "B"), P(20, 390, "C")];
  const shapes = [line("ab", "A", "B"), line("ac", "A", "C"), line("bc", "B", "C")];
  return sketch(pts, shapes, constraints({ ab: "ab", ac: "ac", bc: "bc", A: "A" }));
}

describe("sketch solver", () => {
  it("works out the third side from two sides and the angle between them", () => {
    const sk = triangle(({ ab, ac }) => [C("horizontal", [ab]), C("distance", [ab], 300), C("distance", [ac], 400), C("angle", [ab, ac], 90)]);
    const r = solve(sk);
    expect(r.ok).toBe(true);
    near(lengthOf(r.sketch, "bc"), 500);
    // Determined as a shape, though nothing pins where it sits on the page.
    expect(r.dof).toBe(0);
    expect(r.free.size).toBe(0);
  });

  it("is fully defined by a rectangle's horizontals, verticals, width and height", () => {
    const pts = [P(0, 0, "a"), P(1150, 30, "b"), P(1170, 640, "c"), P(-20, 610, "d")];
    const shapes = [line("bottom", "a", "b"), line("right", "b", "c"), line("top", "c", "d"), line("left", "d", "a")];
    const sk = sketch(pts, shapes, [
      C("horizontal", ["bottom"]), C("horizontal", ["top"]), C("vertical", ["left"]), C("vertical", ["right"]),
      C("distance", ["bottom"], 1200), C("distance", ["left"], 600), C("fix", ["a"]),
    ]);
    const r = solve(sk);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(0);
    const c = r.sketch.points.find((p) => p.id === "c")!;
    near(c.x, 1200);
    near(c.y, 600);
  });

  it("says what is still free, and keeps it where it was drawn", () => {
    const pts = [P(0, 0, "a"), P(1150, 30, "b"), P(1170, 640, "c"), P(-20, 610, "d")];
    const shapes = [line("bottom", "a", "b"), line("right", "b", "c"), line("top", "c", "d"), line("left", "d", "a")];
    const sk = sketch(pts, shapes, [
      C("horizontal", ["bottom"]), C("horizontal", ["top"]), C("vertical", ["left"]), C("vertical", ["right"]),
      C("distance", ["bottom"], 1200), C("fix", ["a"]),
    ]);
    const r = solve(sk);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(1); // the height
    expect(r.free.has("left")).toBe(true);
    expect(r.free.has("bottom")).toBe(false);
    // The height stays about as drawn (the least change that satisfies the rest).
    expect(lengthOf(r.sketch, "left")).toBeGreaterThan(580);
    expect(lengthOf(r.sketch, "left")).toBeLessThan(650);
  });

  it("counts a loose line's length as its only freedom", () => {
    const r = solve(sketch([P(0, 0, "a"), P(300, 40, "b")], [line("ab", "a", "b")], []));
    expect(r.dof).toBe(1);
    expect(r.free.has("ab")).toBe(true);
    const flat = solve(sketch([P(0, 0, "a"), P(300, 40, "b")], [line("ab", "a", "b")], [C("distance", ["ab"], 300)]));
    expect(flat.dof).toBe(0);
    expect(flat.free.size).toBe(0);
  });

  it("marks only what can change when nothing is fixed", () => {
    const pts = [P(0, 0, "a"), P(1150, 30, "b"), P(1170, 640, "c"), P(-20, 610, "d")];
    const shapes = [line("bottom", "a", "b"), line("right", "b", "c"), line("top", "c", "d"), line("left", "d", "a")];
    const r = solve(sketch(pts, shapes, [
      C("horizontal", ["bottom"]), C("horizontal", ["top"]), C("vertical", ["left"]), C("vertical", ["right"]), C("distance", ["bottom"], 1200),
    ]));
    expect(r.dof).toBe(1);
    expect(r.free.has("bottom")).toBe(false);
    expect(r.free.has("left")).toBe(true);
  });

  it("finds the numbers that contradict each other", () => {
    const sk = triangle(({ ab, ac, bc }) => [C("distance", [ab], 100), C("distance", [ac], 100), C("distance", [bc], 300, { id: "too-long" })]);
    const r = solve(sk);
    expect(r.ok).toBe(false);
    expect(r.conflicts).toContain("too-long");
    expect(r.sketch).toBe(sk); // left as it was
  });

  it("accepts a dimension that agrees with the rest", () => {
    const sk = triangle(({ ab, ac, bc }) => [
      C("horizontal", [ab]), C("distance", [ab], 300), C("distance", [ac], 400), C("distance", [bc], 500), C("angle", [ab, ac], 90),
    ]);
    expect(solve(sk).ok).toBe(true);
  });

  it("keeps a line tangent to a circle", () => {
    const pts = [P(0, 0, "a"), P(400, 0, "b"), P(150, 70, "o")];
    const sk = sketch(pts, [line("ab", "a", "b"), { id: "circ", kind: "circle", c: "o", r: 40 }], [
      C("horizontal", ["ab"]), C("fix", ["a"]), C("radius", ["circ"], 50), C("tangent", ["ab", "circ"], null, { side: 1 }),
    ]);
    const r = solve(sk);
    expect(r.ok).toBe(true);
    const o = r.sketch.points.find((p) => p.id === "o")!;
    near(o.y, 50); // the radius above the line
  });

  it("makes radii equal", () => {
    const sk = sketch([P(0, 0, "o1"), P(300, 0, "o2")], [{ id: "c1", kind: "circle", c: "o1", r: 30 }, { id: "c2", kind: "circle", c: "o2", r: 50 }],
      [C("equal", ["c1", "c2"]), C("diameter", ["c1"], 80)]);
    const r = solve(sk);
    expect(r.ok).toBe(true);
    near((r.sketch.shapes[1] as { r: number }).r, 40);
  });

  it("keeps an arc's ends on its radius", () => {
    const sk = sketch([P(0, 0, "o"), P(90, 0, "s"), P(0, 110, "e")], [{ id: "arc", kind: "arc", c: "o", a: "s", b: "e" }],
      [C("fix", ["o"]), C("radius", ["arc"], 100)]);
    const r = solve(sk);
    expect(r.ok).toBe(true);
    for (const id of ["s", "e"]) {
      const p = r.sketch.points.find((q) => q.id === id)!;
      near(Math.hypot(p.x, p.y), 100);
    }
  });

  it("turns a line to a set angle, measured counter-clockwise", () => {
    const pts = [P(0, 0, "a"), P(500, 0, "b"), P(0, 0, "c"), P(300, 220, "d")];
    const sk = sketch(pts, [line("base", "a", "b"), line("brace", "c", "d")],
      [C("fix", ["a"]), C("coincident", ["a", "c"]), C("horizontal", ["base"]), C("angle", ["base", "brace"], 30)]);
    const r = solve(sk);
    expect(r.ok).toBe(true);
    near(measure(r.sketch, C("angle", ["base", "brace"])), 30);
  });

  it("drags a point when the constraints allow, and holds it when they don't", () => {
    const pts = [P(0, 0, "a"), P(400, 0, "b")];
    const free = sketch(pts, [line("ab", "a", "b")], [C("fix", ["a"]), C("horizontal", ["ab"])]);
    const moved = solve(free, { drag: [{ point: "b", to: [600, 0] }] });
    near(moved.sketch.points[1].x, 600);
    const pinned = sketch(pts, [line("ab", "a", "b")], [C("fix", ["a"]), C("horizontal", ["ab"]), C("distance", ["ab"], 400)]);
    const held = solve(pinned, { drag: [{ point: "b", to: [600, 0] }] });
    expect(held.ok).toBe(true);
    near(held.sketch.points[1].x, 400);
  });

  it("ignores reference dimensions when solving", () => {
    const sk = triangle(({ ab }) => [C("horizontal", [ab]), C("distance", [ab], 999, { driving: false })]);
    const r = solve(sk);
    expect(r.ok).toBe(true);
    near(lengthOf(r.sketch, "ab"), lengthOf(sk, "ab"), 1);
  });
});
