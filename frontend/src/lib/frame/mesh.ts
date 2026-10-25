/**
 * Triangles for a solved member: its profile swept along the axis and cut by the two end planes.
 * Exact for straight members with planar cuts (no CSG): each profile vertex's line along the axis
 * is intersected with both planes; caps are the profile's triangulation projected onto the planes.
 */

import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from "three";
import { add, dot, scale, sub, type MemberResult, type Plane, type Vec } from "./kernel";

function onPlane(start: Vec, axis: Vec, p: Plane): Vec {
  const t = dot(sub(p.point, start), p.normal) / dot(axis, p.normal);
  return add(start, scale(axis, t));
}

export function memberGeometry(m: MemberResult): BufferGeometry {
  const [cu, cv] = m.anchor_uv;
  const loops = m.profile.loops();
  const toWorld = (p: [number, number]): Vec => add(m.a, add(scale(m.u, p[0] - cu), scale(m.v, p[1] - cv)));
  const ends = loops.map((loop) => loop.map((p) => {
    const start = toWorld(p);
    return [onPlane(start, m.x, m.planes[0]), onPlane(start, m.x, m.planes[1])] as const;
  }));

  const pos: number[] = [];
  const tri = (a: Vec, b: Vec, c: Vec) => pos.push(...a, ...b, ...c);

  // Sides: a quad per profile edge, on every loop (holes face inward because they wind the other way).
  for (const loop of ends) {
    for (let i = 0; i < loop.length; i++) {
      const [a0, b0] = loop[i], [a1, b1] = loop[(i + 1) % loop.length];
      tri(a0, a1, b1);
      tri(a0, b1, b0);
    }
  }

  // Caps: triangulate in profile space, then use the plane points.
  const contour = loops[0].map(([x, y]) => new Vector2(x, y));
  const holes = loops.slice(1).map((l) => l.map(([x, y]) => new Vector2(x, y)));
  const flat = ends.flat();
  for (const [i, j, k] of ShapeUtils.triangulateShape(contour, holes)) {
    tri(flat[k][0], flat[j][0], flat[i][0]);
    tri(flat[i][1], flat[j][1], flat[k][1]);
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
