import { describe, expect, it } from "vitest";
import type { ProjectContent } from "@/lib/api/client";
import { addConstraint, addLine, addPoint, addRectangle, connected, deleteItems, newSketch, setDimension } from "./model";
import { lineLength, partLabels, partLines, sketchesOf, syncParts } from "./parts";

function project() {
  const sk = newSketch([]);
  const rail = addLine(sk, addPoint(sk, [0, 0]), addPoint(sk, [800, 0]));
  const len = addConstraint(sk, "distance", [rail], 800);
  const part = { id: "p1", name: "Rail", item_id: "i", qty: 2, length_mm: 800, width_mm: null, grain_locked: false, notes: "",
    members: [], short_mm: null, cuts: [], face_up: "" as const, sketch: { sketch_id: sk.id, shape_id: rail } };
  const content = { name: "x", description: "", settings: {}, extras: [], sketches: [sk],
    assemblies: [{ id: "a", letter: "B", name: "Bench", qty: 1, parts: [part], hardware: [], notes: "", frame: null, frame_warnings: [] }] } as unknown as ProjectContent;
  return { content, sk, rail, len };
}

describe("sketch lines as parts", () => {
  it("keeps a part's length with its line", () => {
    const { content, sk, len } = project();
    expect(setDimension(sk, len.id, 950).ok).toBe(true);
    syncParts(content, sk.id);
    expect(content.assemblies[0].parts[0].length_mm).toBe(950);
    expect(partLabels(content, sk.id).get(content.assemblies[0].parts[0].sketch!.shape_id)?.label).toBe("B1");
  });

  it("lets go of a part whose line is deleted, keeping its length", () => {
    const { content, sk, rail } = project();
    deleteItems(sk, [rail]);
    syncParts(content, sk.id);
    const p = content.assemblies[0].parts[0];
    expect(p.sketch).toBeNull();
    expect(p.length_mm).toBe(800);
    expect(lineLength(sk, rail)).toBeNull();
  });

  it("selects a whole shape from one of its lines", () => {
    const sk = newSketch([]);
    const [a, b, c] = [addPoint(sk, [0, 0]), addPoint(sk, [10, 0]), addPoint(sk, [10, 10])];
    const l1 = addLine(sk, a, b), l2 = addLine(sk, b, c);
    const apart = addLine(sk, addPoint(sk, [50, 50]), addPoint(sk, [60, 50]));
    expect(connected(sk, l1)).toEqual([l1, l2]);
    expect(connected(sk, apart)).toEqual([apart]);
  });

  it("lists an assembly's sketches: attached, and the ones its parts are cut from", () => {
    const { content, sk } = project();
    const other = newSketch(content.sketches, { id: "a", name: "Bench" });
    expect(other.name).toBe("Bench sketch");
    expect(other.assembly_id).toBe("a");
    content.sketches.push(other, newSketch(content.sketches));
    expect(sketchesOf(content, "a").map((x) => [x.sketch.id, x.attached])).toEqual([[sk.id, false], [other.id, true]]);
    expect(newSketch(content.sketches, { id: "a", name: "Bench" }).name).toBe("Bench sketch 2");
  });

  it("makes one part of a whole rectangle, but a part of each line otherwise", () => {
    const sk = newSketch([]);
    const rect = addRectangle(sk, addPoint(sk, [0, 0]), [600, 45]);
    expect(partLines(sk, rect)).toHaveLength(1);
    expect(lineLength(sk, partLines(sk, rect)[0])).toBe(600);
    // Four lines from one point (a "+"), and an open zig-zag: four parts each.
    const c = addPoint(sk, [1000, 1000]);
    const plus = [[1100, 1000], [900, 1000], [1000, 1100], [1000, 900]].map((p) => addLine(sk, c, addPoint(sk, p as [number, number]), false));
    expect(partLines(sk, plus)).toHaveLength(4);
    const z = [addPoint(sk, [0, 2000]), addPoint(sk, [100, 2100]), addPoint(sk, [200, 2000]), addPoint(sk, [300, 2100]), addPoint(sk, [400, 2000])];
    const zig = z.slice(1).map((p, i) => addLine(sk, z[i], p, false));
    expect(partLines(sk, zig)).toHaveLength(4);
  });
});
