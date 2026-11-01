"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { ItemPicker } from "@/components/project/material-picker";
import { Page } from "@/components/shell/app-shell";
import { Button, IconButton } from "@/components/ui/button";
import { Field, LengthInput, NumberInput } from "@/components/ui/field";
import { Badge, Card, EmptyState, Ltr, PageTitle, Skeleton } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/overlay";
import { Segmented } from "@/components/ui/segmented";
import { api, unwrap, type InventoryEntry } from "@/lib/api/client";
import { qk, useCatalog, useInventory, useMe } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { fmtDims, type Units } from "@/lib/units";

export function InventoryPage() {
  const inv = useInventory();
  const me = useMe();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const t = useTranslations("pages.inventory");
  const tc = useTranslations("common");
  const unknown = t("unknownMaterial");
  const groups = new Map<string, InventoryEntry[]>();
  for (const e of inv.data ?? []) groups.set(e.item_name || unknown, [...(groups.get(e.item_name || unknown) ?? []), e]);

  const patch = async (e: InventoryEntry, body: { qty?: number }) => {
    await unwrap(api.PATCH("/api/workshop/inventory/{entry_id}", { params: { path: { entry_id: e.id } }, body }));
    void qc.invalidateQueries({ queryKey: qk.inventory });
  };
  const remove = async (e: InventoryEntry) => {
    await unwrap(api.DELETE("/api/workshop/inventory/{entry_id}", { params: { path: { entry_id: e.id } } }));
    void qc.invalidateQueries({ queryKey: qk.inventory });
  };

  return (
    <Page>
      <div className="flex flex-col gap-8">
        <PageTitle title={t("title")} subtitle={t("subtitle")}
          actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setAdding(true)}>{t("addStock")}</Button>} />
        {inv.isLoading ? <Skeleton className="h-64 rounded-[16px]" /> : !inv.data?.length ? (
          <Card><EmptyState title={t("emptyTitle")} text={t("emptyText")}
            action={<Button icon={<Plus size={16} />} onClick={() => setAdding(true)}>{t("addStock")}</Button>} /></Card>
        ) : [...groups.entries()].map(([name, list]) => (
          <section key={name} className="flex flex-col gap-2">
            <h2 className="text-[17px] font-semibold">{name}</h2>
            <Card className="divide-y divide-line">
              {list.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="tnum w-40 text-[15px] font-semibold"><Ltr>{fmtDims(e.length_mm, e.width_mm)} mm</Ltr></span>
                  <Badge tone={e.kind === "offcut" ? "accent" : "neutral"}>{e.kind === "offcut" ? t("offcut") : t("full")}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{e.source_project_name ? t("fromProject", { name: e.source_project_name }) : e.note}</span>
                  <NumberInput ariaLabel={t("quantity")} className="w-20" value={e.qty} min={1} onChange={(n) => n && patch(e, { qty: Math.round(n) })} />
                  <IconButton label={tc("remove")} size="sm" onClick={() => remove(e)}><Trash2 size={15} /></IconButton>
                </div>
              ))}
            </Card>
          </section>
        ))}
      </div>
      {adding ? <AddStock units={(me.data?.prefs.units ?? "mm") as Units} onClose={() => setAdding(false)} /> : null}
    </Page>
  );
}

function AddStock({ units, onClose }: { units: Units; onClose: () => void }) {
  const catalog = useCatalog({});
  const qc = useQueryClient();
  const [itemId, setItemId] = useState<string | null>(null);
  const [kind, setKind] = useState<"full" | "offcut">("offcut");
  const [length, setLength] = useState<number | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const t = useTranslations("pages.inventory");
  const tc = useTranslations("common");
  const item = catalog.data?.find((i) => i.id === itemId);

  const save = async () => {
    if (!itemId || !length) return;
    setBusy(true);
    try {
      await unwrap(api.POST("/api/workshop/inventory", { body: { item_id: itemId, kind, length_mm: length, width_mm: item?.kind === "sheet" ? width : null, qty, note: "" } }));
      void qc.invalidateQueries({ queryKey: qk.inventory });
      toast.info(t("added", { n: qty }));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("addError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={t("addTitle")}
      footer={<><Button variant="plain" onClick={onClose}>{tc("cancel")}</Button><Button variant="primary" loading={busy} disabled={!itemId || !length || (item?.kind === "sheet" && !width)} onClick={save}>{tc("add")}</Button></>}>
      <div className="flex flex-col gap-5">
        <Field label={t("material")}><ItemPicker items={catalog.data ?? []} value={itemId} kinds={["lumber", "sheet"]} ariaLabel={t("material")} onChange={(id) => setItemId(id)} /></Field>
        <Segmented label={t("kind")} value={kind} onChange={setKind} options={[{ value: "offcut", label: t("offcut") }, { value: "full", label: t("fullBoard") }]} />
        <div className="grid grid-cols-3 gap-4">
          <Field label={t("length")}><LengthInput ariaLabel={t("length")} units={units} value={length} onChange={setLength} /></Field>
          {item?.kind === "sheet" ? <Field label={t("width")}><LengthInput ariaLabel={t("width")} units={units} value={width} onChange={setWidth} allowEmpty /></Field> : <span />}
          <Field label={t("howMany")}><NumberInput ariaLabel={t("quantity")} value={qty} min={1} onChange={(n) => setQty(Math.max(1, Math.round(n ?? 1)))} /></Field>
        </div>
      </div>
    </Sheet>
  );
}
