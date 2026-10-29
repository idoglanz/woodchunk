"use client";

import { Keyboard } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { Pop } from "@/components/ui/overlay";
import type { ConstraintKind } from "@/lib/sketch/types";

/** Shift + this letter adds the relation to the selection (when it fits). */
export const RELATION_KEYS: Partial<Record<ConstraintKind, string>> = {
  horizontal: "H", vertical: "V", parallel: "P", perpendicular: "R", equal: "E", tangent: "T",
  coincident: "J", on_line: "O", on_circle: "O", midpoint: "M", fix: "F", collinear: "L", symmetric: "S",
};

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl";

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  {
    title: "Tools",
    rows: [
      [["V"], "Select"], [["L"], "Line"], [["R"], "Rectangle"], [["C"], "Circle"], [["A"], "Arc"],
      [["D"], "Dimension (with something selected: dimension it)"],
    ],
  },
  {
    title: "Drawing",
    rows: [
      [["600", "Enter"], "Line length, or a circle's diameter"],
      [["1200x600", "Enter"], "Rectangle size"],
      [["Esc"], "Stop drawing, clear the selection, then back to Select"],
      [["G"], "Snap to grid on or off"], [["Alt", "click"], "Place without snapping"],
      [["X"], "Selected shapes to helpers (construction) and back"],
    ],
  },
  {
    title: "Selection",
    rows: [
      [["Double-click"], "Select a whole shape"],
      [[`${MOD} A`], "Select everything"],
      [["Del"], "Delete"],
      [["←↑↓→"], "Nudge 1 mm (Shift: 10 mm)"],
      [["Shift H"], "Horizontal"], [["Shift V"], "Vertical"], [["Shift P"], "Parallel"], [["Shift R"], "Perpendicular (right angle)"],
      [["Shift E"], "Equal"], [["Shift T"], "Tangent"], [["Shift J"], "Join points (circles: concentric)"], [["Shift O"], "On a line, circle or axis"],
      [["Shift M"], "Midpoint"], [["Shift L"], "Collinear"], [["Shift S"], "Symmetric (two points or lines, and the line between)"], [["Shift F"], "Fix in place"],
      [["Shift H"], "Two or more points: line them up level (V: one above the other)"],
    ],
  },
  {
    title: "View",
    rows: [
      [["F"], "Fit the sketch"], [["+", "−"], "Zoom in, out"], [["Space", "drag"], "Pan"], [["M"], "Show all measurements"],
      [[`${MOD} Z`], "Undo"], [[`${MOD} Shift Z`], "Redo"], [["?"], "This list"],
    ],
  },
];

export function Kbd({ children }: { children: string }) {
  return <kbd className="tnum inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] bg-surface-2 px-1.5 font-sans text-[11px] font-semibold text-ink-2 shadow-[inset_0_-1px_0_var(--line-strong)]">{children}</kbd>;
}

/** The keyboard shortcuts, from a button in the toolbar (or ?). */
export function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Pop open={open} onOpenChange={onOpenChange} align="end" className="max-h-[70dvh] w-[340px] overflow-y-auto p-4"
      trigger={<IconButton label="Keyboard shortcuts (?)" size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]"><Keyboard size={16} /></IconButton>}>
      <div className="flex flex-col gap-4">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-3">{g.title}</h3>
            <ul className="flex flex-col gap-1.5">
              {g.rows.map(([keys, what]) => (
                <li key={what} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="text-ink-2">{what}</span>
                  <span className="flex shrink-0 items-center gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Pop>
  );
}
