"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Field, NumberInput, Select, Switch, TextInput } from "@/components/ui/field";
import { Sheet } from "@/components/ui/overlay";
import { Segmented } from "@/components/ui/segmented";
import type { CatalogItem, CatalogItemIn } from "@/lib/api/client";
import { money, relativeTime } from "@/lib/format";
import { useItemStatus, useSaveItem, useSuppliers } from "@/lib/queries";
import { toast } from "@/lib/toast";

function blank(): CatalogItemIn {
  return {
    kind: "lumber", supplier_id: null, name: { en: "", he: "" }, sku: "", url: "", image: "", category: "", tags: [],
    material: "", treatment: "", thickness_mm: null, width_mm: null, price_per_m: null, lumber_stock: [], sheet_stock: [],
    has_grain: true, unit: "each", pack_size: 1, price: null,
  };
}

export function ItemEditor({ item, admin, onClose }: { item: CatalogItem | null; admin: boolean; onClose: () => void }) {
  const [v, setV] = useState<CatalogItemIn>(() => (item ? { ...blank(), ...item } : blank()));
  const suppliers = useSuppliers();
  const save = useSaveItem();
  const status = useItemStatus();
  const readOnly = !!item && !admin;
  const set = (patch: Partial<CatalogItemIn>) => setV((x) => ({ ...x, ...patch }));

  const submit = () => {
    if (!v.name.en.trim()) return toast.error("Give the item a name.");
    if (v.kind === "lumber" && (!v.thickness_mm || !v.width_mm)) return toast.error("Lumber needs a thickness and width.");
    save.mutate({ id: item?.id, body: v }, {
      onSuccess: () => { toast.info(item ? "Saved" : admin ? "Added to the catalog" : "Thanks! An admin will review it."); onClose(); },
    });
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={item ? (readOnly ? item.name.en : "Edit item") : admin ? "Add item" : "Suggest an item"} wide
      description={item?.price_updated_at ? `Price updated ${relativeTime(item.price_updated_at)}` : undefined}
      footer={readOnly ? <Button onClick={onClose}>Close</Button> : <>
        {item && admin ? <Button variant="destructive" className="me-auto" onClick={() => status.mutate({ id: item.id, status: "retired" }, { onSuccess: () => { toast.info("Removed from the catalog"); onClose(); } })}>Remove</Button> : null}
        <Button variant="plain" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} onClick={submit}>{item ? "Save" : admin ? "Add" : "Suggest"}</Button>
      </>}>
      <fieldset disabled={readOnly} className="flex flex-col gap-5">
        {!item ? <Segmented label="Kind" value={v.kind} onChange={(k) => set({ kind: k })} options={[{ value: "lumber", label: "Lumber" }, { value: "sheet", label: "Sheet" }, { value: "hardware", label: "Hardware" }]} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name (English)" htmlFor="en"><TextInput id="en" value={v.name.en} onChange={(e) => set({ name: { ...v.name, en: e.target.value } })} placeholder={v.kind === "lumber" ? "44 × 100 pine, treated" : v.kind === "sheet" ? "18 mm birch plywood" : "Wood screw 5×50 mm"} /></Field>
          <Field label="Name (Hebrew)" htmlFor="he"><TextInput id="he" dir="rtl" value={v.name.he} onChange={(e) => set({ name: { ...v.name, he: e.target.value } })} /></Field>
          <Field label="Supplier" htmlFor="sup">
            <Select id="sup" value={v.supplier_id ?? ""} onChange={(e) => set({ supplier_id: e.target.value || null })}>
              <option value="">None</option>
              {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Material" htmlFor="mat"><TextInput id="mat" value={v.material} onChange={(e) => set({ material: e.target.value.toLowerCase() })} placeholder="pine" /></Field>
        </div>

        {v.kind === "lumber" ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Thickness" htmlFor="t"><NumberInput id="t" ariaLabel="Thickness" value={v.thickness_mm} suffix="mm" decimals={1} onChange={(n) => set({ thickness_mm: n })} /></Field>
              <Field label="Width" htmlFor="w"><NumberInput id="w" ariaLabel="Width" value={v.width_mm} suffix="mm" decimals={1} onChange={(n) => set({ width_mm: n })} /></Field>
              <Field label="Price per metre" htmlFor="ppm"><NumberInput id="ppm" ariaLabel="Price per metre" value={v.price_per_m} suffix="₪" decimals={2} onChange={(n) => set({ price_per_m: n })} /></Field>
              <Field label="Treatment" htmlFor="tr"><TextInput id="tr" value={v.treatment} onChange={(e) => set({ treatment: e.target.value.toLowerCase() })} placeholder="treated" /></Field>
            </div>
            <Field label="Stock lengths" hint="Leave a price empty to use the price per metre.">
              <div className="flex flex-col gap-2">
                {v.lumber_stock.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <NumberInput ariaLabel="Length" className="w-32" value={s.length_mm} suffix="mm" onChange={(n) => set({ lumber_stock: v.lumber_stock.map((x, j) => (j === i ? { ...x, length_mm: n ?? 0 } : x)) })} />
                    <NumberInput ariaLabel="Price" className="w-32" value={s.price} suffix="₪" decimals={2} onChange={(n) => set({ lumber_stock: v.lumber_stock.map((x, j) => (j === i ? { ...x, price: n } : x)) })} />
                    <span className="tnum text-[13px] text-ink-3">{s.price == null && v.price_per_m != null ? money((v.price_per_m * s.length_mm) / 1000) : ""}</span>
                    <IconButton label="Remove length" size="sm" onClick={() => set({ lumber_stock: v.lumber_stock.filter((_, j) => j !== i) })}><X size={15} /></IconButton>
                  </div>
                ))}
                <Button size="sm" variant="ghost" className="self-start" icon={<Plus size={14} />} onClick={() => set({ lumber_stock: [...v.lumber_stock, { length_mm: 3000, price: null }] })}>Add length</Button>
              </div>
            </Field>
          </div>
        ) : null}

        {v.kind === "sheet" ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Thickness" htmlFor="st"><NumberInput id="st" ariaLabel="Thickness" value={v.thickness_mm} suffix="mm" decimals={1} onChange={(n) => set({ thickness_mm: n })} /></Field>
              <div className="flex items-end pb-1"><Switch label="Has grain" description="Plywood yes; MDF and melamine no." checked={v.has_grain} onChange={(b) => set({ has_grain: b })} /></div>
            </div>
            <Field label="Sheet sizes">
              <div className="flex flex-col gap-2">
                {v.sheet_stock.map((s, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <NumberInput ariaLabel="Width" className="w-28" value={s.width_mm} suffix="mm" onChange={(n) => set({ sheet_stock: v.sheet_stock.map((x, j) => (j === i ? { ...x, width_mm: n ?? 0 } : x)) })} />
                    <span className="text-ink-3">×</span>
                    <NumberInput ariaLabel="Length" className="w-28" value={s.length_mm} suffix="mm" onChange={(n) => set({ sheet_stock: v.sheet_stock.map((x, j) => (j === i ? { ...x, length_mm: n ?? 0 } : x)) })} />
                    <NumberInput ariaLabel="Price" className="w-28" value={s.price} suffix="₪" decimals={2} onChange={(n) => set({ sheet_stock: v.sheet_stock.map((x, j) => (j === i ? { ...x, price: n } : x)) })} />
                    <IconButton label="Remove size" size="sm" onClick={() => set({ sheet_stock: v.sheet_stock.filter((_, j) => j !== i) })}><X size={15} /></IconButton>
                  </div>
                ))}
                <Button size="sm" variant="ghost" className="self-start" icon={<Plus size={14} />} onClick={() => set({ sheet_stock: [...v.sheet_stock, { width_mm: 1220, length_mm: 2440, price: null }] })}>Add size</Button>
              </div>
            </Field>
          </div>
        ) : null}

        {v.kind === "hardware" ? (
          <div className="grid grid-cols-3 gap-4">
            <Field label="Price" htmlFor="hp"><NumberInput id="hp" ariaLabel="Price" value={v.price} suffix="₪" decimals={2} onChange={(n) => set({ price: n })} /></Field>
            <Field label="Sold in packs of" htmlFor="pk"><NumberInput id="pk" ariaLabel="Pack size" value={v.pack_size} min={1} onChange={(n) => set({ pack_size: Math.max(1, Math.round(n ?? 1)) })} /></Field>
            <Field label="Unit" htmlFor="u"><TextInput id="u" value={v.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="each" /></Field>
          </div>
        ) : null}

        {item?.price_history?.length ? (
          <div className="flex flex-col gap-1">
            <p className="text-[12px] font-medium text-ink-2">Price history</p>
            <ul className="tnum text-[13px] text-ink-2">
              {item.price_history.slice(-6).reverse().map((h, i) => <li key={i}>{new Date(h.at).toLocaleDateString("en-GB")} · {money(h.price)} {h.note ? `· ${h.note}` : ""}</li>)}
            </ul>
          </div>
        ) : null}
      </fieldset>
    </Sheet>
  );
}
