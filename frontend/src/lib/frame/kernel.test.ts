import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ExprError, evaluate } from "./expr";
import { Profile, solve, type CutGroup } from "./kernel";
import type { Frame, ProfileSpec } from "./types";

// The golden fixtures shared with the backend (backend/tests/test_frame.py).
const DIR = new URL("../../../../fixtures/frames/", import.meta.url);
const TOL = 0.11;

type ExpectedGroup = { item_id: string; qty: number; lp: number; sp: number; ends: [number, number][]; face_up?: string };
type Fixture = { profiles: Record<string, ProfileSpec>; frame: Frame; expect: { warnings: number; groups: ExpectedGroup[] } };

const load = (name: string) => {
  const data = JSON.parse(readFileSync(new URL(name, DIR), "utf8")) as Fixture;
  const profiles = Object.fromEntries(Object.entries(data.profiles).map(([k, v]) => [k, Profile.from(v)]));
  return { data, profiles };
};

function matches(want: ExpectedGroup, g: CutGroup): boolean {
  if (want.item_id !== g.item_id || want.qty !== g.qty) return false;
  if (Math.abs(want.lp - g.lp) > TOL || Math.abs(want.sp - g.sp) > TOL) return false;
  const sortEnds = (e: [number, number][]) => [...e].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const w = sortEnds(want.ends), got = sortEnds(g.ends.map((e) => [e.miter, e.bevel]));
  if (w.some((pair, i) => pair.some((x, j) => Math.abs(x - got[i][j]) > TOL))) return false;
  return want.face_up === undefined || want.face_up === g.face_up;
}

describe("golden fixtures", () => {
  for (const name of readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()) {
    it(name, () => {
      const { data, profiles } = load(name);
      const res = solve(data.frame, profiles);
      expect(res.warnings).toHaveLength(data.expect.warnings);
      expect(res.groups).toHaveLength(data.expect.groups.length);
      for (const want of data.expect.groups) {
        expect(res.groups.some((g) => matches(want, g)), JSON.stringify({ want, got: res.groups.map((g) => [g.item_id, g.qty, g.lp, g.sp, g.ends.map((e) => [e.miter, e.bevel]), g.face_up]) })).toBe(true);
      }
    });
  }
});

describe("frame edits", () => {
  it("moves with its parameters", () => {
    const { data, profiles } = load("table-butt.json");
    data.frame.params![0].mm = 1500;
    const aprons = solve(data.frame, profiles).groups.filter((g) => g.item_id === "apron").map((g) => g.lp).sort((a, b) => a - b);
    expect(aprons).toEqual([460, 1360]);
  });

  it("lets a joint override decide who runs through", () => {
    const { data, profiles } = load("t-junction.json");
    data.frame.joints = [{ node: "c2", kind: "butt", through: "short1" }];
    const byId = Object.fromEntries(solve(data.frame, profiles).members.map((m) => [m.id, m]));
    expect(byId.short1.lp).toBe(560);
    expect(byId.long1.lp).toBe(960);
  });
});

describe("expressions", () => {
  const p = { W: 1200, H: 750 };
  it("evaluates", () => {
    expect(evaluate("W", p)).toBe(1200);
    expect(evaluate("H - 40", p)).toBe(710);
    expect(evaluate("(W - 2*35) / 2", p)).toBe(565);
    expect(evaluate("-W/4 + 10", p)).toBe(-290);
    expect(evaluate(12.5, p)).toBe(12.5);
  });
  it("rejects bad input", () => {
    for (const bad of ["W +", "X", "2 / 0", "(W", "W W", ""]) expect(() => evaluate(bad, p)).toThrow(ExprError);
  });
});
