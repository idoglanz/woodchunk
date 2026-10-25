/** Exports of a solved frame. STL is in millimetres, Z up, as most CAD and slicers expect. */

import { Group, Mesh } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type { MemberResult } from "./kernel";
import { memberGeometry } from "./mesh";

export function frameStl(members: MemberResult[]): Blob {
  const group = new Group();
  for (const m of members) group.add(new Mesh(memberGeometry(m)));
  const data = new STLExporter().parse(group, { binary: true });
  for (const child of group.children) (child as Mesh).geometry.dispose();
  return new Blob([data], { type: "model/stl" });
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
