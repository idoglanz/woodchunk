"use client";

import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Select, TextInput } from "@/components/ui/field";
import { Badge, Card, EmptyState } from "@/components/ui/misc";
import { filterPeople, LEVELS, sortPeople, type Person, type SortDir, type SortKey } from "@/lib/admin";
import { cn } from "@/lib/cn";
import { plural, relativeTime } from "@/lib/format";

const COLUMNS: { key: SortKey; label: string; end?: boolean }[] = [
  { key: "name", label: "Person" },
  { key: "created_at", label: "Signed up" },
  { key: "last_seen", label: "Last seen" },
  { key: "projects", label: "Projects", end: true },
  { key: "ai_calls_30d", label: "AI calls 7 d / 30 d", end: true },
  { key: "level", label: "Activity" },
];

const SORTS: { value: string; label: string }[] = [
  { value: "last_seen:desc", label: "Last seen" },
  { value: "created_at:desc", label: "Newest signups" },
  { value: "level:desc", label: "Most active" },
  { value: "projects:desc", label: "Most projects" },
  { value: "ai_calls_30d:desc", label: "Most AI calls" },
  { value: "name:asc", label: "Name" },
];

function isNew(p: Person): boolean {
  return Date.now() - new Date(p.created_at).getTime() < 7 * 86_400_000;
}

export function LevelBadge({ p }: { p: Person }) {
  const l = LEVELS[p.level];
  return (
    <span title={l.hint} className="inline-flex items-center gap-1.5">
      <Badge tone={l.tone} className={p.level === "inactive" ? "text-ink-3" : undefined}>{l.label}</Badge>
      <span className="tnum text-[12px] text-ink-3">{p.active_days_7d}/7 d</span>
    </span>
  );
}

function Name({ p }: { p: Person }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex items-center gap-1.5 truncate font-medium">
        <span className="truncate">{p.name || p.email}</span>
        {p.role === "admin" ? <Badge tone="accent">Admin</Badge> : null}
        {isNew(p) ? <Badge tone="info">New</Badge> : null}
      </span>
      {p.name ? <span className="truncate text-[13px] text-ink-2">{p.email}</span> : null}
    </span>
  );
}

export function PeopleView({ people, onOpen }: { people: Person[]; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "last_seen", dir: "desc" });
  const shown = useMemo(() => sortPeople(filterPeople(people, query), sort.key, sort.dir), [people, query, sort]);
  const toggle = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : key === "name" && s.key !== key ? "asc" : "desc" }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <TextInput type="search" aria-label="Search people" placeholder="Search name or email" value={query}
            onChange={(e) => setQuery(e.target.value)} className="ps-9" />
        </div>
        <Select aria-label="Sort people" className="w-auto md:hidden" value={`${sort.key}:${sort.dir}`}
          onChange={(e) => { const [key, dir] = e.target.value.split(":"); setSort({ key: key as SortKey, dir: dir as SortDir }); }}>
          {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          {SORTS.some((o) => o.value === `${sort.key}:${sort.dir}`) ? null : <option value={`${sort.key}:${sort.dir}`}>Custom</option>}
        </Select>
        <span className="tnum ms-auto text-[13px] text-ink-2">{shown.length === people.length ? `${people.length} people` : `${shown.length} of ${people.length}`}</span>
      </div>

      {!shown.length ? <Card><EmptyState title="No one matches" text="Try part of a name or an email address." /></Card> : (
        <>
          {/* Phones: one tappable row per person. */}
          <Card className="divide-y divide-line md:hidden">
            {shown.map((p) => (
              <button key={p.id} type="button" onClick={() => onOpen(p.id)} className="flex w-full flex-col gap-1.5 px-4 py-3 text-start active:bg-surface-2">
                <Name p={p} />
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
                  <LevelBadge p={p} />
                  <span>seen {relativeTime(p.last_seen)}</span>
                  <span className="tnum">{plural(p.projects, "project")} · {plural(p.ai_calls_30d, "AI call")}</span>
                </span>
              </button>
            ))}
          </Card>

          {/* Wider screens: a sortable table. */}
          <Card className="hidden overflow-x-auto md:block">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-line text-[12px] text-ink-2">
                  {COLUMNS.map((c) => {
                    const active = sort.key === c.key;
                    return (
                      <th key={c.key} scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                        className={cn("px-4 py-2.5 font-medium first:ps-5 last:pe-5", c.end ? "text-end" : "text-start")}>
                        <button type="button" onClick={() => toggle(c.key)}
                          className={cn("inline-flex items-center gap-1 hover:text-ink", active && "text-ink")}>
                          {c.label}
                          {active ? (sort.dir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : null}
                        </button>
                      </th>
                    );
                  })}
                  <th className="px-4 py-2.5 text-start font-medium">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((p) => (
                  <tr key={p.id} onClick={() => onOpen(p.id)} className="cursor-pointer hover:bg-surface-2/60">
                    <td className="max-w-[280px] px-4 py-2.5 ps-5">
                      <button type="button" className="w-full min-w-0 text-start" onClick={(e) => { e.stopPropagation(); onOpen(p.id); }}
                        aria-label={`Open ${p.name || p.email}`}>
                        <Name p={p} />
                      </button>
                    </td>
                    <td className="tnum whitespace-nowrap px-4 text-ink-2">{new Date(p.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</td>
                    <td className="whitespace-nowrap px-4 text-ink-2">{relativeTime(p.last_seen)}</td>
                    <td className="tnum px-4 text-end">{p.projects}{p.shared ? <span className="text-ink-3"> +{p.shared}</span> : null}</td>
                    <td className="tnum whitespace-nowrap px-4 text-end">{p.ai_calls_7d} <span className="text-ink-3">/</span> {p.ai_calls_30d}</td>
                    <td className="whitespace-nowrap px-4"><LevelBadge p={p} /></td>
                    <td className="px-4 pe-5 capitalize text-ink-2">{p.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
