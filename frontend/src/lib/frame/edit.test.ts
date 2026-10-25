import { describe, expect, it } from "vitest";
import { addMember, commonItem, deleteMembers, mergeNode, moveNode, neighbours, nodePositions, setMemberLength } from "./edit";
import { Profile, solve, type Vec } from "./kernel";
import { snapDrag, snapPoint, typedEnd, type Projector } from "./snap";
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

describe("bar lengths", () => {
  it("typing a rail's length moves its free end; a corner tied to W resizes the frame", () => {
    const f = table();
    const rail = f.members.find((m) => m.name === "Apron" && nodePositions(f).get(m.a)![1] === 0 && nodePositions(f).get(m.b)![1] === 0)!;
    setMemberLength(f, rail.id, 1500);
    expect(f.params!.find((p) => p.name === "W")!.mm).toBe(1500);
  });

  it("moves a dangling end along the bar", () => {
    const f: Frame = { nodes: [{ id: "a", x: 0, y: 0, z: 0 }, { id: "b", x: 300, y: 400, z: 0 }], members: [{ id: "ab", a: "a", b: "b" }] };
    setMemberLength(f, "ab", 1000);
    expect(nodePositions(f).get("b")).toEqual([600, 800, 0]);
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
  const base = { nodes, members, plane: { axis: 2 as const, at: 0 }, grid: 10 };

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

  it("lines up with joints that are close on screen", () => {
    // 5 px right of the joint at x = 1000 (but far from it in y): x snaps to 1000.
    const s = snapPoint({ ...base, cursor: [100.5, -60], proj: top(100.5, -60) });
    expect(s).toMatchObject({ kind: "plane", at: [1000, 600, 0] });
    expect(s.kind === "plane" && s.aligned.map((g) => g.axis)).toEqual([0]);
  });

  it("draws on any plane and follows only the allowed axes", () => {
    // Looking along -Y at a front plane (y = 0): screen x = X, screen y = -Z.
    const front = (cx: number, cy: number): Projector => ({
      toScreen: ([x, , z]) => [x / 10, -z / 10],
      ray: { origin: [cx * 10, -10000, -cy * 10], dir: [0, 1, 0] },
    });
    const empty = { nodes: new Map<string, Vec>(), members: [], grid: 10 };
    expect(snapPoint({ ...empty, cursor: [20, -45], proj: front(20, -45), plane: { axis: 1, at: 0 } })).toMatchObject({ kind: "plane", at: [200, 0, 450] });
    const s = snapPoint({ ...empty, start: [0, 0, 0], axes: [0, 2], cursor: [1, -60], proj: front(1, -60), plane: { axis: 1, at: 0 } });
    expect(s).toMatchObject({ kind: "axis", axis: 2, at: [0, 0, 600] });
  });

  it("finds where an axis from the start meets a bar", () => {
    // A post at x = 1000 from y = -200 to 800; start at the origin, pointer near (1000, 0) but a bit off.
    const post = { nodes: new Map<string, Vec>([["p", [1000, -200, 0]], ["q", [1000, 800, 0]]]), members: [{ id: "post", a: [1000, -200, 0] as Vec, b: [1000, 800, 0] as Vec }], plane: base.plane, grid: 10 };
    const s = snapPoint({ ...post, start: [0, 0, 0], cursor: [101, 1.2], proj: top(101, 1.2) });
    expect(s).toMatchObject({ kind: "meet", member: "post", axis: 0, at: [1000, 0, 0] });
  });

  it("finds the foot of a square line from the start to a bar", () => {
    // A diagonal brace from (0, 0) to (1000, 1000); from (1000, 200) the square line lands at (600, 600).
    const brace = { nodes: new Map<string, Vec>([["p", [0, 0, 0]], ["q", [1000, 1000, 0]]]), members: [{ id: "brace", a: [0, 0, 0] as Vec, b: [1000, 1000, 0] as Vec }], plane: base.plane, grid: 10 };
    const s = snapPoint({ ...brace, start: [1000, 200, 0], cursor: [60.5, -60.5], proj: top(60.5, -60.5) });
    expect(s).toMatchObject({ kind: "square", member: "brace" });
    expect(s.at.map((v) => Math.round(v * 1000) / 1000)).toEqual([600, 600, 0]);
  });

  it("a typed length goes along the current direction", () => {
    expect(typedEnd([0, 0, 0], [0, 50, 0], 750)).toEqual([0, 750, 0]);
    expect(typedEnd([0, 0, 0], [0, 0, 0], 750)).toBeNull();
  });
});

describe("dragging joints", () => {
  // Looking straight down (as in "snapping"): 1 px = 10 mm.
  const toScreen = ([x, y]: Vec): [number, number] => [x / 10, -y / 10];
  const others = new Map<string, Vec>([["c", [1000, 0, 0]], ["d", [1000, 800, 0]]]);
  const bars = [{ id: "cd", a: [1000, 0, 0] as Vec, b: [1000, 800, 0] as Vec }];
  const drag = (raw: Vec, free: (0 | 1 | 2)[] = [0]) => snapDrag({ raw, base: [0, 300, 0], free, toScreen, nodes: others, members: bars, step: 5 });

  it("lands on a bar it can reach along the arrow (a T-joint)", () => {
    expect(drag([993, 300, 0])).toMatchObject({ kind: "on-bar", member: "cd", at: [1000, 300, 0] });
  });

  it("lands on a joint only if the arrow passes through it", () => {
    expect(snapDrag({ raw: [993, 250, 0], base: [0, 250, 0], free: [0, 1], toScreen, nodes: others, members: bars, step: 5 })).toMatchObject({ kind: "on-bar", at: [1000, 250, 0] });
    expect(snapDrag({ raw: [995, 4, 0], base: [0, 0, 0], free: [0, 1], toScreen, nodes: others, members: bars, step: 5 })).toMatchObject({ kind: "node", node: "c" });
    expect(drag([1003, 300, 0])).not.toMatchObject({ kind: "node" });
  });

  it("snaps to the middle of a bar", () => {
    expect(snapDrag({ raw: [996, 398, 0], base: [0, 0, 0], free: [0, 1], toScreen, nodes: others, members: bars, step: 5 })).toMatchObject({ kind: "mid", at: [1000, 400, 0] });
  });

  it("otherwise moves in steps and lines up with joints nearby", () => {
    expect(drag([502, 300, 0])).toEqual({ kind: "free", at: [500, 300, 0], aligned: [] });
    const s = snapDrag({ raw: [400, 796, 0], base: [0, 0, 0], free: [0, 1], toScreen, nodes: others, members: [], step: 5 });
    expect(s).toMatchObject({ kind: "free", at: [400, 800, 0] });
  });
});

describe("joining joints", () => {
  it("a joint dropped on another becomes it", () => {
    const f: Frame = { params: [], nodes: [{ id: "a", x: 0, y: 0, z: 0 }, { id: "b", x: 500, y: 0, z: 0 }, { id: "c", x: 500, y: 0, z: 0 }, { id: "d", x: 500, y: 0, z: 500 }],
      members: [{ id: "ab", a: "a", b: "b" }, { id: "cd", a: "c", b: "d" }], joints: [{ node: "b", kind: "miter" }] } as Frame;
    mergeNode(f, "b", "c");
    expect(f.nodes.map((x) => x.id)).toEqual(["a", "c", "d"]);
    expect(f.members.find((m) => m.id === "ab")).toMatchObject({ a: "a", b: "c" });
    expect(f.joints).toEqual([]);
    expect(neighbours(f, "c")).toEqual(new Set(["a", "d"]));
  });

  it("drops a bar that would end where it starts, or repeat another", () => {
    const f: Frame = { params: [], nodes: [{ id: "a", x: 0, y: 0, z: 0 }, { id: "b", x: 500, y: 0, z: 0 }, { id: "c", x: 0, y: 0, z: 0 }],
      members: [{ id: "ab", a: "a", b: "b" }, { id: "cb", a: "c", b: "b" }, { id: "ac", a: "a", b: "c" }] } as Frame;
    mergeNode(f, "c", "a");
    expect(f.members.map((m) => m.id)).toEqual(["ab"]);
  });
});

describe("export", () => {
  it("writes a binary STL with every member's triangles", async () => {
    const { frameStl } = await import("./export");
    const res = solve(table(), profiles);
    const blob = frameStl(res.members);
    const buf = new DataView(await blob.arrayBuffer());
    const triangles = buf.getUint32(80, true);
    expect(triangles).toBeGreaterThan(res.members.length * 12);
    expect(blob.size).toBe(84 + 50 * triangles);
  });
});
