"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { useProjectCtx } from "@/components/project/context";
import { ItemPicker, rememberMaterial } from "@/components/project/material-picker";
import { Button } from "@/components/ui/button";
import { Field, QtyInput, Select } from "@/components/ui/field";
import { Ltr } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/overlay";
import { newAssembly, newPart, nextLetter, useEditor } from "@/lib/editor";
import { useCatalog } from "@/lib/queries";
import { itemNames } from "@/lib/sketch/model";
import { lineLength, partLabels } from "@/lib/sketch/parts";
import type { Sketch } from "@/lib/sketch/types";
import { toast } from "@/lib/toast";
import { fmtLength } from "@/lib/units";

const NEW = "__new__";

/**
 * Turn the selected lines into parts of an assembly, cut from a material. Each part stays tied to
 * its line: change the sketch and the part's length follows.
 */
export function MakeParts({ sk, lines, open, onOpenChange }: { sk: Sketch; lines: string[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { id: projectId, units } = useProjectCtx();
  const router = useRouter();
  const content = useEditor((s) => s.content);
  const edit = useEditor((s) => s.edit);
  const catalog = useCatalog({ kind: "lumber" });
  const t = useTranslations("sketch");
  const names = useMemo(() => itemNames(sk, t), [sk, t]);
  const linked = useMemo(() => (content ? partLabels(content, sk.id) : new Map()), [content, sk.id]);
  const fresh = lines.filter((l) => !linked.has(l));
  const assemblies = (content?.assemblies ?? []).filter((a) => !a.frame); // a frame's parts come from the frame
  // The sketch's own assembly first, else the last one.
  const [asm, setAsm] = useState<string>(assemblies.find((a) => a.id === sk.assembly_id)?.id ?? assemblies.at(-1)?.id ?? NEW);
  const [item, setItem] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [name, setName] = useState(sk.name);

  const create = () => {
    if (!item || !fresh.length) return;
    rememberMaterial(item);
    let letter = "", asmName = "";
    edit((d) => {
      let a = d.assemblies.find((x) => x.id === asm);
      if (!a) {
        a = newAssembly({ letter: nextLetter(d.assemblies.map((x) => x.letter)), name: sk.name });
        d.assemblies.push(a);
        const own = d.sketches.find((x) => x.id === sk.id);
        if (own && !own.assembly_id) own.assembly_id = a.id; // drawn for the assembly it started
      }
      fresh.forEach((l, i) => {
        a!.parts.push(newPart({
          name: fresh.length > 1 ? `${name} ${i + 1}` : name, item_id: item, qty,
          length_mm: Math.min(lineLength(sk, l) ?? 0, 100_000), sketch: { sketch_id: sk.id, shape_id: l },
        }));
      });
      [letter, asmName] = [a.letter, a.name];
    });
    onOpenChange(false);
    toast.info(t("makeParts.added", { n: fresh.length, letter, assembly: asmName }), { label: t("makeParts.openBuild"), run: () => router.push(`/projects/${projectId}/build`) });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("makeParts.title")}
      description={t("makeParts.description")}
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
        <Button variant="primary" disabled={!item || !fresh.length} onClick={create}>{t("makeParts.add", { n: fresh.length })}</Button>
      </>}>
      <div className="flex flex-col gap-4">
        <ul className="flex flex-wrap gap-1.5">
          {lines.map((l) => (
            <li key={l} className="tnum rounded-lg bg-surface-2 px-2 py-1 text-[13px]">
              {names.get(l)} · <Ltr>{fmtLength(lineLength(sk, l) ?? 0, units)}</Ltr>
              {linked.has(l) ? <span className="text-ink-3"> · {t("makeParts.already", { label: linked.get(l)!.label })}</span> : null}
            </li>
          ))}
        </ul>
        <Field label={t("makeParts.material")} htmlFor="mp-material">
          <ItemPicker items={catalog.data ?? []} value={item} kinds={["lumber"]} ariaLabel={t("makeParts.materialAria")} onChange={(v) => setItem(v)} />
        </Field>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Field label={fresh.length > 1 ? t("makeParts.namesNumbered") : t("makeParts.name")} htmlFor="mp-name">
            <input id="mp-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)}
              className="h-10 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none focus:shadow-[0_0_0_2px_var(--accent)]" />
          </Field>
          <Field label={t("makeParts.each")}>
            <QtyInput ariaLabel={t("makeParts.eachAria")} value={qty} onChange={setQty} />
          </Field>
        </div>
        <Field label={t("makeParts.assembly")} htmlFor="mp-asm">
          <Select id="mp-asm" value={asm} onChange={(e) => setAsm(e.target.value)} className="w-full">
            {assemblies.map((a) => <option key={a.id} value={a.id}>{a.letter} · {a.name || t("makeParts.assembly")}</option>)}
            <option value={NEW}>{t("makeParts.newAssembly", { name: sk.name })}</option>
          </Select>
        </Field>
      </div>
    </Sheet>
  );
}
