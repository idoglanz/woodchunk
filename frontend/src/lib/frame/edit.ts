/**
 * Edits made directly on the model: moving joints, adding and deleting bars. Pure functions on a
 * frame (mutating it, for use inside an editor edit), so they're unit-tested without a canvas.
 */

import { evaluate } from "./expr";
import { add, length, scale, sub, type Vec } from "./kernel";
import type { Frame, FrameMember } from "./types";

const SAME_POINT_MM = 0.5;
const AXES = ["x", "y", "z"] as const;

export function paramsOf(frame: Frame): Record<string, number> {
  return Object.fromEntries((frame.params ?? []).map((p) => [p.name, p.mm]));
}

export function nodePositions(frame: Frame): Map<string, Vec> {
  const params = paramsOf(frame);
  const out = new Map<string, Vec>();
  for (const n of frame.nodes) {
    try {
      out.set(n.id, [evaluate(n.x, params), evaluate(n.y, params), evaluate(n.z, params)]);
    } catch { /* reported by the kernel */ }
  }
  return out;
}

/** Round to a step, avoiding -0. */
export const snapTo = (v: number, step: number) => (Math.round(v / step) * step) || 0;

/**
 * Move a node. On each axis that changed: a coordinate that is exactly a parameter ("W") changes
 * that parameter, so everything sized by it follows (dragging a corner resizes the frame);
 * anything else becomes a plain number.
 */
export function moveNode(frame: Frame, nodeId: string, to: Vec): void {
  const node = frame.nodes.find((n) => n.id === nodeId);
  const from = nodePositions(frame).get(nodeId);
  if (!node || !from) return;
  AXES.forEach((axis, i) => {
    if (Math.abs(to[i] - from[i]) < 0.01) return;
    const src = node[axis];
    const param = typeof src === "string" ? frame.params?.find((p) => p.name === src.trim()) : undefined;
    if (param && to[i] > 0) param.mm = to[i];
    else node[axis] = to[i];
  });
}

/**
 * Join joint `from` into joint `into` (they're at the same place): its bars now end at `into`.
 * A bar that would join `into` to itself, or repeat a bar already there, is dropped.
 */
export function mergeNode(frame: Frame, from: string, into: string): void {
  if (from === into || !frame.nodes.some((n) => n.id === into)) return;
  const seen = new Set(frame.members.filter((m) => m.a !== from && m.b !== from).map((m) => [m.a, m.b].sort().join("|")));
  frame.members = frame.members.filter((m) => {
    if (m.a !== from && m.b !== from) return true;
    if (m.a === from) m.a = into;
    if (m.b === from) m.b = into;
    const key = [m.a, m.b].sort().join("|");
    if (m.a === m.b || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  frame.nodes = frame.nodes.filter((n) => n.id !== from);
  const kept = new Set(frame.members.map((m) => m.id));
  frame.joints = (frame.joints ?? []).filter((j) => j.node !== from && !(j.through && !kept.has(j.through)));
}

/** The joints at the other ends of a joint's bars. */
export function neighbours(frame: Frame, node: string): Set<string> {
  const out = new Set<string>();
  for (const m of frame.members) {
    if (m.a === node) out.add(m.b);
    if (m.b === node) out.add(m.a);
  }
  return out;
}

export function findNodeAt(frame: Frame, at: Vec): string | null {
  for (const [id, p] of nodePositions(frame)) if (length(sub(p, at)) <= SAME_POINT_MM) return id;
  return null;
}

export type Endpoint = { node: string } | { at: Vec };

function endpointNode(frame: Frame, e: Endpoint, newId: () => string): string {
  if ("node" in e) return e.node;
  const existing = findNodeAt(frame, e.at);
  if (existing) return existing;
  const id = newId();
  frame.nodes.push({ id, x: e.at[0], y: e.at[1], z: e.at[2] });
  return id;
}

/**
 * Add a bar between two endpoints (reusing a node already at a point). Returns its id and end node,
 * or null, changing nothing, if it would have no length, duplicate a bar, or an endpoint's node is gone.
 */
export function addMember(frame: Frame, a: Endpoint, b: Endpoint, itemId: string | null, newId: () => string): { member: string; end: string } | null {
  const pos = nodePositions(frame);
  const where = (e: Endpoint) => ("node" in e ? pos.get(e.node) : e.at);
  const pa = where(a), pb = where(b);
  if (!pa || !pb || length(sub(pa, pb)) < 1) return null;
  const idOf = (e: Endpoint, p: Vec) => ("node" in e ? e.node : findNodeAt(frame, p));
  const [ea, eb] = [idOf(a, pa), idOf(b, pb)];
  if (ea && eb && frame.members.some((m) => (m.a === ea && m.b === eb) || (m.a === eb && m.b === ea))) return null;
  const na = endpointNode(frame, a, newId);
  const nb = endpointNode(frame, b, newId);
  const member: FrameMember = { id: newId(), a: na, b: nb, item_id: itemId, roll_deg: 0, anchor: "auto", name: "" };
  frame.members.push(member);
  return { member: member.id, end: nb };
}

/** Delete bars, then nodes no bar uses (and their joint settings). */
export function deleteMembers(frame: Frame, ids: string[]): void {
  const gone = new Set(ids);
  frame.members = frame.members.filter((m) => !gone.has(m.id));
  const used = new Set(frame.members.flatMap((m) => [m.a, m.b]));
  frame.nodes = frame.nodes.filter((n) => used.has(n.id));
  frame.joints = (frame.joints ?? []).filter((j) => used.has(j.node) && !(j.through && gone.has(j.through)));
}

/**
 * Set a bar's length (joint to joint) by moving one end along the bar: the end with fewer other
 * bars on it (the far end on a tie). Coordinates tied to a size (W, H…) change that size.
 */
export function setMemberLength(frame: Frame, memberId: string, mm: number): void {
  const m = frame.members.find((x) => x.id === memberId);
  const pos = nodePositions(frame);
  const a = m && pos.get(m.a), b = m && pos.get(m.b);
  if (!m || !a || !b || !(mm >= 1)) return;
  const degree = (n: string) => frame.members.filter((x) => x.a === n || x.b === n).length;
  const [fixed, moving, from] = degree(m.a) < degree(m.b) ? [b, m.a, a] : [a, m.b, b];
  const d = sub(from, fixed);
  const len = length(d);
  if (len < 1e-9) return;
  moveNode(frame, moving, add(fixed, scale(d, mm / len)));
}

/** The material new bars get: the one most used in the frame. */
export function commonItem(frame: Frame): string | null {
  const count = new Map<string, number>();
  for (const m of frame.members) if (m.item_id) count.set(m.item_id, (count.get(m.item_id) ?? 0) + 1);
  let best: string | null = null;
  for (const [id, n] of count) if (best === null || n > count.get(best)!) best = id;
  return best;
}
