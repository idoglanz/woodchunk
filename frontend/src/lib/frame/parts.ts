/**
 * A drawn assembly's parts, generated live in the editor. Mirrors backend/app/services/frame/parts.py
 * (the server regenerates them on every save; ids and numbers match, see kernel parity tests).
 */

import type { Assembly, CatalogItem, Part } from "@/lib/api/client";
import { Profile, solve, stableId, type FrameResult } from "./kernel";
import type { Frame, ProfileSpec } from "./types";

/** A bar's cross-section; lumber is a solid width × thickness rectangle. */
export function sectionOf(item: CatalogItem): ProfileSpec | null {
  if (item.kind !== "lumber") return null;
  if (item.profile) return item.profile;
  if (item.thickness_mm && item.width_mm) return { shape: "rect", w: item.width_mm, h: item.thickness_mm };
  return null;
}

export function profilesFor(items: Iterable<CatalogItem>): Record<string, Profile> {
  const out: Record<string, Profile> = {};
  for (const it of items) {
    const sec = sectionOf(it);
    if (sec) out[it.id] = Profile.from(sec);
  }
  return out;
}

export function solveFrame(frame: Frame, byId: Map<string, CatalogItem>): FrameResult {
  return solve(frame, profilesFor(byId.values()));
}

/** Replace a drawn assembly's parts with its frame's cut list (mutates, for use inside an editor edit). */
export function deriveParts(a: Assembly, byId: Map<string, CatalogItem>): FrameResult | null {
  if (!a.frame) return null;
  const res = solveFrame(a.frame as Frame, byId);
  const names = new Map(a.frame.members.map((m) => [m.id, m.name]));
  const parts: Part[] = [];
  for (const g of res.groups) {
    const item = g.item_id ? byId.get(g.item_id) : undefined;
    if (!item || !sectionOf(item)) continue;
    // Identical pieces can have different roles ("Bottom rail", "Top rail"): name them all, like the server.
    const name = [...new Set(g.members.map((m) => names.get(m)).filter(Boolean))].join(" / ") || item.name.en || "Member";
    parts.push({
      id: "f" + stableId(`${a.id}|${g.key}`), name, item_id: g.item_id, qty: g.qty,
      length_mm: Math.max(0, g.lp), short_mm: Math.max(0, g.sp), width_mm: null, grain_locked: false, notes: "",
      cuts: g.ends.map((e) => ({ miter: e.miter, bevel: e.bevel })), face_up: g.face_up, members: g.members, sketch: null,
    });
  }
  a.parts = parts;
  a.frame_warnings = res.warnings;
  return res;
}
