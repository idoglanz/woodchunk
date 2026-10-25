/**
 * Frame geometry and cut list: the editor's live copy of backend/app/services/frame/kernel.py.
 *
 * Turns a drawn frame into straight members bounded by two end planes, then measures each one the
 * way a shop does: long point (LP), short point (SP), and per end the saw settings (miter = table
 * rotation, bevel = blade tilt, 0° = square). The server copy is the authority for plans and
 * exports; both run the golden fixtures in fixtures/frames/. Keep them in step: same formulas,
 * same order of operations, same rounding.
 *
 * Member frame: x = axis from node a to node b. The profile's "up" (v) is world Z projected off the
 * axis (world Y for vertical members); u = v × x. roll_deg turns (u, v) about x. A profile is
 * centred on its bounding box in (u, v); the anchor says which point of it sits on the line.
 */

import { ExprError, evaluate } from "./expr";
import type { Frame, FrameMember, ProfileSpec } from "./types";

export type Vec = [number, number, number];
type UV = [number, number];

const ON_LINE_MM = 0.5;
const AUTO_SIDE_MM = 1.0;
const MIN_PLANE_COS = 0.02;
const VERTICAL_Z = 0.7;
// A member this close to vertical takes its profile "up" from world Y (far from normal splays).
const UPRIGHT_Z = 0.866;
const STRAIGHT = 0.999; // two ends this opposed at a joint are one straight run
// The through bar grows to cover butting bars only when they meet it about square (an L corner).
const SQUARE_ON = 0.26;
const MAX_COORD = 100_000; // 100 m: anything further out is a typo, not a frame

// --- vectors -------------------------------------------------------------------------------------

export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec): number => Math.sqrt(dot(a, a));
export const unit = (a: Vec): Vec => {
  const n = length(a);
  return n < 1e-12 ? [0, 0, 0] : scale(a, 1 / n);
};

/** Half away from zero, identical to the backend's rnd() (symmetric, so mirror values round alike). */
export function rnd(x: number, digits = 1): number {
  const f = 10 ** digits;
  let v = Math.floor(Math.abs(x) * f + 0.5) / f;
  if (x < 0) v = -v;
  return v === 0 ? 0 : v;
}

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

// --- profiles ------------------------------------------------------------------------------------

const CIRCLE_SEGMENTS = 24;

export class Profile {
  constructor(readonly shape: string, readonly w: number, readonly h: number, readonly t = 0) {}

  static from(spec: ProfileSpec): Profile {
    return new Profile(spec.shape, spec.w, spec.h, spec.t ?? 0);
  }

  /** Outer loop counter-clockwise, then holes clockwise. */
  loops(): UV[][] {
    const w2 = this.w / 2, h2 = this.h / 2, t = this.t;
    if (this.shape === "round_tube" || this.shape === "round_bar") {
      const outer = circle(w2);
      if (this.shape === "round_tube" && t > 0 && t < w2) return [outer, circle(w2 - t).reverse()];
      return [outer];
    }
    if (this.shape === "angle") {
      return [[[-w2, -h2], [w2, -h2], [w2, -h2 + t], [-w2 + t, -h2 + t], [-w2 + t, h2], [-w2, h2]]];
    }
    if (this.shape === "channel") {
      return [[[-w2, -h2], [w2, -h2], [w2, h2], [w2 - t, h2], [w2 - t, -h2 + t], [-w2 + t, -h2 + t], [-w2 + t, h2], [-w2, h2]]];
    }
    const outer = rect(w2, h2);
    if (this.shape === "rect_tube" && t > 0 && t < Math.min(w2, h2)) return [outer, rect(w2 - t, h2 - t).reverse()];
    return [outer];
  }

  symmetry(): "square" | "rect" | "mirror_u" | "none" {
    if (["rect", "flat_bar", "rect_tube", "round_tube", "round_bar"].includes(this.shape)) {
      return Math.abs(this.w - this.h) < 1e-6 ? "square" : "rect";
    }
    return this.shape === "channel" ? "mirror_u" : "none";
  }
}

const rect = (w2: number, h2: number): UV[] => [[-w2, -h2], [w2, -h2], [w2, h2], [-w2, h2]];
const circle = (r: number): UV[] => Array.from({ length: CIRCLE_SEGMENTS }, (_, k) =>
  [r * Math.cos((2 * Math.PI * k) / CIRCLE_SEGMENTS), r * Math.sin((2 * Math.PI * k) / CIRCLE_SEGMENTS)] as UV);

export const FALLBACK_PROFILE = new Profile("rect", 30, 30);

// --- results -------------------------------------------------------------------------------------

export type Plane = { point: Vec; normal: Vec };
export type EndCut = { miter: number; bevel: number; normal: Vec };
export type FaceUp = "top" | "side";

export type MemberResult = {
  id: string;
  item_id: string | null;
  a: Vec; b: Vec;
  x: Vec; u: Vec; v: Vec;
  anchor_uv: UV;
  profile: Profile;
  planes: [Plane, Plane];
  lp: number; sp: number;
  ends: [EndCut, EndCut];
  face_up: FaceUp;
  key: string;
};

export type CutGroup = {
  key: string; item_id: string | null; qty: number; lp: number; sp: number;
  ends: [EndCut, EndCut]; face_up: FaceUp; members: string[];
};

export type FrameResult = { members: MemberResult[]; groups: CutGroup[]; warnings: string[] };

// --- solving -------------------------------------------------------------------------------------

class M {
  cu = 0;
  cv = 0;
  planes: [Plane | null, Plane | null] = [null, null];
  constructor(readonly label: string, readonly m: FrameMember, readonly a: Vec, readonly b: Vec, readonly x: Vec, readonly u: Vec, readonly v: Vec,
    readonly profile: Profile) {}
  offset(p: UV): Vec { return add(scale(this.u, p[0] - this.cu), scale(this.v, p[1] - this.cv)); }
  outer(): Vec[] { return this.profile.loops()[0].map((p) => this.offset(p)); }
  nodePos(end: number): Vec { return end === 0 ? this.a : this.b; }
  into(end: number): Vec { return end === 0 ? this.x : scale(this.x, -1); }
  length(): number { return length(sub(this.b, this.a)); }
}

export function memberAxes(a: Vec, b: Vec, rollDeg: number): [Vec, Vec, Vec] {
  const x = unit(sub(b, a));
  const ref: Vec = Math.abs(x[2]) > UPRIGHT_Z ? [0, 1, 0] : [0, 0, 1];
  let v = unit(sub(ref, scale(x, dot(ref, x))));
  let u = cross(v, x);
  if (rollDeg) {
    const c = Math.cos(rad(rollDeg)), s = Math.sin(rad(rollDeg));
    [u, v] = [add(scale(u, c), scale(v, s)), add(scale(u, -s), scale(v, c))];
  }
  return [x, u, v];
}

const ANCHORS: Record<string, UV> = {
  c: [0, 0], t: [0, 1], b: [0, -1], l: [-1, 0], r: [1, 0], tl: [-1, 1], tr: [1, 1], bl: [-1, -1], br: [1, -1],
};

function placeAnchor(mm: M, centroid: Vec, outside: boolean) {
  const w2 = mm.profile.w / 2, h2 = mm.profile.h / 2;
  const anchor = mm.m.anchor ?? "auto";
  if (anchor !== "auto") {
    const [ku, kv] = ANCHORS[anchor];
    mm.cu = ku * w2;
    mm.cv = kv * h2;
    return;
  }
  if (!outside) return;
  const mid = scale(add(mm.a, mm.b), 0.5);
  const toward = sub(centroid, mid);
  const su = dot(toward, mm.u), sv = dot(toward, mm.v);
  mm.cu = su > AUTO_SIDE_MM ? -w2 : su < -AUTO_SIDE_MM ? w2 : 0;
  mm.cv = sv > AUTO_SIDE_MM ? -h2 : sv < -AUTO_SIDE_MM ? h2 : 0;
}

function facePlane(target: M, node: Vec, d: Vec): [Plane, number] | null {
  const w2 = target.profile.w / 2, h2 = target.profile.h / 2;
  const faces: [Vec, number][] = [
    [target.u, w2 - target.cu], [scale(target.u, -1), w2 + target.cu],
    [target.v, h2 - target.cv], [scale(target.v, -1), h2 + target.cv],
  ];
  let best = faces[0];
  for (const f of faces.slice(1)) if (dot(f[0], d) > dot(best[0], d) + 1e-9) best = f;
  const [f, dist] = best;
  const fd = dot(f, d);
  if (fd < 0.05) return null;
  const onLine = add(target.a, scale(target.x, dot(sub(node, target.a), target.x)));
  const point = add(onLine, scale(f, dist));
  const t = dot(sub(point, node), f) / fd;
  return [{ point, normal: scale(f, -1) }, t];
}

const square = (node: Vec, d: Vec, shift = 0): Plane => ({ point: add(node, scale(d, -shift)), normal: scale(d, -1) });

export function solve(frame: Frame, profiles: Record<string, Profile>): FrameResult {
  const warnings: string[] = [];
  const params = Object.fromEntries((frame.params ?? []).map((p) => [p.name, p.mm]));
  const defaults = { corner: "butt", lines: "outside", ...frame.defaults };
  const pos = new Map<string, Vec>();
  const bad = new Set<string>();
  for (const n of frame.nodes) {
    try {
      const p: Vec = [evaluate(n.x, params), evaluate(n.y, params), evaluate(n.z, params)];
      if (p.some((c) => Math.abs(c) > MAX_COORD)) throw new ExprError("it's more than 100 m from the origin");
      pos.set(n.id, p);
    } catch (e) {
      warnings.push(`A joint's position can't be worked out: ${e instanceof ExprError ? e.message : String(e)}`);
      bad.add(n.id);
    }
  }

  const ms: M[] = [];
  frame.members.forEach((m, i) => {
    const label = m.name || `Bar ${i + 1}`;
    if (bad.has(m.a) || bad.has(m.b)) { warnings.push(`${label} is left out: one of its joints has a bad position`); return; }
    const a = pos.get(m.a), b = pos.get(m.b);
    if (!a || !b || m.a === m.b) { warnings.push(`${label} needs two different joints`); return; }
    if (length(sub(b, a)) < 1) { warnings.push(`${label} has no length`); return; }
    const profile = profiles[m.item_id ?? ""] ?? FALLBACK_PROFILE;
    const [x, u, v] = memberAxes(a, b, m.roll_deg ?? 0);
    ms.push(new M(label, m, a, b, x, u, v, profile));
    if (!m.item_id || !(m.item_id in profiles)) warnings.push(`${label} has no material`);
  });

  // Sum in a fixed order so the result is identical to the server's.
  const used = [...new Set(ms.flatMap((mm) => [mm.m.a, mm.m.b]))].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));
  let centroid: Vec = [0, 0, 0];
  for (const k of used) centroid = add(centroid, pos.get(k)!);
  if (used.length) centroid = scale(centroid, 1 / used.length);
  for (const mm of ms) placeAnchor(mm, centroid, defaults.lines === "outside");

  const endsAt = new Map<string, [M, number][]>();
  const spansAt = new Map<string, M[]>();
  for (const mm of ms) {
    endsAt.set(mm.m.a, [...(endsAt.get(mm.m.a) ?? []), [mm, 0]]);
    endsAt.set(mm.m.b, [...(endsAt.get(mm.m.b) ?? []), [mm, 1]]);
  }
  for (const [nodeId, p] of pos) {
    for (const mm of ms) {
      if (nodeId === mm.m.a || nodeId === mm.m.b) continue;
      const t = dot(sub(p, mm.a), mm.x);
      if (t > 1e-6 && t < mm.length() - 1e-6 && length(sub(add(mm.a, scale(mm.x, t)), p)) <= ON_LINE_MM) {
        spansAt.set(nodeId, [...(spansAt.get(nodeId) ?? []), mm]);
      }
    }
  }

  const overrides = new Map((frame.joints ?? []).map((j) => [j.node, j]));
  for (const [nodeId, ends] of endsAt) {
    const node = pos.get(nodeId)!;
    const spans = spansAt.get(nodeId) ?? [];
    const j = overrides.get(nodeId);
    if (spans.length) {
      for (const [mm, e] of ends) buttInto(mm, e, node, spans, warnings);
      if (j) warnings.push("A joint setting on a bar's span (a T-joint) is ignored: bars there always butt");
      continue;
    }
    if (ends.length === 1) continue;
    // A straight run split at a joint continues: both halves end square, the rest butt into it.
    const run = straightPair(ends);
    if (run) {
      for (const [mm, e] of run) mm.planes[e] = square(node, mm.into(e));
      for (const x of ends) if (!run.includes(x)) buttInto(x[0], x[1], node, [run[0][0], run[1][0]], warnings);
      continue;
    }
    const kind = j ? j.kind : defaults.corner;
    const through = pickThrough(ends, j?.through ?? null);
    if (j?.through && through[0].m.id !== j.through) warnings.push("A joint's 'runs through' bar isn't at that joint; using the automatic choice");
    const others = ends.filter((x) => x !== through);
    if (kind === "miter" && others.length === 2 && ends.length === 3) {
      const [[m1, e1], [m2, e2]] = others;
      miter(m1, e1, m2, e2, node);
      buttInto(through[0], through[1], node, [m1, m2], warnings);
    } else if (kind === "miter" && ends.length === 2) {
      const [[m1, e1], [m2, e2]] = ends;
      miter(m1, e1, m2, e2, node);
    } else {
      if (kind === "miter") warnings.push(`Miters join 2 or 3 bars; ${ends.length} meet at one joint, so they butt`);
      const [tm, te] = through;
      const dT = tm.into(te);
      let reach = 0;
      for (const [mm, e] of others) {
        if (dot(mm.into(e), dT) > STRAIGHT) { warnings.push(`${mm.label} and ${tm.label} overlap along the same line`); continue; }
        buttInto(mm, e, node, [tm], warnings);
        if (Math.abs(dot(mm.into(e), dT)) < SQUARE_ON) reach = Math.max(reach, Math.max(...mm.outer().map((q) => dot(q, scale(dT, -1)))));
      }
      tm.planes[te] = square(node, dT, reach);
    }
  }

  const results = ms.map((mm) => measure(mm, warnings));
  return { members: results, groups: group(results), warnings: [...new Set(warnings)] };
}

function straightPair(ends: [M, number][]): [M, number][] | null {
  for (let i = 0; i < ends.length; i++) {
    for (let k = i + 1; k < ends.length; k++) {
      if (dot(ends[i][0].into(ends[i][1]), ends[k][0].into(ends[k][1])) < -STRAIGHT) return [ends[i], ends[k]];
    }
  }
  return null;
}

function pickThrough(ends: [M, number][], override: string | null): [M, number] {
  if (override) {
    const hit = ends.find((x) => x[0].m.id === override);
    if (hit) return hit;
  }
  let steep = ends[0];
  for (const x of ends) if (Math.abs(x[0].x[2]) > Math.abs(steep[0].x[2])) steep = x;
  if (Math.abs(steep[0].x[2]) > VERTICAL_Z) return steep;
  let longest = ends[0];
  for (const x of ends) if (x[0].length() > longest[0].length()) longest = x;
  return longest;
}

function miter(m1: M, e1: number, m2: M, e2: number, node: Vec) {
  const d1 = m1.into(e1), d2 = m2.into(e2);
  if (length(sub(d2, d1)) < 1e-9) {
    m1.planes[e1] = square(node, d1);
    m2.planes[e2] = square(node, d2);
    return;
  }
  const n = unit(sub(d2, d1));
  m1.planes[e1] = { point: node, normal: n };
  m2.planes[e2] = { point: node, normal: scale(n, -1) };
}

function buttInto(mm: M, e: number, node: Vec, targets: M[], warnings: string[]) {
  const d = mm.into(e);
  let best: [Plane, number] | null = null;
  for (const t of targets) {
    const hit = facePlane(t, node, d);
    if (hit && (best === null || hit[1] > best[1])) best = hit;
  }
  if (!best) warnings.push(`${mm.label} meets ${targets[0].label} at a very shallow angle; its end is left square`);
  mm.planes[e] = best ? best[0] : square(node, d);
}

function measure(mm: M, warnings: string[]): MemberResult {
  const planes: Plane[] = [];
  for (const e of [0, 1]) {
    let p = mm.planes[e] ?? square(mm.nodePos(e), mm.into(e));
    if (Math.abs(dot(p.normal, mm.x)) < MIN_PLANE_COS) {
      warnings.push(`${mm.label}: a cut would run along the bar; its end is left square`);
      p = square(mm.nodePos(e), mm.into(e));
    }
    planes.push(p);
  }
  const lengths = mm.outer().map((q) => {
    const start = add(mm.a, q);
    const ta = dot(sub(planes[0].point, start), planes[0].normal) / dot(mm.x, planes[0].normal);
    const tb = dot(sub(planes[1].point, start), planes[1].normal) / dot(mm.x, planes[1].normal);
    return tb - ta;
  });
  const lp = Math.max(...lengths), sp = Math.min(...lengths);
  if (sp <= 0) warnings.push(`${mm.label} is used up by its joints (too short for the bars around it)`);

  const local = planes.map((p) => [dot(p.normal, mm.x), dot(p.normal, mm.u), dot(p.normal, mm.v)] as Vec);
  const top = Math.max(...local.map((n) => bevelOf(n[2])));
  const side = Math.max(...local.map((n) => bevelOf(n[1])));
  const faceUp: FaceUp = side < top - 0.05 ? "side" : "top";
  const ends = local.map((n) => endCut(n, faceUp)) as [EndCut, EndCut];
  return {
    id: mm.m.id, item_id: mm.m.item_id ?? null, a: mm.a, b: mm.b, x: mm.x, u: mm.u, v: mm.v, anchor_uv: [mm.cu, mm.cv],
    profile: mm.profile, planes: [planes[0], planes[1]], lp: rnd(lp), sp: rnd(sp), ends, face_up: faceUp, key: "",
  };
}

const bevelOf = (component: number) => deg(Math.asin(Math.min(1, Math.abs(component))));

function endCut(n: Vec, faceUp: FaceUp): EndCut {
  const [nx, nu, nv] = n;
  const [across, tilt] = faceUp === "top" ? [nu, nv] : [nv, nu];
  const miterDeg = deg(Math.atan2(Math.abs(across), Math.abs(nx)));
  return { miter: rnd(miterDeg), bevel: rnd(bevelOf(tilt)), normal: [rnd(nx, 3), rnd(nu, 3), rnd(nv, 3)] };
}

// --- grouping identical pieces -------------------------------------------------------------------

type Turn = [flip: boolean, su: number, sv: number, swap: boolean];

function turns(symmetry: string): Turn[] {
  const out: Turn[] = [[false, 1, 1, false]];
  if (symmetry === "rect" || symmetry === "square") out.push([false, -1, -1, false], [true, -1, 1, false], [true, 1, -1, false]);
  else if (symmetry === "mirror_u") out.push([true, -1, 1, false]);
  if (symmetry === "square") out.push([false, -1, 1, true], [false, 1, -1, true], [true, 1, 1, true], [true, -1, -1, true]);
  return out;
}

function compareTuples(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/** Shortest fixed form of a number, identical to the backend's num() (keys and ids depend on it). */
export function num(x: number): string {
  const s = rnd(x, 3).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" || s === "" ? "0" : s;
}

/** 16 hex chars from two FNV-1a passes; matches the backend's stable_id(). */
export function stableId(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
    return h.toString(16).padStart(8, "0");
  };
  return fnv(0x811c9dc5) + fnv(0x01234567);
}

function keyOf(r: MemberResult): string {
  let best: number[] | null = null;
  for (const [flip, su, sv, swap] of turns(r.profile.symmetry())) {
    let ns = r.ends.map((e) => e.normal);
    if (flip) ns = [...ns].reverse();
    const cand = ns.flatMap(([nx, nu0, nv0]) => {
      const [nu, nv] = swap ? [nv0, nu0] : [nu0, nv0];
      return [rnd(flip ? -nx : nx, 3), rnd(nu * su, 3), rnd(nv * sv, 3)];
    });
    if (best === null || compareTuples(cand, best) < 0) best = cand;
  }
  const p = r.profile;
  return `${r.item_id ?? ""}|${p.shape}:${num(p.w)}x${num(p.h)}x${num(p.t)}|${num(r.lp)}|${num(r.sp)}|${best!.map(num).join(",")}`;
}

function group(results: MemberResult[]): CutGroup[] {
  const groups = new Map<string, CutGroup>();
  for (const r of results) {
    r.key = keyOf(r);
    const g = groups.get(r.key);
    if (g) { g.qty += 1; g.members.push(r.id); }
    else groups.set(r.key, { key: r.key, item_id: r.item_id, qty: 1, lp: r.lp, sp: r.sp, ends: r.ends, face_up: r.face_up, members: [r.id] });
  }
  // Codepoint order, like Python's sort, so both sides list groups the same way.
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return [...groups.values()].sort((a, b) => cmp(a.item_id ?? "", b.item_id ?? "") || b.lp - a.lp || b.sp - a.sp || cmp(a.key, b.key));
}
