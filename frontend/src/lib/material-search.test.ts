import { describe, expect, it } from "vitest";
import type { CatalogItem } from "@/lib/api/client";
import { searchItems } from "./material-search";

const lumber = (id: string, en: string, t: number, w: number) =>
  ({ id, kind: "lumber", name: { en, he: "" }, thickness_mm: t, width_mm: w, sheet_stock: [], search: en.toLowerCase().replace(/×/g, "x") }) as unknown as CatalogItem;

const shadeRail = lumber("rail", "27 × 52 pine shade rail, planed (20 × 45 net)", 20, 45);
const square = lumber("sq", "52 × 52 pine, planed (45 × 45 net)", 45, 45);
const board = lumber("b", "50 × 100 whitewood, rough (44 × 100 net)", 44, 100);

describe("material search", () => {
  it("puts the size you typed as a pair first", () => {
    expect(searchItems([shadeRail, square], "52 52 pine").map((i) => i.id)).toEqual(["sq", "rail"]);
  });

  it("matches sizes written any way", () => {
    expect(searchItems([board, square], "44x100").map((i) => i.id)).toEqual(["b"]);
    expect(searchItems([board, square], "44/100 rough").map((i) => i.id)).toEqual(["b"]);
  });
});
