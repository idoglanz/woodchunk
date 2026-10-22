"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { Sheet } from "@/components/ui/overlay";
import { Segmented } from "@/components/ui/segmented";
import { startImport, useSuppliers } from "@/lib/queries";
import { toast } from "@/lib/toast";

export function ImportSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [mode, setMode] = useState<"url" | "file" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [supplier, setSupplier] = useState("");
  const [busy, setBusy] = useState(false);
  const suppliers = useSuppliers();
  const router = useRouter();

  const go = async () => {
    const form = new FormData();
    if (mode === "url") form.append("url", url.trim());
    if (mode === "text") form.append("text", text);
    if (mode === "file" && file) form.append("file", file);
    if (supplier) form.append("supplier_id", supplier);
    setBusy(true);
    try {
      const imp = await startImport(form);
      onOpenChange(false);
      router.push(`/catalog/imports/${imp.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  const ok = mode === "url" ? /^https?:\/\//.test(url.trim()) : mode === "text" ? text.trim().length > 20 : !!file;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Import products" description="Woodchunk reads the products and prices, then shows you what's new or changed before anything is added."
      footer={<><Button variant="plain" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!ok} onClick={go}>{busy ? "Reading…" : "Read products"}</Button></>}>
      <div className="flex flex-col gap-5">
        <Segmented label="Source" value={mode} onChange={setMode} options={[{ value: "url", label: "Web page" }, { value: "file", label: "File" }, { value: "text", label: "Paste text" }]} />
        {mode === "url" ? (
          <Field label="Page address" htmlFor="iurl" hint="A supplier's product or price list page.">
            <TextInput id="iurl" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </Field>
        ) : mode === "file" ? (
          <Field label="Price list" htmlFor="ifile" hint="PDF, photo, CSV or Excel. Up to 15 MB.">
            <input id="ifile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.xlsm,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded-lg bg-surface-2 p-2.5 text-[14px] file:me-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-[14px] file:font-semibold" />
          </Field>
        ) : (
          <Field label="Product list" htmlFor="itext" hint="Copy it from the website or a quote, in English or Hebrew.">
            <TextArea id="itext" dir="auto" value={text} onChange={(e) => setText(e.target.value)} className="min-h-40" />
          </Field>
        )}
        <Field label="Supplier" htmlFor="isup" hint="Leave on automatic to use the name found in the source.">
          <Select id="isup" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">Automatic</option>
            {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
      </div>
    </Sheet>
  );
}
