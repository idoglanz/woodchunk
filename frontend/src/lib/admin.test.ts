import { describe, expect, it } from "vitest";
import { bucket, filterPeople, minutes, niceMax, sortPeople, type Person } from "./admin";

function person(over: Partial<Person>): Person {
  return {
    id: "x", name: "", email: "x@test.dev", role: "user", created_at: "2026-10-01T00:00:00Z",
    last_seen: "2026-10-20T00:00:00Z", projects: 0, shared: 0, ai_calls_7d: 0, ai_calls_30d: 0,
    active_days_7d: 0, active_days_30d: 0, active_minutes_30d: 0, level: "light", ...over,
  };
}

const people = [
  person({ id: "a", name: "Dana Levi", email: "dana@shop.dev", projects: 3, level: "regular", active_days_30d: 4 }),
  person({ id: "b", name: "", email: "omer@test.dev", projects: 9, level: "high", active_days_30d: 12, last_seen: "2026-10-28T00:00:00Z" }),
  person({ id: "c", name: "Noa", email: "noa@test.dev", role: "admin", projects: 3, level: "regular", active_days_30d: 6 }),
];

describe("people search", () => {
  it("matches every word against name, email and role", () => {
    expect(filterPeople(people, "dana").map((p) => p.id)).toEqual(["a"]);
    expect(filterPeople(people, "TEST admin").map((p) => p.id)).toEqual(["c"]);
    expect(filterPeople(people, "  ")).toHaveLength(3);
  });
});

describe("people sort", () => {
  it("sorts by a column either way, ties by last seen", () => {
    expect(sortPeople(people, "projects", "desc").map((p) => p.id)).toEqual(["b", "a", "c"]);
    expect(sortPeople(people, "name", "asc").map((p) => p.id)).toEqual(["a", "c", "b"]);
    expect(sortPeople(people, "level", "desc").map((p) => p.id)).toEqual(["b", "c", "a"]);
    expect(sortPeople(people, "last_seen", "desc")[0].id).toBe("b");
  });
});

describe("bucketing days", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, n: i + 1 }));

  it("groups from the end so the last bucket is a full week", () => {
    const weeks = bucket(rows, 7, (r) => [r.n]);
    expect(weeks).toEqual([
      { from: "2026-10-01", to: "2026-10-03", values: [6] },
      { from: "2026-10-04", to: "2026-10-10", values: [49] },
    ]);
  });

  it("averages per day when asked", () => {
    expect(bucket(rows, 7, (r) => [r.n], "avg")[1].values).toEqual([7]);
    expect(bucket(rows, 1, (r) => [r.n])).toHaveLength(10);
  });
});

describe("formatting", () => {
  it("rounds axis maxima and minutes", () => {
    expect([0, 1, 3, 7, 12, 480].map(niceMax)).toEqual([1, 1, 5, 10, 20, 500]);
    expect([5, 60, 200].map(minutes)).toEqual(["5 min", "1 h", "3 h 20 min"]);
  });
});
