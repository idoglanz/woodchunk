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

/** Half-up rounding, identical to the backend's rnd(). */
export function rnd(x: number, digits = 1): number {
  const f = 10 ** digits;
  const v = Math.floor(x * f + 0.5) / f;
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
  constructor(readonly m: FrameMember, readonly a: Vec, readonly b: Vec, readonly x: Vec, readonly u: Vec, readonly v: Vec,
    readonly profile: Profile) {}
  offset(p: UV): Vec { return add(scale(this.u, p[0] - this.cu), scale(this.v, p[1] - this.cv)); }
  outer(): Vec[] { return this.profile.loops()[0].map((p) => this.offset(p)); }
  nodePos(end: number): Vec { return end === 0 ? this.a : this.b; }
  into(end: number): Vec { return end === 0 ? this.x : scale(this.x, -1); }
  length(): number { return length(sub(this.b, this.a)); }
  get label() { return this.m.name || this.m.id; }
}

export function memberAxes(a: Vec, b: Vec, rollDeg: number): [Vec, Vec, Vec] {
  const x = unit(sub(b, a));
  const ref: Vec = Math.abs(x[2]) > 0.999 ? [0, 1, 0] : [0, 0, 1];
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
  for (const n of frame.nodes) {
    try {
      pos.set(n.id, [evaluate(n.x, params), evaluate(n.y, params), evaluate(n.z, params)]);
    } catch (e) {
      warnings.push(`Node ${n.id}: ${e instanceof ExprError ? e.message : String(e)}`);
      pos.set(n.id, [0, 0, 0]);
    }
  }

  const ms: M[] = [];
  for (const m of frame.members) {
    const label = m.name || m.id;
    const a = pos.get(m.a), b = pos.get(m.b);
    if (!a || !b || m.a === m.b) { warnings.push(`Member ${label} needs two different nodes`); continue; }
    if (length(sub(b, a)) < 1) { warnings.push(`Member ${label} has no length`); continue; }
    const profile = profiles[m.item_id ?? ""] ?? FALLBACK_PROFILE;
    const [x, u, v] = memberAxes(a, b, m.roll_deg ?? 0);
    ms.push(new M(m, a, b, x, u, v, profile));
    if (!m.item_id || !(m.item_id in profiles)) warnings.push(`Member ${label} has no material`);
  }

  let centroid: Vec = [0, 0, 0];
  if (pos.size) {
    let used = new Set(ms.flatMap((mm) => [mm.m.a, mm.m.b]));
    if (!used.size) used = new Set(pos.keys());
    let sum: Vec = [0, 0, 0];
    for (const k of used) sum = add(sum, pos.get(k)!);
    centroid = scale(sum, 1 / used.size);
  }
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
    if (spans.length) {
      for (const [mm, e] of ends) buttInto(mm, e, node, spans);
      continue;
    }
    if (ends.length === 1) continue;
    const j = overrides.get(nodeId);
    const kind = j ? j.kind : defaults.corner;
    const through = pickThrough(ends, j?.through ?? null);
    const others = ends.filter((x) => x !== through);
    if (kind === "miter" && others.length === 2 && ends.length === 3) {
      const [[m1, e1], [m2, e2]] = others;
      miter(m1, e1, m2, e2, node);
      buttInto(through[0], through[1], node, [m1, m2]);
    } else if (kind === "miter" && ends.length === 2) {
      const [[m1, e1], [m2, e2]] = ends;
      miter(m1, e1, m2, e2, node);
    } else {
      const [tm, te] = through;
      const dT = tm.into(te);
      let reach = 0;
      for (const [mm, e] of others) {
        if (Math.abs(dot(mm.into(e), dT)) > 0.999) continue;
        buttInto(mm, e, node, [tm]);
        reach = Math.max(reach, Math.max(...mm.outer().map((q) => dot(q, scale(dT, -1)))));
      }
      tm.planes[te] = square(node, dT, reach);
    }
  }

  const results = ms.map((mm) => measure(mm, warnings));
  return { members: results, groups: group(results), warnings };
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

function buttInto(mm: M, e: number, node: Vec, targets: M[]) {
  const d = mm.into(e);
  let best: [Plane, number] | null = null;
  for (const t of targets) {
    const hit = facePlane(t, node, d);
    if (hit && (best === null || hit[1] > best[1])) best = hit;
  }
  mm.planes[e] = best ? best[0] : square(node, d);
}

function measure(mm: M, warnings: string[]): MemberResult {
  const planes: Plane[] = [];
  for (const e of [0, 1]) {
    let p = mm.planes[e] ?? square(mm.nodePos(e), mm.into(e));
    if (Math.abs(dot(p.normal, mm.x)) < MIN_PLANE_COS) {
      warnings.push(`Member ${mm.label}: a cut runs along the bar; using a square end`);
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
  if (sp <= 0) warnings.push(`Member ${mm.label} is used up by its joints`);

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
  return `${r.item_id}|${p.shape}:${p.w}x${p.h}x${p.t}|${r.lp}|${r.sp}|${best!.join(",")}`;
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
