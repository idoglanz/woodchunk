/**
 * Three-way merge of JSON documents, for two people editing a project at once: start from the
 * version both began with (`base`), keep everything only one of them changed, and report a
 * conflict where both changed the same thing differently. Lists of objects with an `id` (assemblies,
 * parts, joints…) merge item by item, so adding, removing or editing different items combines.
 */

export type Conflict = { path: string[] };
export type MergeResult<T> = { value: T; conflicts: Conflict[] };

type Json = unknown;
type WithId = { id: string; name?: string; label?: string };

const isObject = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);
const isIdList = (v: Json): v is WithId[] => Array.isArray(v) && v.every((x) => isObject(x) && typeof x.id === "string");

export function equal(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => equal(a[k], b[k]));
  }
  return false;
}

export function merge3<T>(base: T, mine: T, theirs: T): MergeResult<T> {
  const conflicts: Conflict[] = [];
  const value = mergeAt(base, mine, theirs, [], conflicts) as T;
  return { value, conflicts };
}

function mergeAt(base: Json, mine: Json, theirs: Json, path: string[], out: Conflict[]): Json {
  if (equal(mine, theirs)) return mine;
  if (equal(base, mine)) return theirs;
  if (equal(base, theirs)) return mine;
  if (isObject(mine) && isObject(theirs)) {
    const b = isObject(base) ? base : {};
    const res: Record<string, Json> = {};
    for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      const v = mergeAt(b[k], mine[k], theirs[k], [...path, k], out);
      if (v !== undefined) res[k] = v;
    }
    return res;
  }
  if (isIdList(mine) && isIdList(theirs) && (base === undefined || isIdList(base))) {
    return mergeList(base ?? [], mine, theirs, path, out);
  }
  out.push({ path });
  return theirs;
}

function mergeList(base: WithId[], mine: WithId[], theirs: WithId[], path: string[], out: Conflict[]): WithId[] {
  const byId = (xs: WithId[]) => new Map(xs.map((x) => [x.id, x]));
  const b = byId(base), m = byId(mine), t = byId(theirs);
  const label = (x: WithId) => x.name || x.label || "an item";
  const result = new Map<string, WithId>();
  const keep = (id: string, x: WithId | undefined) => { if (x) result.set(id, x); };

  for (const id of new Set([...t.keys(), ...m.keys(), ...b.keys()])) {
    const [bx, mx, tx] = [b.get(id), m.get(id), t.get(id)];
    const at = [...path, label(mx ?? tx ?? bx!)];
    if (mx && tx) keep(id, mergeAt(bx, mx, tx, at, out) as WithId);
    else if (mx && !tx) {
      if (!bx) keep(id, mx); // I added it
      else if (!equal(bx, mx)) { out.push({ path: at }); keep(id, mx); } // they removed what I changed
    } else if (tx && !mx) {
      if (!bx) keep(id, tx); // they added it
      else if (!equal(bx, tx)) { out.push({ path: at }); keep(id, tx); } // I removed what they changed
    }
  }
  // Their order, unless only I reordered; my new items go after the item before them in my list.
  const sameOrder = (a: WithId[], c: WithId[]) => {
    const common = a.filter((x) => c.some((y) => y.id === x.id)).map((x) => x.id);
    const other = c.filter((x) => a.some((y) => y.id === x.id)).map((x) => x.id);
    return equal(common, other);
  };
  const order = sameOrder(base, theirs) && !sameOrder(base, mine) ? mine : theirs;
  const ids = order.map((x) => x.id).filter((id) => result.has(id));
  for (const [i, x] of mine.entries()) {
    if (ids.includes(x.id) || !result.has(x.id)) continue;
    const prev = mine.slice(0, i).reverse().find((y) => ids.includes(y.id));
    ids.splice(prev ? ids.indexOf(prev.id) + 1 : 0, 0, x.id);
  }
  for (const id of result.keys()) if (!ids.includes(id)) ids.push(id);
  return ids.map((id) => result.get(id)!);
}
