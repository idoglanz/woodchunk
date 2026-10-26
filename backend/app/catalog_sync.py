"""Keeps the shared catalog in step with its sources, at startup: Noyman's lumber and sheets
(seed_data/noyman.json, from their website) and the general-purpose steel sizes.

Each source is applied once per version of its data (a hash in `meta`), so later edits made in the
app stand until the source itself changes. Items keep their ids (projects point at them): a
Noyman product updates the item it replaced, prices that changed are added to the price history,
and items the source no longer has are retired, not deleted (projects that use them still show them).
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
from pathlib import Path

from pymongo.asynchronous.database import AsyncDatabase

from app.models.catalog import (
    CatalogItem,
    ItemKind,
    ItemStatus,
    LumberStock,
    PricePoint,
    ProfileSpec,
    SheetStock,
    Supplier,
)
from app.models.common import Localized, now

logger = logging.getLogger(__name__)
NOYMAN = Path(__file__).resolve().parent.parent / "seed_data" / "noyman.json"
LEGACY_SUPPLIER = "Original catalog yard"


async def _pending(db: AsyncDatabase, key: str, payload: object) -> str | None:
    """The data's hash if it hasn't been applied yet, else None."""
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    doc = await db.meta.find_one({"_id": key})
    return None if doc and doc.get("hash") == digest else digest


async def _applied(db: AsyncDatabase, key: str, digest: str) -> None:
    await db.meta.update_one({"_id": key}, {"$set": {"hash": digest, "at": now()}}, upsert=True)


async def _supplier(db: AsyncDatabase, names: list[str], name: str, url: str, notes: str) -> str:
    """The supplier's id, renaming an older entry (the first of `names` found) or creating it."""
    doc = await db.suppliers.find_one({"name": {"$in": names}})
    if doc:
        await db.suppliers.update_one({"_id": doc["_id"]}, {"$set": {"name": name, "url": url, "notes": notes}})
        return doc["_id"]
    supplier = Supplier(name=name, url=url, currency="ILS", notes=notes)
    await db.suppliers.insert_one(supplier.to_mongo())
    return supplier.id


def _main_price(item: CatalogItem) -> float | None:
    """The price the history follows: per metre for lumber, the largest sheet for sheets."""
    if item.kind == ItemKind.lumber:
        return item.price_per_m
    sheets = sorted(item.sheet_stock, key=lambda s: s.length_mm * s.width_mm)
    return sheets[-1].price if sheets else None


async def _upsert(db: AsyncDatabase, fresh: CatalogItem, existing: dict | None, note: str) -> str:
    """Write `fresh` over `existing` (keeping its id and history), or insert it."""
    price = _main_price(fresh)
    if existing is None:
        if price is not None:
            fresh.price_updated_at = now()
            fresh.price_history = [PricePoint(price=price, note=note)]
        fresh.refresh_search()
        await db.catalog_items.insert_one(fresh.to_mongo())
        return fresh.id
    old = CatalogItem.from_mongo(existing)
    keep = {"id", "created_by", "created_at", "price_history", "price_updated_at"}
    merged = CatalogItem.model_validate({**old.model_dump(include=keep), **fresh.model_dump(exclude=keep)})
    merged.status = ItemStatus.active
    if price is not None:
        # The history records changes; "updated" says the price was checked against the source.
        if price != _main_price(old) or merged.sheet_stock != old.sheet_stock or not old.price_history:
            merged.price_history = [*old.price_history, PricePoint(price=price, note=note)]
        merged.price_updated_at = now()
    merged.updated_at = now()
    merged.refresh_search()
    await db.catalog_items.replace_one({"_id": merged.id}, merged.to_mongo())
    return merged.id


def _noyman_item(row: dict, supplier_id: str) -> CatalogItem:
    common = dict(
        supplier_id=supplier_id, name=Localized(en=row["name_en"], he=row["name_he"]), sku=row["sku"], url=row["url"],
        image=row.get("image", ""), category=row["category"], tags=row["tags"], material=row["material"],
        treatment=row["treatment"], thickness_mm=row["thickness_mm"], source_url=row["url"],
    )
    if row["kind"] == "lumber":
        return CatalogItem(kind=ItemKind.lumber, width_mm=row["width_mm"], price_per_m=row["price_per_m"],
                           lumber_stock=[LumberStock(length_mm=round(m * 1000)) for m in row["lengths_m"]], **common)
    return CatalogItem(kind=ItemKind.sheet, has_grain=row["has_grain"],
                       sheet_stock=[SheetStock(**s) for s in row["sheet_stock"]], **common)


async def sync_noyman(db: AsyncDatabase) -> None:
    data = json.loads(NOYMAN.read_text())
    digest = await _pending(db, "catalog:noyman", data)
    if not digest:
        return
    logger.info("Updating the catalog from Noyman's price list (%s)", data["source_date"])
    sup = data["supplier"]
    sid = await _supplier(db, [sup["name"], LEGACY_SUPPLIER], sup["name"], sup["url"], sup["notes"])
    seed = await db.meta.find_one({"_id": "seed"}) or {}
    legacy_ids: dict[str, str] = seed.get("legacy_map", {})
    note = f"Noyman website {data['source_date']}"
    kept: list[str] = []
    for row in data["items"]:
        existing = await db.catalog_items.find_one({"supplier_id": sid, "sku": row["sku"]})
        for key in row["replaces"]:
            if existing:
                break
            if key in legacy_ids:
                existing = await db.catalog_items.find_one({"_id": legacy_ids[key]})
        kept.append(await _upsert(db, _noyman_item(row, sid), existing, note))
    retired = await db.catalog_items.update_many(
        {"supplier_id": sid, "_id": {"$nin": kept}, "status": {"$ne": ItemStatus.retired.value}},
        {"$set": {"status": ItemStatus.retired.value, "updated_at": now()}})
    logger.info("Noyman: %d items current, %d retired", len(kept), retired.modified_count)
    await _applied(db, "catalog:noyman", digest)


# --- steel: general-purpose sizes common in Israel, 6 m bars, in mm ------------------------------

STEEL_KG_PER_MM2_M = 0.00785  # density 7850 kg/m³: kg per metre for each mm² of section
STEEL_SUPPLIER = "Steel (typical sizes)"
STEEL_NOTES = "General-purpose sizes common in Israel, in 6 m bars, without prices: prices vary by yard, so price the ones you use."

# (shape, w, h, t)
STEEL = [
    *[("rect_tube", s, s, t) for s, t in [(20, 1.5), (20, 2), (25, 1.5), (25, 2), (30, 2), (30, 3), (35, 2), (40, 2), (40, 3),
                                          (50, 2), (50, 3), (60, 2), (60, 3), (70, 3), (80, 3), (100, 3), (100, 4)]],
    *[("rect_tube", w, h, t) for w, h, t in [(40, 20, 1.5), (40, 20, 2), (50, 25, 2), (50, 30, 2), (60, 30, 2), (60, 40, 2),
                                             (60, 40, 3), (80, 40, 2), (80, 40, 3), (100, 50, 3), (120, 60, 3)]],
    *[("angle", s, s, t) for s, t in [(20, 3), (25, 3), (30, 3), (40, 4), (50, 5), (60, 6)]],
    *[("flat_bar", w, t, 0) for w, t in [(20, 3), (25, 3), (30, 3), (30, 5), (40, 4), (40, 5), (50, 5), (60, 6)]],
    *[("round_tube", d, d, t) for d, t in [(20, 1.5), (25, 1.5), (25, 2), (32, 2), (38, 2), (42.4, 2), (48.3, 2.6), (60.3, 2.9)]],
    *[("round_bar", d, d, 0) for d in (8, 10, 12, 16, 20)],
    ("channel", 40, 20, 2), ("channel", 50, 25, 2),
]


def _steel_area(shape: str, w: float, h: float, t: float) -> float:
    if shape == "rect_tube":
        return w * h - (w - 2 * t) * (h - 2 * t)
    if shape == "round_tube":
        return math.pi / 4 * (w**2 - (w - 2 * t) ** 2)
    if shape == "round_bar":
        return math.pi / 4 * w**2
    if shape == "angle":
        return t * (w + h - t)
    if shape == "channel":
        return w * t + 2 * (h - t) * t
    return w * h


def _steel_name(shape: str, w: float, h: float, t: float) -> Localized:
    def f(x: float) -> str:
        return f"{x:g}"
    if shape == "rect_tube" and w == h:
        return Localized(en=f"{f(w)} × {f(h)} × {f(t)} square steel tube", he=f"פרופיל מרובע {f(w)}×{f(h)}×{f(t)}")
    if shape == "rect_tube":
        return Localized(en=f"{f(w)} × {f(h)} × {f(t)} rectangular steel tube", he=f"פרופיל מלבני {f(w)}×{f(h)}×{f(t)}")
    if shape == "angle":
        return Localized(en=f"{f(w)} × {f(h)} × {f(t)} steel angle", he=f"זווית ברזל {f(w)}×{f(h)}×{f(t)}")
    if shape == "flat_bar":
        return Localized(en=f"{f(w)} × {f(h)} flat steel bar", he=f"פס ברזל {f(w)}×{f(h)}")
    if shape == "round_tube":
        return Localized(en=f"{f(w)} × {f(t)} round steel tube", he=f"צינור עגול {f(w)}×{f(t)}")
    if shape == "round_bar":
        return Localized(en=f"{f(w)} mm round steel bar", he=f"ברזל עגול {f(w)} מ״מ")
    return Localized(en=f"{f(w)} × {f(h)} × {f(t)} steel channel", he=f"פרופיל U {f(w)}×{f(h)}×{f(t)}")


def build_steel(supplier_id: str) -> list[CatalogItem]:
    out = []
    for shape, w, h, t in STEEL:
        it = CatalogItem(
            kind=ItemKind.lumber, supplier_id=supplier_id, name=_steel_name(shape, w, h, t), category="Steel",
            material="steel", has_grain=False, width_mm=w, thickness_mm=h,
            profile=ProfileSpec(shape=shape, w=w, h=h, t=t),
            kg_per_m=round(_steel_area(shape, w, h, t) * STEEL_KG_PER_MM2_M, 2),
            lumber_stock=[LumberStock(length_mm=6000)], tags=["steel", "metal", shape.replace("_", " ")],
        )
        it.refresh_search()
        out.append(it)
    return out


async def sync_steel(db: AsyncDatabase) -> None:
    """Add sizes that are missing (matched by section) and retire ones no longer listed. Names,
    weights and tags follow the list; prices someone entered are kept."""
    digest = await _pending(db, "catalog:steel", STEEL)
    if not digest:
        return
    logger.info("Updating the steel sizes")
    sid = await _supplier(db, [STEEL_SUPPLIER], STEEL_SUPPLIER, "", STEEL_NOTES)
    have = {}
    async for doc in db.catalog_items.find({"supplier_id": sid}):
        p = doc.get("profile") or {}
        have[(p.get("shape"), float(p.get("w", 0)), float(p.get("h", 0)), float(p.get("t", 0)))] = doc
    kept = []
    for fresh in build_steel(sid):
        p = fresh.profile
        doc = have.get((p.shape, float(p.w), float(p.h), float(p.t)))
        if doc is None:
            await db.catalog_items.insert_one(fresh.to_mongo())
            kept.append(fresh.id)
            continue
        await db.catalog_items.update_one({"_id": doc["_id"]}, {"$set": {
            "name": fresh.name.model_dump(), "kg_per_m": fresh.kg_per_m, "tags": fresh.tags, "search": fresh.search,
            "status": ItemStatus.active.value, "updated_at": now()}})
        kept.append(doc["_id"])
    await db.catalog_items.update_many(
        {"supplier_id": sid, "_id": {"$nin": kept}, "status": {"$ne": ItemStatus.retired.value}},
        {"$set": {"status": ItemStatus.retired.value, "updated_at": now()}})
    await _applied(db, "catalog:steel", digest)
