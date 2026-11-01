"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { Page } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, Ltr, PageTitle, Skeleton } from "@/components/ui/misc";
import { api, unwrap } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import type { Translator } from "@/lib/lang";
import { useImport } from "@/lib/queries";
import { toast } from "@/lib/toast";

function detail(item: { kind: string; thickness_mm?: number | null; width_mm?: number | null; price_per_m?: number | null; lumber_stock: { length_mm: number }[]; sheet_stock: { length_mm: number; width_mm: number; price?: number | null }[]; price?: number | null; pack_size: number }, t: Translator<"catalog">) {
  if (item.kind === "lumber") return `${item.thickness_mm} × ${item.width_mm} mm · ${item.lumber_stock.map((s) => (s.length_mm / 1000).toFixed(1)).join("/") || t("noLengths")} m · ${item.price_per_m != null ? `₪${item.price_per_m}/m` : t("noPrice")}`;
  if (item.kind === "sheet") return `${item.thickness_mm} mm · ${item.sheet_stock.map((s) => `${s.width_mm}×${s.length_mm}${s.price != null ? ` ₪${s.price}` : ""}`).join(", ")}`;
  return `${item.price != null ? `₪${item.price}` : t("noPrice")}${item.pack_size > 1 ? ` / ${t("packOf", { n: item.pack_size })}` : ""}`;
}

export function ImportReview({ id }: { id: string }) {
  const imp = useImport(id);
  const [picked, setSel] = useState<Set<number> | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const router = useRouter();
  const t = useTranslations("catalog");

  if (!imp.data) return <Page><Skeleton className="h-96 rounded-[16px]" /></Page>;
  const d = imp.data;
  const sel = picked ?? new Set(d.items.map((x, i) => (x.selected ? i : -1)).filter((i) => i >= 0));
  const organize = d.kind === "organize";

  const apply = async () => {
    setBusy(true);
    try {
      const r = await unwrap<{ created: number; updated: number; suggested: boolean }>(api.POST("/api/ai/catalog/imports/{import_id}/apply", { params: { path: { import_id: id } }, body: { selected: [...sel] } }));
      void qc.invalidateQueries({ queryKey: ["catalog"] });
      toast.info(r.suggested ? t("sentForReview", { n: r.created }) : t("addedUpdated", { created: r.created, updated: r.updated }));
      router.push("/catalog");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("applyError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <div className="flex flex-col gap-6">
        <Link href="/catalog" className="inline-flex items-center gap-1 text-[14px] font-medium text-ink-2 hover:text-ink"><ArrowLeft size={15} className="rtl:-scale-x-100" />{t("title")}</Link>
        <PageTitle title={organize ? t("tidyTitle") : t("reviewImport")}
          subtitle={organize ? t("tidySubtitle") : `${d.source}${d.supplier_name ? ` · ${d.supplier_name}` : ""}`}
          actions={d.status === "review" && d.items.length ? <Button variant="primary" loading={busy} disabled={!sel.size} onClick={apply}>{organize ? t("applyChanges", { n: sel.size }) : t("addToCatalog", { n: sel.size })}</Button> : null} />
        {d.status !== "review" ? <Badge>{d.status === "applied" ? t("alreadyApplied") : t("discarded")}</Badge> : null}
        {!d.items.length ? <Card><EmptyState title={t("nothingFound")} text={d.note || t("noProducts")} /></Card> : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line">
              {d.items.map((x, i) => (
                <li key={i}>
                  <label className={cn("flex cursor-pointer items-start gap-3 px-5 py-3", x.action === "same" && "opacity-60")}>
                    <input type="checkbox" className="mt-1 h-[18px] w-[18px] accent-[var(--ink)]" checked={sel.has(i)} disabled={d.status !== "review"}
                      onChange={(e) => setSel(() => { const n = new Set(sel); if (e.target.checked) n.add(i); else n.delete(i); return n; })} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium"><bdi>{x.item.name.en}</bdi></span>
                        <Badge tone={x.action === "new" ? "ok" : x.action === "update" ? "warn" : "neutral"}>{x.action === "new" ? t("actionNew") : x.action === "update" ? t("actionUpdate") : t("actionSame")}</Badge>
                      </span>
                      {x.item.name.he ? <span dir="rtl" lang="he" className="self-start text-[13px] text-ink-2">{x.item.name.he}</span> : null}
                      {!organize ? <span className="tnum text-[13px] text-ink-2"><Ltr>{detail(x.item, t)}</Ltr></span> : null}
                      {x.changes.length ? <span className="text-[13px] text-warn">{x.changes.join(" · ")}</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </Page>
  );
}
