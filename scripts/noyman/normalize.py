"""Turn the Noyman crawl (noyman.json, sheets.json) into backend/seed_data/noyman.json.

Lumber: net section from the product's URL slug or name (Noyman's names are nominal sizes),
price per metre from the category page, lengths from the product page. Sheets: one item per
material and thickness, every size it's sold in with its price. Each item names the legacy
catalog rows it replaces (same wood, net section, treatment and profile), so items keep their ids.
"""

import json
import re
import sys
import urllib.parse
from pathlib import Path

HERE = Path(__file__).parent
REPO = Path(sys.argv[1])
crawl = json.loads((HERE / "noyman.json").read_text())
sheets = json.loads((HERE / "sheets.json").read_text())
legacy = json.loads((REPO / "backend/seed_data/sample_catalog.json").read_text())

LUMBER_CATS = {"c9", "c10", "c11", "c12", "c73", "c74"}
# Sizes the slug doesn't give cleanly, read off the product drawings.
NET_OVERRIDE = {
    "10011339": (22, 150),  # לבן 25/160 שימור: drawing 22 × 150
    "10011340": (44, 150),  # לבן 50/160 שימור: drawing 44 × 150
    "10011499": (22, 150),  # לבן 25/160 גלריה
    "10031046": (14, 150),
    "10031065": (14, 150),  # ציפוי 14 מ"מ: 14 thick, 15 cm wide
    "10031000": (12, 100),  # ציפוי 12 מ"מ: 12 thick, 10 cm wide
}


def slug(url: str) -> str:
    return urllib.parse.unquote(url.rsplit("/", 1)[1])


def split2(s: str) -> tuple[int, int]:
    """'2550' → (25, 50); '25100' → (25, 100); thickness is the first two digits."""
    return int(s[:2]), int(s[2:])


def net_section(p: dict) -> tuple[float, float]:
    if p["sku"] in NET_OVERRIDE:
        return NET_OVERRIDE[p["sku"]]
    name, s = p["name"], slug(p["url"])
    m = re.search(r"\((\d+)/(\d+)", name)  # "100/150 (85/135 נטו)"
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r"-(\d{4,5})-+(\d{4,5})-נטו", s)  # "2550-2045-נטו", "22200--18195-נטו"
    if m:
        return split2(m.group(2))
    m = re.search(r"-(\d{4,5})-", s)  # rough or treated boards: the slug size is the real size
    if m:
        return split2(m.group(1))
    raise ValueError(f"no section for {name} {s}")


def nominal(name: str) -> str:
    m = re.search(r"(\d+)/(\d+)", name)
    return f"{m.group(1)} × {m.group(2)}" if m else ""


def flags(he: str) -> dict:
    return {
        "planed": "מוקצע" in he or "גלריה" in he or "טרמו" in he or "שכבתי" in he or "ציפוי" in he,
        "treated": "שימור" in he,
        "rough": "גולמי" in he,
        "profile": ("tongue & groove" if he.startswith("ציפוי ") and "נגיעה" not in he else
                    "shiplap" if "מרועף" in he else "log cladding" if "לוג" in he else
                    "cladding" if "ציפוי נגיעה" in he else "shade rail" if "הצללה" in he else
                    "decking" if "גלריה" in he else ""),
    }


def material(p: dict) -> str:
    he = p["name"]
    if "טרמו" in he:
        return "thermo pine"
    if "שכבתי" in he:
        return "glulam spruce"
    if "לבן" in he:
        return "whitewood"
    return "pine"


MATERIAL_EN = {"pine": "pine", "whitewood": "whitewood", "thermo pine": "thermo pine", "glulam spruce": "glulam beam"}


def lengths(p: dict) -> list[float]:
    for s in p["selects"]:
        out = [float(o.split()[0]) for o in s["options"] if "מטר" in o]
        if out:
            return sorted(out)
    return []


def ppm(card: str) -> float:
    return float(re.search(r"([\d,]+\.\d+)\s*₪\s*למטר", card).group(1).replace(",", ""))


def treatment(f: dict) -> str:
    return ", ".join(x for x in ("planed" if f["planed"] else "", "treated" if f["treated"] else "", "rough" if f["rough"] else "") if x) or "untreated"


# --- the legacy rows, keyed the same way --------------------------------------------------------

def legacy_key(i: int, row: dict) -> tuple:
    head = row["description"].split(" - ")[0]
    f = flags(head)
    mat = "whitewood" if "לבן" in head else "carolina pine" if "קרולינה" in head else "pine"
    t, w = row["height"], row["width"]
    if head.startswith("ציפוי"):
        w = row["width"] * 10
    m = re.search(r"\((\d+)/(\d+) נטו\)", head)
    if m:
        t, w = float(m.group(1)), float(m.group(2))
    return (mat, float(t), float(w), f["treated"], f["profile"])


legacy_by_key: dict[tuple, list[str]] = {}
for i, row in enumerate(legacy["lumber_types"]):
    legacy_by_key.setdefault(legacy_key(i, row), []).append(f"lumber:{i}")

items = []
# Same product as a legacy row whose size was written differently.
REPLACES = {"10011456": ["lumber:3"]}  # לבן 25/130 מוקצע = לבן 22/125 (18/120) at the same price

for p in crawl:
    if p["category"] not in LUMBER_CATS or not lengths(p):
        continue
    f = flags(p["name"] + " " + slug(p["url"]))
    t, w = net_section(p)
    mat = material(p)
    cat = ("beams" if mat == "glulam spruce" else "decking" if f["profile"] == "decking" else
           "cladding" if f["profile"] and f["profile"] != "shade rail" else "beams" if t >= 32 else "boards")
    nom = nominal(p["name"])
    net = f"{t:g} × {w:g}"
    en = (f"{nom} {MATERIAL_EN[mat]}" if nom and nom != net else f"{net} {MATERIAL_EN[mat]}")
    if f["profile"]:
        en += f" {f['profile']}"
    en += f", {treatment(f)}"
    if nom and nom != net:
        en += f" ({net} net)"
    key = (mat, float(t), float(w), f["treated"], "" if f["profile"] == "decking" else f["profile"])
    replaces = legacy_by_key.pop(key, []) if f["profile"] != "decking" else []
    for r in REPLACES.get(p["sku"], []):
        for k, v in list(legacy_by_key.items()):
            if r in v:
                legacy_by_key.pop(k)
        replaces.append(r)
    items.append({
        "sku": p["sku"], "kind": "lumber", "name_en": en, "name_he": p["name"], "url": p["url"],
        "image": p["img"], "category": cat, "material": mat, "treatment": treatment(f),
        "tags": sorted({x for x in ("outdoor" if f["treated"] or mat == "thermo pine" else "", "planed" if f["planed"] else "",
                                    f["profile"], "glulam" if mat == "glulam spruce" else "") if x}),
        "thickness_mm": t, "width_mm": w, "price_per_m": ppm(p["card"]), "lengths_m": lengths(p),
        "replaces": replaces,
    })

# --- sheets -------------------------------------------------------------------------------------

SHEET_GROUPS = [
    # (product name prefix, material, en template, he template, category, grain, legacy keys by thickness)
    ("פלטה אורן", "pine panel", "{t:g} mm pine panel (edge-glued)", "פלטה אורן {t:g} מ״מ", "panels", True, {18: ["sheet:pine:18"]}),
    ("דיקט (סנדוויץ')", "sandwich plywood", "{t:g} mm sandwich plywood", "דיקט סנדוויץ׳ {t:g} מ״מ", "plywood", True, {}),
    ("דיקט ליבנה", "birch plywood", "{t:g} mm birch plywood", "דיקט ליבנה {t:g} מ״מ", "plywood", True,
     {18: ["sheet:birch:18"], 8: ["sheet:birch:8"], 12: ["sheet:birch:12"]}),
]


def dims(text: str) -> tuple[float, float, float] | None:
    m = re.search(r"(\d+)/(\d+)/(\d+)", text)  # 244/122/18 (cm, cm, mm)
    if m:
        return float(m.group(1)) * 10, float(m.group(2)) * 10, float(m.group(3))
    m = re.search(r"(\d+)\s*מ\"מ\s*(?:\+.*?)?(\d+)/(\d+)", text)  # דיקט 12 מ"מ 244/122
    if m:
        return float(m.group(2)) * 10, float(m.group(3)) * 10, float(m.group(1))
    return None


by_product = {s["product"]: s for s in sheets}
for prefix, mat, en, he, cat, grain, legacy_keys in SHEET_GROUPS:
    stock: dict[float, list] = {}
    for prod in sheets:
        if not prod["product"].startswith(prefix) or "פורמייקה" in prod["product"]:
            continue
        rows = prod["variants"] or [{"name": prod["product"], "sku": "", "price": float(re.search(r"([\d,]+\.\d+)", prod["card"]).group(1).replace(",", ""))}]
        for v in rows:
            d = dims(v["name"])
            if not d:
                continue
            L, W, t = d
            stock.setdefault(t, []).append({"length_mm": L, "width_mm": W, "price": v["price"], "sku": v["sku"]})
    for t, st in sorted(stock.items()):
        st.sort(key=lambda s: (s["length_mm"] * s["width_mm"]))
        items.append({
            "sku": "+".join(sorted({s["sku"] for s in st if s["sku"]})) or f"{prefix}-{t:g}", "kind": "sheet",
            "name_en": en.format(t=t), "name_he": he.format(t=t), "url": by_product[next(p for p in by_product if p.startswith(prefix))]["url"],
            "image": "", "category": cat, "material": mat, "treatment": "", "tags": [], "thickness_mm": t,
            "has_grain": grain, "sheet_stock": [{k: s[k] for k in ("length_mm", "width_mm", "price")} for s in st],
            "replaces": legacy_keys.get(int(t), []),
        })

# Sandwich plywood with white Formica: the old "12 mm laminate board".
form = by_product["דיקט (סנדוויץ') + פורמייקה לבנה"]
for v in form["variants"]:
    d = dims(v["name"])
    sides = "both sides" if "* 2" in v["name"] or "*2" in v["name"] else "one side"
    items.append({
        "sku": v["sku"], "kind": "sheet", "name_en": f"{d[2]:g} mm plywood, white Formica {sides}",
        "name_he": v["name"].replace("בחרו את המוצר הרצוי", "").replace(" 244/122", "").strip(), "url": form["url"], "image": "", "category": "panels",
        "material": "formica plywood", "treatment": "", "tags": ["formica"], "thickness_mm": d[2], "has_grain": False,
        "sheet_stock": [{"length_mm": d[0], "width_mm": d[1], "price": v["price"]}],
        "replaces": ["sheet:laminate:12"] if d[2] == 12 else [],
    })

# OSB: priced per running metre of a 2.44 × 1.22 sheet.
for p in crawl:
    if p["name"].startswith("OSB"):
        t = float(re.search(r"(\d+)\s*מ\"מ", p["name"]).group(1))
        items.append({
            "sku": p["sku"], "kind": "sheet", "name_en": f"{t:g} mm OSB", "name_he": p["name"], "url": p["url"],
            "image": p["img"], "category": "panels", "material": "OSB", "treatment": "", "tags": ["osb"],
            "thickness_mm": t, "has_grain": False,
            "sheet_stock": [{"length_mm": 2440, "width_mm": 1220, "price": round(ppm(p["card"]) * 2.44, 2)}],
            "replaces": [],
        })

out = {
    "supplier": {"name": "Noyman (נוימן)", "url": "https://www.noyman-wood.co.il/",
                 "notes": "Prices and lengths from the website, as listed (website orders). Lumber is priced per metre."},
    "source_date": "2026-10-26",
    "items": items,
    "retire_legacy": sorted(x for v in legacy_by_key.values() for x in v),
}
(REPO / "backend/seed_data/noyman.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
print(len(items), "items;", sum(i["kind"] == "lumber" for i in items), "lumber,", sum(i["kind"] == "sheet" for i in items), "sheets")
print("legacy rows with no Noyman match (retired):", out["retire_legacy"])
for it in items:
    extra = f"{it['price_per_m']}/m {it['lengths_m']}" if it["kind"] == "lumber" else "; ".join(f"{s['length_mm']:g}×{s['width_mm']:g}={s['price']}" for s in it["sheet_stock"])[:90]
    print(f"{it['kind'][:5]} | {it['name_en'][:52]:52} | {it['name_he'][:28]:28} | {extra[:70]} | {','.join(it['replaces'])}")
