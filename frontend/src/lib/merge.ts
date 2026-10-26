/**
 * Three-way merge of JSON documents, for two people editing a project at once: start from the
 * version both began with (`base`), keep everything only one of them changed, and report a
 * conflict where both changed the same thing differently. Lists of objects with an `id` (assemblies,
 * parts, joints…), or else a unique `name` (a frame's sizes), merge item by item, so adding, removing
 * or editing different items combines.
 */

export type Conflict = { path: string[] };
export type MergeResult<T> = { value: T; conflicts: Conflict[] };

type Json = unknown;
type Item = Record<string, Json>;
type Key = "id" | "name";

const isObject = (v: Json): v is Item => typeof v === "object" && v !== null && !Array.isArray(v);

/** How a list's items are told apart: by `id`, else by a unique `name`; "" for an empty list (any key fits). */
function keyOf(v: Json): Key | "" | null {
  if (!Array.isArray(v)) return null;
  if (!v.length) return "";
  if (v.every((x) => isObject(x) && typeof x.id === "string")) return "id";
  const names = v.map((x) => (isObject(x) && typeof x.name === "string" ? x.name : null));
  return names.every((n) => n !== null) && new Set(names).size === names.length ? "name" : null;
}

/** The key shared by all three lists, if they're keyed lists at all. */
function listKey(base: Json, mine: Json, theirs: Json): Key | null {
  const keys = [keyOf(mine), keyOf(theirs), base === undefined ? "" : keyOf(base)];
  if (keys.includes(null)) return null;
  const set = new Set(keys.filter((k) => k !== ""));
  return set.size === 1 ? ([...set][0] as Key) : set.size === 0 ? "id" : null;
}

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
  const key = listKey(base, mine, theirs);
  if (key) return mergeList((base ?? []) as Item[], mine as Item[], theirs as Item[], key, path, out);
  out.push({ path });
  return theirs;
}

function mergeList(base: Item[], mine: Item[], theirs: Item[], key: Key, path: string[], out: Conflict[]): Item[] {
  const idOf = (x: Item) => x[key] as string;
  const byId = (xs: Item[]) => new Map(xs.map((x) => [idOf(x), x]));
  const b = byId(base), m = byId(mine), t = byId(theirs);
  const label = (x: Item) => (typeof x.name === "string" && x.name) || (typeof x.label === "string" && x.label) || "an item";
  const result = new Map<string, Item>();
  const keep = (id: string, x: Item | undefined) => { if (x) result.set(id, x); };

  for (const id of new Set([...t.keys(), ...m.keys(), ...b.keys()])) {
    const [bx, mx, tx] = [b.get(id), m.get(id), t.get(id)];
    const at = [...path, label(mx ?? tx ?? bx!)];
    if (mx && tx) keep(id, mergeAt(bx, mx, tx, at, out) as Item);
    else if (mx && !tx) {
      if (!bx) keep(id, mx); // I added it
      else if (!equal(bx, mx)) { out.push({ path: at }); keep(id, mx); } // they removed what I changed
    } else if (tx && !mx) {
      if (!bx) keep(id, tx); // they added it
      else if (!equal(bx, tx)) { out.push({ path: at }); keep(id, tx); } // I removed what they changed
    }
  }
  // Their order, unless only I reordered; my new items go after the item before them in my list.
  const sameOrder = (a: Item[], c: Item[]) => {
    const common = a.filter((x) => c.some((y) => idOf(y) === idOf(x))).map(idOf);
    const other = c.filter((x) => a.some((y) => idOf(y) === idOf(x))).map(idOf);
    return equal(common, other);
  };
  const order = sameOrder(base, theirs) && !sameOrder(base, mine) ? mine : theirs;
  const ids = order.map(idOf).filter((id) => result.has(id));
  for (const [i, x] of mine.entries()) {
    if (ids.includes(idOf(x)) || !result.has(idOf(x))) continue;
    const prev = mine.slice(0, i).reverse().find((y) => ids.includes(idOf(y)));
    ids.splice(prev ? ids.indexOf(idOf(prev)) + 1 : 0, 0, idOf(x));
  }
  for (const id of result.keys()) if (!ids.includes(id)) ids.push(id);
  return ids.map((id) => result.get(id)!);
}
