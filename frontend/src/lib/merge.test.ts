import { describe, expect, it } from "vitest";
import { merge3 } from "./merge";

const part = (id: string, qty = 1, name = id) => ({ id, name, qty, length_mm: 500 });
const project = (parts: ReturnType<typeof part>[], name = "Bench") => ({ name, assemblies: [{ id: "A", name: "Frame", parts }] });

describe("three-way merge", () => {
  it("keeps both people's changes to different parts", () => {
    const base = project([part("p1"), part("p2")]);
    const mine = project([part("p1", 3), part("p2")]);
    const theirs = project([part("p1"), part("p2", 5)]);
    const { value, conflicts } = merge3(base, mine, theirs);
    expect(conflicts).toEqual([]);
    expect(value.assemblies[0].parts.map((p) => p.qty)).toEqual([3, 5]);
  });

  it("combines fields of the same part and of the project", () => {
    const base = project([part("p1")]);
    const mine = project([{ ...part("p1"), qty: 2 }]);
    const theirs = project([{ ...part("p1"), length_mm: 900 }], "Bench v2");
    const { value, conflicts } = merge3(base, mine, theirs);
    expect(conflicts).toEqual([]);
    expect(value).toEqual(project([{ ...part("p1", 2), length_mm: 900 }], "Bench v2"));
  });

  it("keeps parts added on both sides, mine after the part before it", () => {
    const base = project([part("p1"), part("p2")]);
    const mine = project([part("p1"), part("m1"), part("p2")]);
    const theirs = project([part("p1"), part("p2"), part("t1")]);
    expect(merge3(base, mine, theirs).value.assemblies[0].parts.map((p) => p.id)).toEqual(["p1", "m1", "p2", "t1"]);
  });

  it("deletes what one side removed and the other left alone", () => {
    const base = project([part("p1"), part("p2")]);
    const mine = project([part("p1")]);
    const theirs = project([part("p1", 4), part("p2")]);
    const { value, conflicts } = merge3(base, mine, theirs);
    expect(conflicts).toEqual([]);
    expect(value.assemblies[0].parts).toEqual([part("p1", 4)]);
  });

  it("reports the same field changed differently, by name", () => {
    const base = project([part("p1", 1, "Leg")]);
    const { conflicts } = merge3(base, project([part("p1", 2, "Leg")]), project([part("p1", 3, "Leg")]));
    expect(conflicts).toEqual([{ path: ["assemblies", "Frame", "parts", "Leg", "qty"] }]);
  });

  it("reports a part one side deleted while the other changed it", () => {
    const base = project([part("p1", 1, "Leg")]);
    const { conflicts } = merge3(base, project([]), project([part("p1", 2, "Leg")]));
    expect(conflicts).toEqual([{ path: ["assemblies", "Frame", "parts", "Leg"] }]);
  });

  it("merges lists keyed by name, like a frame's sizes", () => {
    const sizes = (w: number, h: number) => ({ params: [{ name: "W", mm: w }, { name: "H", mm: h }] });
    const { value, conflicts } = merge3(sizes(1200, 750), sizes(1400, 750), sizes(1200, 900));
    expect(conflicts).toEqual([]);
    expect(value).toEqual(sizes(1400, 900));
  });

  it("follows my reordering when they didn't reorder", () => {
    const base = project([part("a"), part("b"), part("c")]);
    const mine = project([part("c"), part("a"), part("b")]);
    const theirs = project([part("a", 2), part("b"), part("c")]);
    expect(merge3(base, mine, theirs).value.assemblies[0].parts.map((p) => [p.id, p.qty])).toEqual([["c", 1], ["a", 2], ["b", 1]]);
  });
});
