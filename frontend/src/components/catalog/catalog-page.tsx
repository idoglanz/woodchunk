"use client";

import { Plus, Search, Sparkles, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { ImportSheet } from "@/components/catalog/import-sheet";
import { ItemEditor } from "@/components/catalog/item-editor";
import { itemDetail } from "@/components/project/material-picker";
import { Page } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Badge, Card, EmptyState, PageTitle, Skeleton } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { api, unwrap, type CatalogImport, type CatalogItem } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { useCatalog, useItemStatus, useMe, useSuppliers } from "@/lib/queries";
import { toast } from "@/lib/toast";

type Kind = "all" | "lumber" | "sheet" | "hardware";

export function CatalogPage() {
  const me = useMe();
  const admin = me.data?.role === "admin";
  const [kind, setKind] = useState<Kind>("all");
  const [q, setQ] = useState("");
  const [supplier, setSupplier] = useState("");
  const [editing, setEditing] = useState<CatalogItem | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const dq = useDeferredValue(q);
  const items = useCatalog({ q: dq, kind: kind === "all" ? null : kind, supplier_id: supplier || null });
  const suggested = useCatalog({ status: "suggested" }, admin);
  const suppliers = useSuppliers();
  const status = useItemStatus();
  const router = useRouter();

  const organize = async () => {
    setOrganizing(true);
    try {
      const imp = await unwrap<CatalogImport>(api.POST("/api/ai/catalog/organize", { body: { item_ids: [] } }));
      router.push(`/catalog/imports/${imp.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't organize the catalog.");
    } finally {
      setOrganizing(false);
    }
  };

  const list = (items.data ?? []).filter((i) => i.status !== "suggested" || admin);

  return (
    <Page>
      <div className="flex flex-col gap-6">
        <PageTitle title="Catalog" subtitle="One shared list of the lumber, sheets and hardware you can buy, with current prices."
          actions={<>
            {admin ? <Button variant="ghost" icon={<Wand2 size={16} />} loading={organizing} onClick={organize}>Organize with AI</Button> : null}
            <Button variant={admin ? "secondary" : "ghost"} icon={<Plus size={16} />} onClick={() => setEditing("new")}>{admin ? "Add item" : "Suggest item"}</Button>
            <Button variant="primary" icon={<Sparkles size={16} />} onClick={() => setImporting(true)}>Import</Button>
          </>} />

        {admin && suggested.data?.length ? (
          <Card className="p-5">
            <h2 className="mb-1 text-[17px] font-semibold">Waiting for review</h2>
            <p className="mb-3 text-[14px] text-ink-2">People suggested these items. Approve them to make them available to everyone.</p>
            <div className="flex flex-col divide-y divide-line">
              {suggested.data.map((it) => (
                <div key={it.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 flex-col"><span>{it.name.en}</span><span className="tnum text-[13px] text-ink-2">{itemDetail(it)}</span></div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="plain" onClick={() => status.mutate({ id: it.id, status: "retired" })}>Decline</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(it)}>Edit</Button>
                    <Button size="sm" variant="primary" onClick={() => status.mutate({ id: it.id, status: "active" }, { onSuccess: () => toast.info("Added to the catalog") })}>Approve</Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: 44 100, birch, screws…" aria-label="Search catalog"
              className="h-10 w-full rounded-xl bg-surface ps-9 pe-3 text-[15px] shadow-[var(--shadow-card)] outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_2px_var(--accent)] dark:border dark:border-line" />
          </div>
          <Segmented label="Kind" value={kind} onChange={setKind} options={[
            { value: "all", label: "All" }, { value: "lumber", label: "Lumber" }, { value: "sheet", label: "Sheets" }, { value: "hardware", label: "Hardware" }]} />
          {suppliers.data && suppliers.data.length > 1 ? (
            <Select aria-label="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} className="w-auto bg-surface">
              <option value="">All suppliers</option>
              {suppliers.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          ) : null}
        </div>

        {items.isLoading ? <Skeleton className="h-96 rounded-[16px]" /> : !list.length ? (
          <Card><EmptyState title="No matches" text="Try fewer words, or import a supplier's price list." /></Card>
        ) : (
          <Card className={cn("overflow-hidden transition-opacity", items.isFetching && "opacity-70")}>
            <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1fr)_120px] gap-4 border-b border-line px-5 py-2.5 text-[12px] font-medium text-ink-3 md:grid">
              <span>Item</span><span>Stock</span><span>Supplier</span><span className="text-end">Price updated</span>
            </div>
            <ul className="divide-y divide-line">
              {list.map((it) => (
                <li key={it.id}>
                  <button type="button" onClick={() => setEditing(it)}
                    className="grid w-full grid-cols-1 gap-1 px-5 py-3 text-start transition-colors hover:bg-surface-2/60 md:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1fr)_120px] md:items-center md:gap-4">
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-2"><span className="truncate">{it.name.en}</span>{it.status === "suggested" ? <Badge tone="warn">Suggested</Badge> : null}</span>
                      {it.name.he ? <span dir="rtl" lang="he" className="max-w-full self-start truncate text-[13px] text-ink-2">{it.name.he}</span> : null}
                    </span>
                    <span className="tnum truncate text-[14px] text-ink-2">{itemDetail(it)}</span>
                    <span className="truncate text-[14px] text-ink-2">{it.supplier_name || "—"}</span>
                    <span className="text-[13px] text-ink-3 md:text-end">{it.price_updated_at ? relativeTime(it.price_updated_at) : "no price"}</span>
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
