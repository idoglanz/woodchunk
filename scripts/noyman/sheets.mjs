// Reads the size variants (size, SKU, price per sheet) of Noyman's panels and plywood into sheets.json.
import { chromium } from "../../frontend/node_modules/playwright/index.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const all = JSON.parse(readFileSync("noyman.json", "utf8")).filter((x) => ["c13", "c14"].includes(x.category));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const out = [];
for (const p of all) {
  await page.waitForTimeout(800);
  await page.goto(p.url, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
  const rows = await page.evaluate(() => {
    const seen = new Set(), res = [];
    for (const e of document.querySelectorAll("tr, li, div")) {
      const s = (e.innerText || "").replace(/\s+/g, " ").trim();
      const m = s.match(/^(.{3,80}?)\s*מק"ט\s*(\d+)\s*([\d,]+\.\d+)\s*₪/);
      if (m && !seen.has(m[2])) { seen.add(m[2]); res.push({ name: m[1].trim(), sku: m[2], price: Number(m[3].replace(",", "")) }); }
    }
    return res;
  });
  out.push({ product: p.name, url: p.url, card: p.card, variants: rows });
  console.log(p.name, "|", rows.length ? rows.map((r) => `${r.name} = ${r.price}`).join(" ; ") : "(single) " + p.card.slice(0, 60));
}
writeFileSync("sheets.json", JSON.stringify(out, null, 1));
await browser.close();
