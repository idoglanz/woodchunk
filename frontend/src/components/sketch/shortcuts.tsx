"use client";

import { Keyboard } from "lucide-react";
import { useTranslations, type Messages } from "use-intl";
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

// Keys keep their Latin letters (a Hebrew keyboard maps to them); words in them ("click") are translated.
type Key = string | { word: "doubleClick" | "click" | "drag" };
type Row = [Key[], keyof Messages["sketch"]["shortcuts"]["rows"]];

const GROUPS: { title: keyof Messages["sketch"]["shortcuts"]["groups"]; rows: Row[] }[] = [
  {
    title: "tools",
    rows: [
      [["V"], "select"], [["L"], "line"], [["R"], "rect"], [["C"], "circle"], [["A"], "arc"],
      [["D"], "dimension"], [["Q"], "measure"],
    ],
  },
  {
    title: "drawing",
    rows: [
      [["600", "Enter"], "lineLength"],
      [["1200x600", "Enter"], "rectSize"],
      [["Esc"], "esc"],
      [["G"], "snap"], [["Alt", { word: "click" }], "noSnap"],
      [["X"], "helpers"],
    ],
  },
  {
    title: "selection",
    rows: [
      [[{ word: "doubleClick" }], "wholeShape"],
      [[`${MOD} A`], "all"],
      [["Del"], "delete"],
      [["←↑↓→"], "nudge"],
      [["Shift H"], "horizontal"], [["Shift V"], "vertical"], [["Shift P"], "parallel"], [["Shift R"], "perpendicular"],
      [["Shift E"], "equal"], [["Shift T"], "tangent"], [["Shift J"], "join"], [["Shift O"], "on"],
      [["Shift M"], "midpoint"], [["Shift L"], "collinear"], [["Shift S"], "symmetric"], [["Shift F"], "fix"],
      [["Shift H"], "align"],
    ],
  },
  {
    title: "view",
    rows: [
      [["F"], "fit"], [["+", "−"], "zoom"], [["Space", { word: "drag" }], "pan"], [["M"], "showAll"],
      [[`${MOD} Z`], "undo"], [[`${MOD} Shift Z`], "redo"], [["?"], "list"],
    ],
  },
];

export function Kbd({ children }: { children: string }) {
  return <kbd className="tnum inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] bg-surface-2 px-1.5 font-sans text-[11px] font-semibold text-ink-2 shadow-[inset_0_-1px_0_var(--line-strong)]">{children}</kbd>;
}

/** The keyboard shortcuts, from a button in the toolbar (or ?). */
export function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("sketch.shortcuts");
  return (
    <Pop open={open} onOpenChange={onOpenChange} align="end" className="max-h-[70dvh] w-[340px] overflow-y-auto p-4"
      trigger={<IconButton label={t("button")} size="sm" className="bg-surface/90 shadow-[var(--shadow-card)]"><Keyboard size={16} /></IconButton>}>
      <div className="flex flex-col gap-4">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-3">{t(`groups.${g.title}`)}</h3>
            <ul className="flex flex-col gap-1.5">
              {g.rows.map(([keys, what]) => (
                <li key={what} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="text-ink-2">{t(`rows.${what}`)}</span>
                  <span className="flex shrink-0 items-center gap-1">{keys.map((k) => { const label = typeof k === "string" ? k : t(`keys.${k.word}`); return <Kbd key={label}>{label}</Kbd>; })}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Pop>
  );
}
