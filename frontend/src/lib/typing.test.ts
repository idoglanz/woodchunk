import { describe, expect, it } from "vitest";
import { shortcutKey } from "./typing";

describe("shortcutKey", () => {
  it("takes Latin letters as typed", () => {
    expect(shortcutKey({ key: "L", code: "KeyL" })).toBe("l");
    // AZERTY: the key where QWERTY has Q types A, and A it stays.
    expect(shortcutKey({ key: "a", code: "KeyQ" })).toBe("a");
  });

  it("reads a Hebrew layout's letter keys as their Latin letters", () => {
    expect(shortcutKey({ key: "ך", code: "KeyL" })).toBe("l");
    expect(shortcutKey({ key: "/", code: "KeyQ" })).toBe("q");
    expect(shortcutKey({ key: "'", code: "KeyW" })).toBe("w");
  });

  it("leaves other keys alone", () => {
    expect(shortcutKey({ key: "Escape", code: "Escape" })).toBe("Escape");
    expect(shortcutKey({ key: "-", code: "Minus" })).toBe("-");
    expect(shortcutKey({ key: "?", code: "Slash" })).toBe("?");
  });
});
