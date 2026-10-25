import { describe, expect, it } from "vitest";
import { addMember, commonItem, deleteMembers, moveNode, nodePositions } from "./edit";
import { Profile, solve, type Vec } from "./kernel";
import { snapPoint, typedEnd, type Projector } from "./snap";
import { TEMPLATES } from "./templates";
import type { Frame } from "./types";

const tube = { shape: "rect_tube" as const, w: 40, h: 40, t: 2 };
const profiles = { tube: Profile.from(tube) };
let n = 0;
const newId = () => `id${++n}`;

function table(): Frame {
  const t = TEMPLATES.find((x) => x.id === "table")!;
  return t.build({ params: { W: 1200, D: 600, H: 750, S: 150 }, options: { lower: 1 }, items: { legs: "tube", rails: "tube" }, sections: { legs: tube, rails: tube } }) as Frame;
}

describe("moving joints", () => {
  it("dragging a corner tied to W resizes the whole frame", () => {
    const f = table();
    const corner = f.nodes.find((x) => x.x === "W" && x.y === 0 && x.z === "H")!;
    moveNode(f, corner.id, [1500, 0, 750]);
    expect(f.params!.find((p) => p.name === "W")!.mm).toBe(1500);
    expect(corner.x).toBe("W");
    const aprons = solve(f, profiles).groups.map((g) => g.lp);
    expect(aprons).toContain(1420);
  });

  it("dragging the lower frame up moves all four stretchers (S)", () => {
    const f = table();
    const low = f.nodes.find((x) => x.z === "S")!;
    moveNode(f, low.id, nodePositions(f).get(low.id)!.map((v, i) => (i === 2 ? 300 : v)) as Vec);
    expect(f.params!.find((p) => p.name === "S")!.mm).toBe(300);
  });

  it("a plain coordinate becomes a number", () => {
    const f = table();
    const origin = f.nodes.find((x) => x.x === 0 && x.y === 0 && x.z === 0)!;
    moveNode(f, origin.id, [-100, 0, 0]);
    expect(origin.x).toBe(-100);
    expect(f.params!.find((p) => p.name === "W")!.mm).toBe(1200);
  });
});

describe("adding and deleting bars", () => {
  it("reuses the joint already at a point and refuses zero-length or duplicate bars", () => {
    const f = table();
    const before = f.nodes.length;
    const res = addMember(f, { at: [0, 0, 750] }, { at: [600, 300, 750] }, "tube", newId);
    expect(res).not.toBeNull();
    expect(f.nodes.length).toBe(before + 1);
    expect(addMember(f, { at: [0, 0, 750] }, { at: [600, 300, 750] }, "tube", newId)).toBeNull();
    expect(addMember(f, { at: [5, 5, 5] }, { at: [5, 5, 5.2] }, "tube", newId)).toBeNull();
  });

  it("deleting a bar drops joints nobody uses and their settings", () => {
    const f = table();
    const res = addMember(f, { at: [0, 0, 750] }, { at: [600, 300, 2000] }, "tube", newId)!;
    f.joints = [{ node: res.end, kind: "miter" }];
    deleteMembers(f, [res.member]);
    expect(f.nodes.some((x) => x.id === res.end)).toBe(false);
    expect(f.joints).toEqual([]);
  });

  it("new bars get the frame's most used material", () => {
    expect(commonItem(table())).toBe("tube");
  });
});

describe("snapping", () => {
  // Looking straight down; 1 px = 10 mm, screen y grows toward -Y.
  const top = (cx: number, cy: number): Projector => ({
    toScreen: ([x, y]) => [x / 10, -y / 10],
    ray: { origin: [cx * 10, -cy * 10, 10000], dir: [0, 0, -1] },
  });
  const nodes = new Map<string, Vec>([["a", [0, 0, 0]], ["b", [1000, 0, 0]]]);
  const members = [{ id: "ab", a: [0, 0, 0] as Vec, b: [1000, 0, 0] as Vec }];
  const base = { nodes, members, planeZ: 0, grid: 10 };

  it("prefers joints, then midpoints", () => {
    expect(snapPoint({ ...base, cursor: [98, 3], proj: top(98, 3) })).toMatchObject({ kind: "node", node: "b" });
    expect(snapPoint({ ...base, cursor: [52, 4], proj: top(52, 4) })).toMatchObject({ kind: "mid", member: "ab" });
  });

  it("lands on a bar's span", () => {
    expect(snapPoint({ ...base, cursor: [30, 2], proj: top(30, 2) })).toMatchObject({ kind: "on-bar", at: [300, 0, 0] });
  });

  it("follows an axis from the start point", () => {
    const s = snapPoint({ ...base, start: [0, 0, 0], cursor: [3, -42], proj: top(3, -42) });
    expect(s).toMatchObject({ kind: "axis", axis: 1, at: [0, 420, 0] });
  });

  it("falls back to the grid on the drawing level", () => {
    expect(snapPoint({ ...base, cursor: [33.3, -71.7], proj: top(33.3, -71.7) })).toMatchObject({ kind: "plane", at: [330, 720, 0] });
  });

  it("a typed length goes along the current direction", () => {
    expect(typedEnd([0, 0, 0], [0, 50, 0], 750)).toEqual([0, 750, 0]);
    expect(typedEnd([0, 0, 0], [0, 0, 0], 750)).toBeNull();
  });
});
