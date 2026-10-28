/**
 * Sketch lines as parts: a part can be cut to a line of a sketch (`Part.sketch`), and its length
 * follows the line whenever the sketch changes. Deleting the line (or the sketch) keeps the part
 * at its last length and drops the link.
 */

import type { Assembly, Part, ProjectContent } from "@/lib/api/client";
import { measure } from "./solve";
import { connected } from "./model";
import type { Sketch } from "./types";

/** A line's length as a part is cut: to a tenth of a millimetre. */
export function lineLength(sk: Sketch, lineId: string): number | null {
  const s = sk.shapes.find((x) => x.id === lineId);
  if (s?.kind !== "line") return null;
  return Math.round(measure(sk, { id: "", kind: "distance", refs: [lineId], value: null, driving: true, side: null }) * 10) / 10;
}

/** Parts cut to this sketch's lines, everywhere in the project. */
export function linkedParts(content: Pick<ProjectContent, "assemblies">, sketchId: string): { a: Assembly; p: Part }[] {
  return content.assemblies.flatMap((a) => a.parts.filter((p) => p.sketch?.sketch_id === sketchId).map((p) => ({ a, p })));
}

/** Bring the lengths of the parts cut to `sketchId` up to date (drop links to lines that are gone). */
export function syncParts(content: ProjectContent, sketchId: string) {
  const sk = content.sketches.find((x) => x.id === sketchId);
  for (const { p } of linkedParts(content, sketchId)) {
    const len = sk ? lineLength(sk, p.sketch!.shape_id) : null;
    if (len === null) p.sketch = null;
    else if (Math.abs(p.length_mm - len) > 1e-9) p.length_mm = len;
  }
}

/** Which part (if any) each line of a sketch is cut as: line id → its assembly letter and number ("B3"). */
export function partLabels(content: Pick<ProjectContent, "assemblies">, sketchId: string): Map<string, { label: string; letter: string; name: string }> {
  const out = new Map<string, { label: string; letter: string; name: string }>();
  for (const a of content.assemblies) {
    a.parts.forEach((p, i) => {
      if (p.sketch?.sketch_id === sketchId) out.set(p.sketch.shape_id, { label: `${a.letter}${i + 1}`, letter: a.letter, name: p.name });
    });
  }
  return out;
}

/**
 * The lines to make parts of, from a selection: a whole rectangle (or any closed loop of four
 * lines, all selected) is one piece, cut to its longest side; other lines are a part each.
 */
export function partLines(sk: Sketch, ids: string[]): string[] {
  const picked = new Set(ids.filter((id) => sk.shapes.find((s) => s.id === id)?.kind === "line"));
  const out: string[] = [];
  const done = new Set<string>();
  for (const id of picked) {
    if (done.has(id)) continue;
    const loop = connected(sk, id);
    const closed = loop.length === 4 && loop.every((l) => picked.has(l) && sk.shapes.find((s) => s.id === l)?.kind === "line");
    if (closed) {
      loop.forEach((l) => done.add(l));
      out.push(loop.reduce((best, l) => ((lineLength(sk, l) ?? 0) > (lineLength(sk, best) ?? 0) ? l : best)));
    } else {
      done.add(id);
      out.push(id);
    }
  }
  return out;
}

/** The sketches an assembly is drawn in: attached to it, or that its parts are cut from. */
export function sketchesOf(content: Pick<ProjectContent, "assemblies" | "sketches">, assemblyId: string): { sketch: Sketch; attached: boolean }[] {
  const a = content.assemblies.find((x) => x.id === assemblyId);
  const cutFrom = new Set((a?.parts ?? []).map((p) => p.sketch?.sketch_id).filter(Boolean));
  return content.sketches
    .filter((s) => s.assembly_id === assemblyId || cutFrom.has(s.id))
    .map((s) => ({ sketch: s, attached: s.assembly_id === assemblyId }));
}
