import { describe, expect, it } from "vitest";
import { shares } from "./format";

describe("stock shares", () => {
  it("add up to 100 in whole numbers", () => {
    expect(shares([67.2, 32.5, 0.3])).toEqual(["67%", "33%", "<1%"]);
    const out = shares([33.4, 33.3, 33.3]).map((s) => Number(s.replace("%", "")));
    expect(out.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("show nothing used as zeros", () => {
    expect(shares([0, 0, 0])).toEqual(["0%", "0%", "0%"]);
    expect(shares([100, 0, 0])).toEqual(["100%", "0%", "0%"]);
  });
});
