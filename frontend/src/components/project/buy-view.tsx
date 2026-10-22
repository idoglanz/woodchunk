"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, Lightbulb, ShoppingBag } from "lucide-react";
import { useEffect, useState } from "react";
import { useProjectCtx } from "@/components/project/context";
import { useSetStatus } from "@/components/project/status-menu";
import { useTranslations } from "@/components/project/translations";
import { Button, Spinner } from "@/components/ui/button";
import { Callout, Card, EmptyState, Skeleton } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { api, download, type Shopping } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { useEditor } from "@/lib/editor";
import { money } from "@/lib/format";
import { dirOf, t, type Lang } from "@/lib/i18n";
import { qk, useShopping } from "@/lib/queries";
import { toast } from "@/lib/toast";

export function BuyView() {
  const { id, me, readOnly, plan } = useProjectCtx();
  const version = useEditor((s) => s.version);
  const project = useEditor((s) => s.project);
  const [lang, setLang] = useState<Lang>((me?.prefs.export_lang as Lang) ?? "en");
  const tr = useTranslations(id, version, lang);
  // Catalog items already have Hebrew names, so show the list at once; refetch when the
  // user's own names come back translated.
  const shop = useShopping(id, version, lang, true, tr.dataUpdatedAt);
  const qc = useQueryClient();
  const status = useSetStatus();
  const data = shop.data;

  const toggle = async (key: string, checked: boolean) => {
    const k = qk.shopping(id, version, lang, tr.dataUpdatedAt);
    qc.setQueryData<Shopping>(k, (old) => old && {
      ...old, checked: old.checked + (checked ? 1 : -1),
      groups: old.groups.map((g) => ({ ...g, lines: g.lines.map((l) => (l.key === key ? { ...l, checked } : l)) })),
    });
    const r = await api.PUT("/api/projects/{project_id}/shopping/checked", { params: { path: { project_id: id } }, body: { key, checked } });
    if (!r.response.ok) { toast.error("Couldn't save that tick."); void qc.invalidateQueries({ queryKey: ["shopping", id] }); }
  };

  const copy = async () => {
    if (!data) return;
    const lines = [`${project?.name} — ${t(lang, "shoppingList")}`, ""];
    for (const g of data.groups) {
      lines.push(`*${g.supplier_name}*`);
      for (const l of g.lines) lines.push(`${l.checked ? "✓" : "•"} ${l.name} — ${l.detail} × ${l.qty}${l.total != null ? ` (${money(l.total, data.currency)})` : ""}`);
      lines.push("");
    }
    lines.push(`${t(lang, "total")}: ${money(data.total, data.currency)}`);
    try { await navigator.clipboard.writeText(lines.join("\n")); toast.info("Copied. Paste it into WhatsApp or a note."); } catch { toast.error("Couldn't copy."); }
  };

  useEffect(() => {
    if (lang !== "en" && tr.isError) toast.error("Couldn't translate right now. Showing English names where needed.");
  }, [lang, tr.isError]);

  const pStatus = project?.status ?? "planning";
  const primary = pStatus === "planning"
    ? <Button variant="primary" icon={<ShoppingBag size={16} />} loading={status.pending} disabled={readOnly || !!plan?.unplaced.length} onClick={() => status.set("bought", "Marked as bought. Prices are locked in.")}>Mark as bought</Button>
    : pStatus === "bought"
      ? (data?.count ? <Button variant="primary" loading={status.pending} disabled={readOnly} onClick={() => status.set("bought", "Extra stock marked as bought.")}>Mark extra as bought</Button>
        : <Button variant="primary" loading={status.pending} disabled={readOnly} onClick={() => status.set("cut", "Marked as cut. Leftovers are in your workshop.")}>Mark as cut</Button>)
      : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Segmented label="List language" value={lang} onChange={setLang} options={[{ value: "en", label: "English" }, { value: "he", label: "עברית" }]} />
          {lang !== "en" && tr.isFetching ? <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-3"><Spinner className="h-3.5 w-3.5" />Translating your names…</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" icon={<Copy size={15} />} onClick={copy} disabled={!data?.count}>Copy as text</Button>
          <Button size="sm" variant="ghost" icon={<Download size={15} />} disabled={!data?.count}
            onClick={() => download(`/api/projects/${id}/export/shopping.csv?lang=${lang}`, `${project?.name ?? "project"} shopping list.csv`).catch((e) => toast.error(e.message))}>CSV</Button>
          {primary}
        </div>
      </div>

      {project?.purchase && pStatus !== "planning" ? (
        <Callout tone="info" icon={<Check size={18} />}>
          Bought on {new Date(project.purchase.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. {data?.count ? "The list below is only what your latest changes need on top of that." : "Everything is bought. Next: cut it and mark the project as cut."}
        </Callout>
      ) : null}

      {!data ? <Skeleton className="h-80 rounded-[16px]" /> : !data.count ? (
        <Card><EmptyState title={project?.purchase ? "Nothing more to buy" : "Nothing to buy yet"} text={project?.purchase ? "Your purchase covers every part." : "Add parts in Design and they show up here, grouped by store."} /></Card>
      ) : (
        <div dir={dirOf(lang)} lang={lang} className={cn("flex flex-col gap-4 transition-opacity", shop.isFetching && "opacity-60")}>
          <div className="flex flex-col gap-2">
            <div className="tnum flex justify-between text-[14px] text-ink-2">
              <span>{data.checked} / {data.count} {t(lang, "pickedUp")}</span>
              <span className="font-semibold text-ink">{t(lang, "total")} {money(data.total, data.currency)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${(data.checked / data.count) * 100}%` }} />
            </div>
          </div>
          {data.groups.map((g) => (
            <Card key={g.supplier_id ?? "other"} className="overflow-hidden">
              <div className="flex items-baseline justify-between gap-3 px-5 pb-2 pt-4">
                <h2 className="text-[17px] font-semibold">{g.supplier_name}</h2>
                <span className="tnum text-[14px] text-ink-2">{money(g.subtotal, data.currency)}</span>
              </div>
              <ul>
                {g.lines.map((l) => (
                  <li key={l.key} className="border-t border-line first:border-t-0">
                    <label className="flex min-h-[56px] cursor-pointer items-center gap-3.5 px-5 py-2.5">
                      <input type="checkbox" checked={l.checked} disabled={readOnly} onChange={(e) => toggle(l.key, e.target.checked)}
                        className="peer sr-only" />
                      <span aria-hidden="true" className={cn("flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent",
                        l.checked ? "border-ink bg-ink text-surface" : "border-line-strong")}>
                        {l.checked ? <Check size={13} strokeWidth={3} /> : null}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className={cn("text-[15px] leading-snug transition-colors", l.checked && "text-ink-3 line-through")}>{l.name}</span>
                        <span className="tnum text-[13px] text-ink-2">{l.detail}<span className="sm:hidden">{l.total == null ? "" : ` · ${money(l.total, data.currency)}`}</span></span>
                      </span>
                      <span className="tnum text-[17px] font-semibold">×{l.qty.toLocaleString()}</span>
                      <span className="tnum hidden w-24 text-end text-[14px] text-ink-2 sm:inline">{l.total == null ? "—" : money(l.total, data.currency)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
          {data.suggestions.map((s) => (
            <Callout key={s.item_id} tone="ok" icon={<Lightbulb size={18} />}>{s.text}</Callout>
          ))}
          <div className="no-print fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-line px-4 pt-3 backdrop-blur-xl sm:hidden"
            style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))", background: "color-mix(in srgb, var(--surface) 85%, transparent)" }}>
            <span className="tnum text-[13px] text-ink-2">{data.checked} / {data.count} {t(lang, "pickedUp")}</span>
            <span className="tnum text-[17px] font-semibold">{money(data.total, data.currency)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
