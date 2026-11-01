"use client";

import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { Select, TextInput } from "@/components/ui/field";
import { Badge, Card, EmptyState } from "@/components/ui/misc";
import { filterPeople, LEVELS, levelText, sortPeople, type Person, type SortDir, type SortKey } from "@/lib/admin";
import { cn } from "@/lib/cn";
import { useRelativeTime } from "@/lib/format";
import { dateLocale } from "@/lib/lang";

const COLUMNS = [
  { key: "name", label: "colPerson", end: false },
  { key: "created_at", label: "colSignedUp", end: false },
  { key: "last_seen", label: "colLastSeen", end: false },
  { key: "projects", label: "projects", end: true },
  { key: "ai_calls_30d", label: "colAiCalls", end: true },
  { key: "level", label: "colActivity", end: false },
] as const satisfies readonly { key: SortKey; label: string; end: boolean }[];

const SORTS = [
  { value: "last_seen:desc", label: "colLastSeen" },
  { value: "created_at:desc", label: "sortNewest" },
  { value: "level:desc", label: "sortMostActive" },
  { value: "projects:desc", label: "sortMostProjects" },
  { value: "ai_calls_30d:desc", label: "sortMostAi" },
  { value: "name:asc", label: "sortName" },
] as const satisfies readonly { value: string; label: string }[];

function isNew(p: Person): boolean {
  return Date.now() - new Date(p.created_at).getTime() < 7 * 86_400_000;
}

export function LevelBadge({ p }: { p: Person }) {
  const t = useTranslations("admin");
  const l = levelText(t, p.level);
  return (
    <span title={l.hint} className="inline-flex items-center gap-1.5">
      <Badge tone={LEVELS[p.level].tone} className={p.level === "inactive" ? "text-ink-3" : undefined}>{l.label}</Badge>
      <span className="tnum text-[12px] text-ink-3">{t("daysOf7", { n: p.active_days_7d })}</span>
    </span>
  );
}

function Name({ p }: { p: Person }) {
  const t = useTranslations("admin");
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex items-center gap-1.5 truncate font-medium">
        <span className="truncate">{p.name || p.email}</span>
        {p.role === "admin" ? <Badge tone="accent">{t("badgeAdmin")}</Badge> : null}
        {isNew(p) ? <Badge tone="info">{t("badgeNew")}</Badge> : null}
      </span>
      {p.name ? <span className="truncate text-[13px] text-ink-2"><bdi>{p.email}</bdi></span> : null}
    </span>
  );
}

export function PeopleView({ people, onOpen }: { people: Person[]; onOpen: (id: string) => void }) {
  const ago = useRelativeTime();
  const t = useTranslations("admin");
  const lang = useLocale();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "last_seen", dir: "desc" });
  const shown = useMemo(() => sortPeople(filterPeople(people, query), sort.key, sort.dir), [people, query, sort]);
  const toggle = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : key === "name" && s.key !== key ? "asc" : "desc" }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <TextInput type="search" aria-label={t("searchPeople")} placeholder={t("searchPlaceholder")} value={query}
            onChange={(e) => setQuery(e.target.value)} className="ps-9" />
        </div>
        <Select aria-label={t("sortPeople")} className="w-auto md:hidden" value={`${sort.key}:${sort.dir}`}
          onChange={(e) => { const [key, dir] = e.target.value.split(":"); setSort({ key: key as SortKey, dir: dir as SortDir }); }}>
          {SORTS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
          {SORTS.some((o) => o.value === `${sort.key}:${sort.dir}`) ? null : <option value={`${sort.key}:${sort.dir}`}>{t("sortCustom")}</option>}
        </Select>
        <span className="tnum ms-auto text-[13px] text-ink-2">{shown.length === people.length ? t("peopleCount", { n: people.length }) : t("nOfTotal", { n: shown.length, total: people.length })}</span>
      </div>

      {!shown.length ? <Card><EmptyState title={t("noMatch")} text={t("noMatchText")} /></Card> : (
        <>
          {/* Phones: one tappable row per person. */}
          <Card className="divide-y divide-line md:hidden">
            {shown.map((p) => (
              <button key={p.id} type="button" onClick={() => onOpen(p.id)} className="flex w-full flex-col gap-1.5 px-4 py-3 text-start active:bg-surface-2">
                <Name p={p} />
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
                  <LevelBadge p={p} />
                  <span>{t("seen", { ago: ago(p.last_seen) })}</span>
                  <span className="tnum">{t("projectsCount", { n: p.projects })} · {t("aiCallsCount", { n: p.ai_calls_30d })}</span>
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
                          {t(c.label)}
                          {active ? (sort.dir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : null}
                        </button>
                      </th>
                    );
                  })}
                  <th className="px-4 py-2.5 text-start font-medium">{t("colRole")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((p) => (
                  <tr key={p.id} onClick={() => onOpen(p.id)} className="cursor-pointer hover:bg-surface-2/60">
                    <td className="max-w-[280px] px-4 py-2.5 ps-5">
                      <button type="button" className="w-full min-w-0 text-start" onClick={(e) => { e.stopPropagation(); onOpen(p.id); }}
                        aria-label={t("openPerson", { name: p.name || p.email })}>
                        <Name p={p} />
                      </button>
                    </td>
                    <td className="tnum whitespace-nowrap px-4 text-ink-2">{new Date(p.created_at).toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short", year: "numeric" })}</td>
                    <td className="whitespace-nowrap px-4 text-ink-2">{ago(p.last_seen)}</td>
                    <td className="tnum px-4 text-end">{p.projects}{p.shared ? <span className="text-ink-3"> +{p.shared}</span> : null}</td>
                    <td className="tnum whitespace-nowrap px-4 text-end">{p.ai_calls_7d} <span className="text-ink-3">/</span> {p.ai_calls_30d}</td>
                    <td className="whitespace-nowrap px-4"><LevelBadge p={p} /></td>
                    <td className="px-4 pe-5 capitalize text-ink-2">{t(`role.${p.role}`)}</td>
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
