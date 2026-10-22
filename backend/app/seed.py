"""First-run data: the catalog carried over from the original Woodchunk, common hardware,
public templates, and (in dev) the original projects for the configured admin."""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from pymongo.asynchronous.database import AsyncDatabase

from app.config import get_settings
from app.models.catalog import CatalogItem, ItemKind, LumberStock, PricePoint, SheetStock, Supplier
from app.models.common import Localized, now
from app.models.project import Assembly, HardwareLine, Member, Part, Project, Role, TemplateMeta
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)
LEGACY = Path(__file__).resolve().parent.parent / "seed_data"
SYSTEM_USER = "system"

# Hebrew legacy descriptions → material / treatment / profile
MATERIAL_HE = {"לבן": ("whitewood", "עץ לבן"), "אורן": ("pine", "אורן"), "קרולינה": ("carolina pine", "אורן קרולינה")}


def _parse_legacy(i: int, row: dict) -> CatalogItem:
    desc: str = row["description"]
    head = desc.split(" - ")[0]
    material, material_he = "pine", "אורן"
    for key, val in MATERIAL_HE.items():
        if key in head:
            material, material_he = val
            break
    treated = "שימור" in head
    planed = "מוקצע" in head
    rough = "גולמי" in head
    profile = ""
    if "נוטפדר" in head:
        profile = "tongue & groove"
    elif "מרועף" in head:
        profile = "shiplap"
    elif "לוג" in head:
        profile = "log cladding"
    elif "ציפוי נגיעה" in head:
        profile = "cladding"
    elif "הצללה" in head:
        profile = "shade rail"

    t_nom, w_nom = row["height"], row["width"]
    if "נוטפדר" in head:  # these rows list width in cm
        w_nom = row["width"] * 10
    net = re.search(r"\((\d+)/(\d+) נטו\)", head)
    t_net, w_net = (float(net.group(1)), float(net.group(2))) if net else (t_nom, w_nom)

    treatment = ", ".join(x for x in (("planed" if planed else ""), ("treated" if treated else ""),
                                      ("rough" if rough else "")) if x) or "untreated"
    name_en = f"{t_nom:g} × {w_nom:g} {material}" + (f" {profile}" if profile else "") + f", {treatment}"
    if net:
        name_en += f" ({t_net:g} × {w_net:g} net)"
    name_he = head.strip()
    ppm = row["price_per_meter"]
    item = CatalogItem(
        kind=ItemKind.lumber, name=Localized(en=name_en, he=name_he), material=material, treatment=treatment,
        category="cladding" if profile and profile != "shade rail" else ("beams" if t_nom >= 38 else "boards"),
        tags=[t for t in ("outdoor" if treated else "", "planed" if planed else "", profile) if t],
        thickness_mm=t_net, width_mm=w_net, price_per_m=ppm,
        lumber_stock=[LumberStock(length_mm=round(L * 1000)) for L in row.get("available_lengths", [])],
        price_updated_at=now(), price_history=[PricePoint(price=ppm, note="original catalog")],
        sku=f"legacy-{i}",
    )
    item.refresh_search()
    return item


SHEETS = {
    ("pine", 18): ("18 mm pine plywood", "דיקט אורן 18 מ״מ", "plywood", True),
    ("birch", 18): ("18 mm birch plywood", "דיקט ליבנה 18 מ״מ", "plywood", True),
    ("pine", 25): ("25 mm pine plywood", "דיקט אורן 25 מ״מ", "plywood", True),
    ("laminate", 12): ("12 mm laminate board", "לוח למינציה 12 מ״מ", "panels", False),
    ("sandwich", 15): ("15 mm sandwich board", "לוח סנדוויץ׳ 15 מ״מ", "panels", True),
    ("birch", 8): ("8 mm birch plywood", "דיקט ליבנה 8 מ״מ", "plywood", True),
    ("birch", 12): ("12 mm birch plywood", "דיקט ליבנה 12 מ״מ", "plywood", True),
}

HARDWARE = [
    # name_en, name_he, pack, unit, category
    ("Wood screw 4×40 mm", "בורג עץ 4×40 מ״מ", 200, "each", "screws"),
    ("Wood screw 5×50 mm", "בורג עץ 5×50 מ״מ", 200, "each", "screws"),
    ("Wood screw 5×80 mm", "בורג עץ 5×80 מ״מ", 100, "each", "screws"),
    ("Wood screw 6×150 mm", "בורג עץ 6×150 מ״מ", 1, "each", "screws"),
    ("Butt hinge 75 mm", "ציר 75 מ״מ", 1, "each", "hinges"),
    ("Eye bolt", "בורג עין", 1, "each", "bolts"),
    ("Steel chain", "שרשרת ברזל", 1, "m", "other"),
    ("L bracket 50 mm", "זווית L 50 מ״מ", 1, "each", "brackets"),
    ("Wood glue 750 ml", "דבק נגרים 750 מ״ל", 1, "each", "glue"),
    ("Outdoor wood oil 1 L", "שמן לעץ חוץ 1 ליטר", 1, "each", "finish"),
]


def build_catalog(supplier_id: str) -> tuple[list[CatalogItem], dict[str, CatalogItem]]:
    data = json.loads((LEGACY / "sample_catalog.json").read_text())
    items: list[CatalogItem] = []
    by_legacy: dict[str, CatalogItem] = {}
    for i, row in enumerate(data["lumber_types"]):
        it = _parse_legacy(i, row)
        it.supplier_id = supplier_id
        items.append(it)
        by_legacy[f"lumber:{i}"] = it
    for row in data["woodboards"]:
        key = (row["wood_type"], int(row["thickness"]))
        if key not in SHEETS:
            continue
        en, he, cat, grain = SHEETS[key]
        price = row["price_per_board"] or None
        it = CatalogItem(kind=ItemKind.sheet, supplier_id=supplier_id, name=Localized(en=en, he=he),
                         material=f"{row['wood_type']} plywood" if cat == "plywood" else row["wood_type"],
                         category=cat, thickness_mm=row["thickness"], has_grain=grain,
                         sheet_stock=[SheetStock(length_mm=row["length"], width_mm=row["width"], price=price)],
                         price_updated_at=now() if price else None,
                         price_history=[PricePoint(price=price, note="original catalog")] if price else [])
        it.refresh_search()
        items.append(it)
        by_legacy[f"sheet:{key[0]}:{key[1]}"] = it
    for en, he, pack, unit, cat in HARDWARE:
        it = CatalogItem(kind=ItemKind.hardware, supplier_id=None, name=Localized(en=en, he=he), pack_size=pack,
                         unit=unit, category=cat, material="steel" if cat in ("screws", "hinges", "bolts") else "")
        it.refresh_search()
        items.append(it)
        by_legacy[f"hw:{en}"] = it
    return items, by_legacy


def _p(name, item, qty, length, width=None, grain=False) -> Part:
    return Part(name=name, item_id=item.id, qty=qty, length_mm=length, width_mm=width, grain_locked=grain)


def _hw(item, qty) -> HardwareLine:
    return HardwareLine(item_id=item.id, name=item.name.en, qty=qty)


def build_templates(c: dict[str, CatalogItem]) -> list[Project]:
    beam = c["lumber:7"]  # 44 × 100 whitewood rough
    beam_t = c["lumber:8"]  # 44 × 100 whitewood treated
    post = c["lumber:46"]  # 75 × 75 pine planed treated
    post50 = c["lumber:36"]  # 50 × 50 pine planed treated
    board_t = c["lumber:18"]  # 25 × 150 pine planed treated
    slat = c["lumber:14"]  # 25 × 100 pine planed
    batten = c["lumber:23"]  # 38 × 38 pine planed
    ply_b = c["sheet:birch:18"]
    ply_p = c["sheet:pine:18"]
    s40, s50, s80 = c["hw:Wood screw 4×40 mm"], c["hw:Wood screw 5×50 mm"], c["hw:Wood screw 5×80 mm"]
    glue, oil = c["hw:Wood glue 750 ml"], c["hw:Outdoor wood oil 1 L"]

    def tpl(title, summary, category, assemblies, extras=()) -> Project:
        return Project(name=title, description=summary, owner_id=SYSTEM_USER, is_template=True,
                       template=TemplateMeta(title=title, summary=summary, category=category, public=True),
                       members=[Member(user_id=SYSTEM_USER, role=Role.owner, name="Woodchunk")],
                       assemblies=list(assemblies), extras=list(extras))

    return [
        tpl("Sawhorse pair", "Two stackable sawhorses, 75 cm tall, from 44 × 100 lumber.", "workshop", [
            Assembly(name="Sawhorse", qty=2, parts=[
                _p("Top beam", beam, 1, 900), _p("Leg", beam, 4, 760), _p("Leg brace", beam, 2, 380)],
                hardware=[_hw(s80, 16)])]),
        tpl("Workbench 180 × 80", "Sturdy 90 cm high bench with a birch plywood top and a lower shelf.", "workshop", [
            Assembly(name="Frame", qty=1, parts=[
                _p("Leg", post, 4, 862), _p("Long apron", beam, 4, 1650), _p("Short apron", beam, 4, 650)],
                hardware=[_hw(s80, 48)]),
            Assembly(name="Top and shelf", qty=1, parts=[
                _p("Top", ply_b, 1, 1800, 800, True), _p("Lower shelf", ply_p, 1, 1650, 650)],
                hardware=[_hw(s50, 30)])], [_hw(glue, 1)]),
        tpl("Bookshelf 180 × 80", "Five-shelf bookcase, 30 cm deep, in 18 mm pine plywood.", "furniture", [
            Assembly(name="Carcass", qty=1, parts=[
                _p("Side", ply_p, 2, 1800, 300, True), _p("Shelf", ply_p, 5, 764, 300, True),
                _p("Kick board", ply_p, 1, 764, 80)],
                hardware=[_hw(s50, 40)])], [_hw(glue, 1)]),
        tpl("Raised garden bed 180 × 90", "40 cm high bed from treated 25 × 150 boards on 50 × 50 corner posts.",
            "garden", [
            Assembly(name="Bed", qty=1, parts=[
                _p("Long side board", board_t, 6, 1800), _p("Short side board", board_t, 6, 860),
                _p("Corner post", post50, 4, 435)],
                hardware=[_hw(s40, 48)])], [_hw(oil, 1)]),
        tpl("Outdoor table 160 × 80", "Treated frame with planed slats, seats six.", "furniture", [
            Assembly(name="Frame", qty=1, parts=[
                _p("Leg", post, 4, 720), _p("Long apron", beam_t, 2, 1300), _p("Short apron", beam_t, 2, 560)],
                hardware=[_hw(s80, 16)]),
            Assembly(name="Top", qty=1, parts=[_p("Slat", slat, 8, 1600), _p("Cleat", batten, 3, 760)],
                     hardware=[_hw(s40, 48)])], [_hw(oil, 1)]),
        tpl("Storage crate", "Stackable 60 × 40 × 30 crate from planed boards.", "storage", [
            Assembly(name="Crate", qty=1, parts=[
                _p("Long side", slat, 6, 600), _p("Short side", slat, 6, 360), _p("Corner cleat", batten, 4, 280),
                _p("Bottom slat", slat, 4, 600)],
                hardware=[_hw(s40, 64)])]),
    ]


def legacy_projects(owner: User, c: dict[str, CatalogItem]) -> list[Project]:
    out = []
    for f in sorted((LEGACY / "projects").glob("*.json")):
        data = json.loads(f.read_text())
        assemblies = []
        for a in data.get("assemblies", []):
            parts = []
            for i, pc in enumerate(a.get("pieces", [])):
                it = c.get(f"lumber:{pc['lumber_index']}")
                if it is None or pc["length"] <= 0:
                    continue
                parts.append(Part(name=f"Piece {i + 1}", item_id=it.id, qty=pc.get("quantity", 1),
                                  length_mm=round(pc["length"] * 1000)))
            if parts:
                assemblies.append(Assembly(name=a["name"], qty=a.get("units", 1), parts=parts))
        if not assemblies:
            continue
        extras = [HardwareLine(name=h["name"], qty=h["quantity"], unit_price=h.get("cost"))
                  for h in data.get("hardware_list") or []]
        out.append(Project(name=data["name"], description=data.get("description", ""), owner_id=owner.id,
                           members=[Member(user_id=owner.id, role=Role.owner, email=owner.email, name=owner.name)],
                           assemblies=assemblies, extras=extras))
    return out


async def seed_if_empty(db: AsyncDatabase) -> None:
    if await db.catalog_items.count_documents({}) > 0:
        return
    logger.info("Seeding catalog and templates")
    supplier = Supplier(name="Original catalog yard", currency="ILS",
                        notes="Prices carried over from the first Woodchunk catalog. Rename to the real supplier.")
    await db.suppliers.insert_one(supplier.to_mongo())
    items, by_legacy = build_catalog(supplier.id)
    await db.catalog_items.insert_many([i.to_mongo() for i in items])
    await db.projects.insert_many([t.to_mongo() for t in build_templates(by_legacy)])
    await db.meta.update_one({"_id": "seed"}, {"$set": {"legacy_map": {k: v.id for k, v in by_legacy.items()},
                                                        "at": now()}}, upsert=True)

    s = get_settings()
    if s.auth_mode == "dev":
        for email in sorted(s.admin_email_set):
            user = User(id=f"dev-{email}", email=email, name=email.split("@")[0].title(), role=UserRole.admin)
            await db.users.update_one({"email": email}, {"$setOnInsert": user.to_mongo()}, upsert=True)
            projects = legacy_projects(user, by_legacy)
            if projects:
                await db.projects.insert_many([p.to_mongo() for p in projects])


async def import_legacy_for(db: AsyncDatabase, email: str) -> int:
    """Used by scripts/import_legacy.py for a real (Descope) user after their first sign-in."""
    meta = await db.meta.find_one({"_id": "seed"})
    udoc = await db.users.find_one({"email": email.lower()})
    if not meta or not udoc:
        raise RuntimeError("Run the app once and sign in first.")
    ids = meta["legacy_map"]
    items = {d["_id"]: CatalogItem.from_mongo(d) async for d in db.catalog_items.find({"_id": {"$in": list(ids.values())}})}
    by_legacy = {k: items[v] for k, v in ids.items() if v in items}
    projects = legacy_projects(User.from_mongo(udoc), by_legacy)
    if projects:
        await db.projects.insert_many([p.to_mongo() for p in projects])
    return len(projects)
