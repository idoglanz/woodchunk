"use client";

import { Download, Printer } from "lucide-react";
import { useState } from "react";
import { LumberBars } from "@/components/diagrams/lumber";
import { SheetDiagram, cutText } from "@/components/diagrams/sheet";
import { useProjectCtx } from "@/components/project/context";
import { useTranslations } from "@/components/project/translations";
import { Button, Spinner } from "@/components/ui/button";
import { AsmChip, Skeleton } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { download } from "@/lib/api/client";
import { useEditor } from "@/lib/editor";
import { money } from "@/lib/format";
import { dirOf, t, type Lang } from "@/lib/i18n";
import { usePlan, useCatalog } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { fmtMeters } from "@/lib/units";

export function ShopSheetView() {
  const { id, me } = useProjectCtx();
  const version = useEditor((s) => s.version);
  const content = useEditor((s) => s.content);
  const [lang, setLang] = useState<Lang>((me?.prefs.export_lang as Lang) ?? "en");
  const tr = useTranslations(id, version, lang);
  const plan = usePlan(id, version, lang, true, tr.dataUpdatedAt);
  const catalog = useCatalog({});
  const items = new Map((catalog.data ?? []).map((i) => [i.id, i]));
  const tx = (s: string) => (lang === "en" ? s : tr.data?.[s] ?? s);
  const p = plan.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Segmented label="Sheet language" value={lang} onChange={setLang} options={[{ value: "en", label: "English" }, { value: "he", label: "עברית" }]} />
          {lang !== "en" && tr.isFetching ? <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-3"><Spinner className="h-3.5 w-3.5" />Translating your names…</span> : null}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" icon={<Download size={15} />}
            onClick={() => download(`/api/projects/${id}/export/cutlist.csv?lang=${lang}`, `${content?.name ?? "project"} cut list.csv`).catch((e) => toast.error(e.message))}>Cut list CSV</Button>
          <Button size="sm" variant="primary" icon={<Printer size={15} />} onClick={() => window.print()} disabled={!p}>Print or save PDF</Button>
        </div>
      </div>

      {!p || !content ? <Skeleton className="h-[70vh] rounded-[16px]" /> : (
        <article dir={dirOf(lang)} lang={lang} className="flex flex-col gap-8 rounded-[16px] bg-surface p-6 shadow-[var(--shadow-card)] sm:p-10 print:p-0 print:shadow-none dark:border dark:border-line print:border-0">
          <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
            <div className="flex flex-col gap-1">
              <p className="text-[12px] font-medium text-ink-3">{t(lang, "shopSheet")}</p>
              <h1 className="text-[28px] font-bold tracking-[-0.02em]">{tx(content.name)}</h1>
            </div>
            <div className="tnum flex gap-6 text-[14px]">
              <div className="flex flex-col"><span className="text-ink-3">{t(lang, "parts")}</span><span className="font-semibold">{p.totals.parts}</span></div>
              <div className="flex flex-col"><span className="text-ink-3">{t(lang, "kerf")}</span><span className="font-semibold">{content.settings.kerf_sheet_mm} / {content.settings.kerf_lumber_mm} mm</span></div>
              <div className="flex flex-col"><span className="text-ink-3">{t(lang, "total")}</span><span className="font-semibold">{money(p.totals.cost, p.currency)}</span></div>
            </div>
          </header>

          <section className="flex flex-col gap-3">
            <h2 className="text-[19px] font-semibold">{t(lang, "parts")}</h2>
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="text-start text-[12px] text-ink-3">
                  <th className="py-1.5 text-start font-medium">{t(lang, "label")}</th>
                  <th className="py-1.5 text-start font-medium">{t(lang, "part")}</th>
                  <th className="py-1.5 text-start font-medium">{t(lang, "material")}</th>
                  <th className="py-1.5 text-end font-medium">{t(lang, "qty")}</th>
                  <th className="py-1.5 text-end font-medium">{t(lang, "length")}</th>
                  <th className="py-1.5 text-end font-medium">{t(lang, "width")}</th>
                </tr>
              </thead>
              {content.assemblies.map((a) => (
                <tbody key={a.id} className="avoid-break">
                  <tr><td colSpan={6} className="pb-1 pt-4 text-[13px] font-semibold"><span className="inline-flex items-center gap-2"><AsmChip letter={a.letter} />{tx(a.name)} ×{a.qty}</span></td></tr>
                  {a.parts.map((pt, i) => {
                    const it = pt.item_id ? items.get(pt.item_id) : undefined;
                    return (
                      <tr key={pt.id} className="border-t border-line">
                        <td className="py-1.5 font-semibold">{a.letter}{i + 1}</td>
                        <td className="py-1.5">{tx(pt.name) || "—"}</td>
                        <td className="py-1.5 text-ink-2">{it ? (lang === "he" && it.name.he ? it.name.he : it.name.en) : "—"}</td>
                        <td className="tnum py-1.5 text-end">{pt.qty * a.qty}</td>
                        <td className="tnum py-1.5 text-end">{pt.length_mm}</td>
                        <td className="tnum py-1.5 text-end">{pt.width_mm ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </section>

          {p.lumber.map((lp) => (
            <section key={lp.item_id} className="avoid-break flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[19px] font-semibold">{lp.name}</h2>
                <span className="tnum text-[14px] text-ink-2">{t(lang, "buy")}: {lp.buy.map((b) => `${b.qty} × ${fmtMeters(b.length_mm)}`).join(" · ")}</span>
              </div>
              <LumberBars plan={lp} />
              <ol className="flex flex-col gap-1 text-[13px]">
                {lp.patterns.map((pat, i) => (
                  <li key={i} className="tnum flex gap-2">
                    <span className="w-24 shrink-0 font-semibold">{fmtMeters(pat.stock_length)} ×{pat.count}</span>
                    <span className="text-ink-2">{pat.segments.map((s) => (s.kind === "part" ? `${s.label} ${Math.round(s.length)}` : s.kind === "offcut" ? `${t(lang, "offcut")} ${Math.round(s.length)} (${t(lang, "keep")})` : "")).filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ol>
            </section>
          ))}

          {p.sheets.map((sp) => sp.layouts.map((lay, i) => (
            <section key={`${sp.item_id}-${i}`} className="avoid-break flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[19px] font-semibold">{sp.name}</h2>
                <span className="tnum text-[14px] text-ink-2">{t(lang, "sheet")} {i + 1}/{sp.layouts.length} · {lay.width} × {lay.length}</span>
              </div>
              <SheetDiagram layout={lay} hasGrain={sp.has_grain} />
              <ol className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                {lay.cuts.map((c) => (
                  <li key={c.n} className="tnum flex gap-2"><span className="w-5 shrink-0 font-semibold">{c.n}.</span>{cutText(c, lang)}</li>
                ))}
              </ol>
            </section>
          )))}

          {p.hardware.length ? (
            <section className="avoid-break flex flex-col gap-2">
              <h2 className="text-[19px] font-semibold">{t(lang, "hardware")}</h2>
              <ul className="flex flex-col text-[14px]">
                {p.hardware.map((h) => (
                  <li key={h.key} className="tnum flex justify-between border-t border-line py-1.5"><span>{h.name}</span><span>{h.qty.toLocaleString()}</span></li>
                ))}
              </ul>
            </section>
          ) : null}
          <footer className="text-[12px] text-ink-3">{t(lang, "printed")} {new Date().toLocaleDateString(lang === "he" ? "he-IL" : "en-GB")} · Woodchunk</footer>
        </article>
      )}
    </div>
  );
}
