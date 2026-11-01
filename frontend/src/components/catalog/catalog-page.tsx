"use client";

import { Plus, Search, Sparkles, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { useTranslations } from "use-intl";
import { ImportSheet } from "@/components/catalog/import-sheet";
import { ItemEditor } from "@/components/catalog/item-editor";
import { itemDetail } from "@/components/project/material-picker";
import { SectionGlyph } from "@/components/project/section-glyph";
import { Page } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Badge, Card, EmptyState, PageTitle, Skeleton } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { api, unwrap, type CatalogImport, type CatalogItem } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { useRelativeTime } from "@/lib/format";
import { useCatalog, useItemStatus, useMe, useSuppliers } from "@/lib/queries";
import { toast } from "@/lib/toast";

type Kind = "all" | "lumber" | "steel" | "sheet" | "hardware";

const isSteel = (it: CatalogItem) => it.kind === "lumber" && (it.material ?? "").toLowerCase().includes("steel");
const SHAPE_ORDER = ["rect_tube", "round_tube", "angle", "flat_bar", "round_bar", "channel"];
/** Wood, then steel (by shape, then size), then sheets and hardware. */
function group(it: CatalogItem): number[] {
  if (isSteel(it)) {
    const p = it.profile;
    const square = p?.shape === "rect_tube" && p.w === p.h ? 0 : 1;
    return [1, SHAPE_ORDER.indexOf(p?.shape ?? ""), p?.shape === "rect_tube" ? square : 0, p?.w ?? 0, p?.h ?? 0, p?.t ?? 0];
  }
  return [{ lumber: 0, sheet: 2, hardware: 3 }[it.kind]];
}

export function CatalogPage() {
  const ago = useRelativeTime();
  const me = useMe();
  const admin = me.data?.role === "admin";
  const [kind, setKind] = useState<Kind>("all");
  const [q, setQ] = useState("");
  const [supplier, setSupplier] = useState("");
  const [editing, setEditing] = useState<CatalogItem | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const dq = useDeferredValue(q);
  // Steel bars are lumber (bars sold by length) made of steel: their own tab.
  const items = useCatalog({ q: dq, kind: kind === "all" ? null : kind === "steel" ? "lumber" : kind, supplier_id: supplier || null });
  const suggested = useCatalog({ status: "suggested" }, admin);
  const suppliers = useSuppliers();
  const status = useItemStatus();
  const router = useRouter();
  const t = useTranslations("catalog");
  const tc = useTranslations("common");
  const tp = useTranslations("project");

  const organize = async () => {
    setOrganizing(true);
    try {
      const imp = await unwrap<CatalogImport>(api.POST("/api/ai/catalog/organize", { body: { item_ids: [] } }));
      router.push(`/catalog/imports/${imp.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("organizeError"));
    } finally {
      setOrganizing(false);
    }
  };

  const list = (items.data ?? [])
    .filter((i) => (i.status !== "suggested" || admin) && (kind === "steel" ? isSteel(i) : kind === "lumber" ? !isSteel(i) : true))
    .map((it, i) => ({ it, key: [...group(it), i] }))
    .sort((a, b) => { for (let k = 0; k < Math.max(a.key.length, b.key.length); k++) if ((a.key[k] ?? 0) !== (b.key[k] ?? 0)) return (a.key[k] ?? 0) - (b.key[k] ?? 0); return 0; })
    .map((x) => x.it);

  return (
    <Page>
      <div className="flex flex-col gap-6">
        <PageTitle title={t("title")} subtitle={t("subtitle")}
          actions={<>
            {admin ? <Button variant="ghost" icon={<Wand2 size={16} />} loading={organizing} onClick={organize}>{t("organizeAi")}</Button> : null}
            <Button variant={admin ? "secondary" : "ghost"} icon={<Plus size={16} />} onClick={() => setEditing("new")}>{admin ? t("addItem") : t("suggestItem")}</Button>
            <Button variant="primary" icon={<Sparkles size={16} />} onClick={() => setImporting(true)}>{t("import")}</Button>
          </>} />

        {admin && suggested.data?.length ? (
          <Card className="p-5">
            <h2 className="mb-1 text-[17px] font-semibold">{t("reviewTitle")}</h2>
            <p className="mb-3 text-[14px] text-ink-2">{t("reviewText")}</p>
            <div className="flex flex-col divide-y divide-line">
              {suggested.data.map((it) => (
                <div key={it.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 flex-col"><span><bdi>{it.name.en}</bdi></span><span className="tnum text-[13px] text-ink-2">{itemDetail(it, tp)}</span></div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="plain" onClick={() => status.mutate({ id: it.id, status: "retired" })}>{t("decline")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(it)}>{tc("edit")}</Button>
                    <Button size="sm" variant="primary" onClick={() => status.mutate({ id: it.id, status: "active" }, { onSuccess: () => toast.info(t("addedToast")) })}>{t("approve")}</Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchLabel")}
              className="ring-on-parent h-10 w-full rounded-xl bg-surface ps-10 pe-3 text-[15px] shadow-[var(--shadow-card)] outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_2px_var(--accent)] dark:border dark:border-line" />
          </div>
          <Segmented label={t("kind")} value={kind} onChange={setKind} options={[
            { value: "all", label: t("all") }, { value: "lumber", label: t("lumber") }, { value: "steel", label: t("steel") }, { value: "sheet", label: t("sheets") },
            { value: "hardware", label: t("hardware") }]} />
          {suppliers.data && suppliers.data.length > 1 ? (
            <Select aria-label={t("supplier")} value={supplier} onChange={(e) => setSupplier(e.target.value)} className="w-auto bg-surface">
              <option value="">{t("allSuppliers")}</option>
              {suppliers.data.map((s) => <option key={s.id} value={s.id}><bdi>{s.name}</bdi></option>)}
            </Select>
          ) : null}
        </div>

        {items.isLoading ? <Skeleton className="h-96 rounded-[16px]" /> : !list.length ? (
          <Card><EmptyState title={t("noMatches")} text={t("noMatchesText")} /></Card>
        ) : (
          <Card className={cn("overflow-hidden transition-opacity", items.isFetching && "opacity-70")}>
            <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1fr)_120px] gap-4 border-b border-line px-5 py-2.5 text-[12px] font-medium text-ink-3 md:grid">
              <span>{t("colItem")}</span><span>{t("colStock")}</span><span>{t("supplier")}</span><span className="text-end">{t("colPriceUpdated")}</span>
            </div>
            <ul className="divide-y divide-line">
              {list.map((it) => (
                <li key={it.id}>
                  <button type="button" onClick={() => setEditing(it)}
                    className="grid w-full grid-cols-1 gap-1 px-5 py-3 text-start transition-colors hover:bg-surface-2/60 md:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1fr)_120px] md:items-center md:gap-4">
                    <span className="flex min-w-0 items-center gap-3">
                      <SectionGlyph item={it} size={40} sheet="top" scaleMm={100} />
                      <span className="flex min-w-0 flex-col">
                        <span className="flex items-center gap-2"><span className="truncate"><bdi>{it.name.en}</bdi></span>{it.status === "suggested" ? <Badge tone="warn">{t("suggested")}</Badge> : null}</span>
                        {it.name.he ? <span dir="rtl" lang="he" className="max-w-full self-start truncate text-[13px] text-ink-2">{it.name.he}</span> : null}
                      </span>
                    </span>
                    <span className="tnum truncate text-[14px] text-ink-2">{itemDetail(it, tp)}</span>
                    <span className="truncate text-[14px] text-ink-2">{it.supplier_name || "—"}</span>
                    <span className="text-[13px] text-ink-3 md:text-end">{it.price_updated_at ? ago(it.price_updated_at) : t("noPrice")}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      {editing ? <ItemEditor item={editing === "new" ? null : editing} admin={admin} onClose={() => setEditing(null)} /> : null}
      <ImportSheet open={importing} onOpenChange={setImporting} />
    </Page>
  );
}
