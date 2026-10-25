/**
 * Edits made directly on the model: moving joints, adding and deleting bars. Pure functions on a
 * frame (mutating it, for use inside an editor edit), so they're unit-tested without a canvas.
 */

import { evaluate } from "./expr";
import { length, sub, type Vec } from "./kernel";
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

/** Add a bar between two endpoints (reusing a node already at a point). Returns its id, or null if it has no length. */
export function addMember(frame: Frame, a: Endpoint, b: Endpoint, itemId: string | null, newId: () => string): { member: string; end: string } | null {
  const na = endpointNode(frame, a, newId);
  const nb = endpointNode(frame, b, newId);
  const pos = nodePositions(frame);
  if (na === nb || length(sub(pos.get(na)!, pos.get(nb)!)) < 1) return null;
  if (frame.members.some((m) => (m.a === na && m.b === nb) || (m.a === nb && m.b === na))) return null;
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

/** The material new bars get: the one most used in the frame. */
export function commonItem(frame: Frame): string | null {
  const count = new Map<string, number>();
  for (const m of frame.members) if (m.item_id) count.set(m.item_id, (count.get(m.item_id) ?? 0) + 1);
  let best: string | null = null;
  for (const [id, n] of count) if (best === null || n > count.get(best)!) best = id;
  return best;
}
