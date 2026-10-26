// Reads Noyman's wood categories and each product page (name, SKU, lengths, per-metre price) into
// noyman.json. One page at a time, with pauses. Run via `make noyman`.
import { chromium } from "../../frontend/node_modules/playwright/index.mjs";
import { writeFileSync } from "node:fs";
const BASE = "https://www.noyman-wood.co.il/";
const WANT = { c9: "pine", c10: "whitewood", c11: "two-layer", c12: "multi-layer", c13: "panels", c14: "plywood", c73: "gallery", c74: "thermo pine", c21: "round posts", c20: "sleepers", c25: "complementary", c95: "pine decking" };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(BASE, { waitUntil: "networkidle" });
const cats = await page.evaluate((want) => {
  const out = {};
  for (const a of document.querySelectorAll("a[href]")) {
    const m = a.href.match(/-(c\d+)$/);
    if (m && want[m[1]] && !out[m[1]]) out[m[1]] = { url: a.href, label: a.textContent.trim() };
  }
  return out;
}, WANT);
console.log("categories:", Object.keys(cats).join(","), "missing:", Object.keys(WANT).filter((k) => !cats[k]).join(","));
const result = [];
for (const [cid, c] of Object.entries(cats)) {
  await page.goto(c.url, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
  const cards = await page.evaluate(() => {
    const seen = new Map();
    for (const a of document.querySelectorAll("a[href]")) {
      if (!/-i\d+$/.test(a.href)) continue;
      // the smallest ancestor holding a price
      let el = a;
      for (let k = 0; k < 6 && el && !/₪/.test(el.innerText || ""); k++) el = el.parentElement;
      const text = (el?.innerText || a.innerText || "").replace(/\s+/g, " ").trim();
      if (!seen.has(a.href) || text.length > seen.get(a.href).length) seen.set(a.href, text);
    }
    return [...seen].map(([url, text]) => ({ url, text }));
  });
  console.log(cid, c.label, cards.length, "products");
  for (const card of cards) {
    await page.waitForTimeout(700);
    await page.goto(card.url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const d = await page.evaluate(() => {
      const name = document.querySelector("h1")?.textContent.trim() || document.title.split(" - ")[0];
      const sku = (document.body.innerText.match(/מק"ט\s*([\w-]+)/) || [])[1] || "";
      const selects = [...document.querySelectorAll("select")].filter((s) => !/ddhituch/.test(s.name))
        .map((s) => ({ name: s.name, options: [...s.options].map((o) => o.textContent.trim()).filter((t) => t && !/^בחר/.test(t)) }));
      const img = [...document.querySelectorAll("img")].map((i) => i.src).find((s) => /product|Product|upload|Upload/.test(s)) || "";
      const desc = (document.querySelector("[class*=desc], [id*=desc], [id*=Desc]")?.innerText || "").trim().slice(0, 400);
      return { name, sku, selects, img, desc };
    });
    result.push({ category: cid, category_label: c.label, url: card.url, card: card.text, ...d });
  }
  writeFileSync("noyman.json", JSON.stringify(result, null, 1));
}
await browser.close();
console.log("total", result.length);
