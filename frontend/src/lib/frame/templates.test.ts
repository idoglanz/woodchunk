import { describe, expect, it } from "vitest";
import { Profile, solve } from "./kernel";
import { TEMPLATES } from "./templates";
import type { ProfileSpec } from "./types";

const tube: ProfileSpec = { shape: "rect_tube", w: 40, h: 40, t: 2 };
const board: ProfileSpec = { shape: "rect", w: 95, h: 22 };
const profiles = { tube: Profile.from(tube), board: Profile.from(board) };

function build(id: string, options: Record<string, number> = {}, rails: "tube" | "board" = "tube") {
  const t = TEMPLATES.find((x) => x.id === id)!;
  const params = Object.fromEntries(t.params.map((p) => [p.name, p.mm]));
  const opts = { ...Object.fromEntries(t.options.map((o) => [o.key, o.value])), ...options };
  const frame = t.build({ params, options: opts, items: { legs: "tube", rails }, sections: { legs: tube, rails: rails === "tube" ? tube : board } });
  return { frame, res: solve(frame, profiles), params };
}

describe("templates", () => {
  it.each(TEMPLATES.map((t) => t.id))("%s builds a clean frame", (id) => {
    const { res } = build(id);
    expect(res.warnings).toEqual([]);
    expect(res.members.every((m) => m.sp > 0)).toBe(true);
  });

  it("table: legs run full height, aprons fit between them (outside sizes)", () => {
    const { res, params } = build("table");
    const lengths = res.groups.map((g) => [g.qty, g.lp]).sort((a, b) => b[1] - a[1]);
    expect(lengths).toEqual([[2, params.W - 80], [4, params.H], [2, params.D - 80]]);
  });

  it("table with a lower frame adds four stretchers at the legs' inner faces", () => {
    const { res } = build("table", { lower: 1 });
    expect(res.members).toHaveLength(12);
    expect(res.groups.reduce((n, g) => n + g.qty, 0)).toBe(12);
  });

  it("stands rectangular rails on edge", () => {
    const { frame } = build("table", {}, "board");
    expect(frame.members.filter((m) => m.name === "Apron").every((m) => m.roll_deg === 90)).toBe(true);
  });

  it("shelf unit makes a frame per shelf", () => {
    const { res } = build("shelf", { shelves: 5 });
    expect(res.members).toHaveLength(4 + 5 * 4);
  });

  it("gate has stiles, top and bottom rails and middle rails", () => {
    const { res, params } = build("gate", { middle: 2 });
    expect(res.members).toHaveLength(6);
    const rails = res.groups.find((g) => g.qty === 4)!;
    expect(rails.lp).toBe(params.W - 80);
  });
});
