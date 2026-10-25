"""AI catalog import (extract items from a supplier page, price list or pasted text) and
organize (normalize names, fill Hebrew/English names, categories). Results are always
proposals reviewed by a person before they change the catalog."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from google.genai import types
from pydantic import Field

from app.models.catalog import CatalogItem, CatalogItemBase, ItemKind, LumberStock, SheetStock
from app.models.common import Doc, Localized, Model, now
from app.services.ai.client import get_ai

EXTRACT_SYSTEM = """You extract a woodworking supplier's products into structured catalog items.

Kinds:
- lumber: boards/beams sold by length. Give thickness_mm and width_mm of the cross-section
  (e.g. "22/100" or "2x4" means thickness 22 width 100 - the smaller number is thickness;
  convert inches: a 2x4 is 38×89 mm actual). Give price_per_m when a per-metre price is
  shown, and/or stock lengths with a price per length.
- sheet: plywood, MDF, OSB, melamine, sandwich panels. Give thickness_mm, sheet sizes in mm
  (length is the longer side) and price per sheet. has_grain is false for MDF, OSB,
  melamine and laminate, true for plywood and solid wood panels.
- hardware: screws, bolts, hinges, glue, finishes. Give price per pack and pack_size when
  sold in packs (e.g. box of 200 screws).

Rules: use millimetres and the page's currency amounts as numbers (no symbols).
name_en is a short, consistent English name like "100 × 44 pine, untreated",
"18 mm birch plywood", "Wood screw 5×50 mm". name_he is the Hebrew name (translate if the
page is English). material is lowercase (pine, spruce, birch plywood, mdf, osb, steel…),
treatment is lowercase (treated, untreated, planed, painted…) or empty.
Skip anything that is not a product. Do not invent prices or sizes that are not on the page."""


class ExtractedItem(Model):
    kind: Literal["lumber", "sheet", "hardware"]
    name_en: str
    name_he: str | None
    material: str | None
    treatment: str | None
    category: str | None
    sku: str | None
    url: str | None
    thickness_mm: float | None
    width_mm: float | None
    price_per_m: float | None
    stock_lengths_mm: list[float] | None
    stock_length_prices: list[float] | None = Field(description="Price per length, same order as stock_lengths_mm")
    sheet_lengths_mm: list[float] | None
    sheet_widths_mm: list[float] | None
    sheet_prices: list[float] | None
    has_grain: bool | None
    pack_size: int | None
    unit: str | None
    price: float | None


class Extraction(Model):
    supplier_name: str | None
    currency: str | None
    items: list[ExtractedItem]


class ImportProposalItem(Model):
    action: Literal["new", "update", "same"]
    match_id: str | None = None
    item: CatalogItemBase
    changes: list[str] = []
    selected: bool = True


class CatalogImport(Doc):
    created_by: str
    kind: Literal["import", "organize"] = "import"
    source: str = ""  # url, filename or "pasted text"
    supplier_id: str | None = None
    supplier_name: str = ""
    status: Literal["review", "applying", "applied", "discarded"] = "review"
    items: list[ImportProposalItem] = []
    note: str = ""
    created_at: datetime = Field(default_factory=now)


def to_catalog(e: ExtractedItem, supplier_id: str | None) -> CatalogItemBase | None:
    kind = ItemKind(e.kind)
    base = dict(kind=kind, supplier_id=supplier_id, name=Localized(en=e.name_en.strip(), he=(e.name_he or "").strip()),
                material=(e.material or "").lower(), treatment=(e.treatment or "").lower(),
                category=e.category or "", sku=e.sku or "", url=e.url or "")
    try:
        if kind == ItemKind.lumber:
            if not (e.thickness_mm and e.width_mm):
                return None
            t, w = sorted((e.thickness_mm, e.width_mm))
            lengths = e.stock_lengths_mm or []
            prices = e.stock_length_prices or []
            stock = [LumberStock(length_mm=L, price=prices[i] if i < len(prices) else None)
                     for i, L in enumerate(lengths) if L and L > 0]
            return CatalogItemBase(**base, thickness_mm=t, width_mm=w, price_per_m=e.price_per_m, lumber_stock=stock)
        if kind == ItemKind.sheet:
            Ls, Ws, Ps = e.sheet_lengths_mm or [], e.sheet_widths_mm or [], e.sheet_prices or []
            stock = []
            for i in range(min(len(Ls), len(Ws))):
                L, W = max(Ls[i], Ws[i]), min(Ls[i], Ws[i])
                stock.append(SheetStock(length_mm=L, width_mm=W, price=Ps[i] if i < len(Ps) else None))
            has_grain = e.has_grain if e.has_grain is not None else not any(
                m in (e.material or "").lower() for m in ("mdf", "osb", "melamine", "laminate"))
            return CatalogItemBase(**base, thickness_mm=e.thickness_mm, sheet_stock=stock, has_grain=has_grain)
        return CatalogItemBase(**base, unit=e.unit or "each", pack_size=max(1, e.pack_size or 1), price=e.price)
    except ValueError:
        return None


def _same_spec(a: CatalogItemBase, b: CatalogItem) -> bool:
    if a.kind != b.kind or (a.supplier_id or None) != (b.supplier_id or None):
        return False
    if a.kind == ItemKind.lumber:
        return (a.thickness_mm == b.thickness_mm and a.width_mm == b.width_mm and a.material == b.material
                and a.treatment == b.treatment)
    if a.kind == ItemKind.sheet:
        return a.thickness_mm == b.thickness_mm and a.material == b.material
    return a.name.en.strip().lower() == b.name.en.strip().lower() or (bool(a.sku) and a.sku == b.sku)


def diff_item(new: CatalogItemBase, old: CatalogItem) -> list[str]:
    changes = []
    if new.price_per_m is not None and new.price_per_m != old.price_per_m:
        changes.append(f"price/m {old.price_per_m} → {new.price_per_m}")
    if new.kind == ItemKind.lumber and new.lumber_stock:
        if sorted(s.length_mm for s in new.lumber_stock) != sorted(s.length_mm for s in old.lumber_stock):
            changes.append("stock lengths updated")
    if new.kind == ItemKind.sheet and new.sheet_stock:
        old_p = {(s.length_mm, s.width_mm): s.price for s in old.sheet_stock}
        for s in new.sheet_stock:
            if old_p.get((s.length_mm, s.width_mm)) != s.price:
                changes.append(f"{s.width_mm:g}×{s.length_mm:g} price {old_p.get((s.length_mm, s.width_mm))} → {s.price}")
    if new.kind == ItemKind.hardware and new.price is not None and new.price != old.price:
        changes.append(f"price {old.price} → {new.price}")
    if new.name.he and not old.name.he:
        changes.append("adds Hebrew name")
    return changes


def match_items(extracted: list[CatalogItemBase], existing: list[CatalogItem]) -> list[ImportProposalItem]:
    out = []
    for e in extracted:
        match = next((x for x in existing if _same_spec(e, x)), None)
        if match is None:
            out.append(ImportProposalItem(action="new", item=e))
        else:
            ch = diff_item(e, match)
            out.append(ImportProposalItem(action="update" if ch else "same", match_id=match.id, item=e, changes=ch,
                                          selected=bool(ch)))
    return out


async def extract(source_text: str | None, file_bytes: bytes | None = None, mime: str | None = None,
                  hint: str = "") -> Extraction:
    contents: list = []
    if file_bytes is not None and mime:
        contents.append(types.Part.from_bytes(data=file_bytes, mime_type=mime))
    if source_text:
        contents.append(f"SOURCE ({hint}):\n{source_text}")
    contents.append("Extract every product into catalog items.")
    result, _ = await get_ai().generate(Extraction, EXTRACT_SYSTEM, contents, what="catalog.import", temperature=0.1)
    return result


ORGANIZE_SYSTEM = """You tidy a woodworking catalog. For each item return improved fields:
- name_en: short consistent English name. Lumber: "{width} × {thickness} {material}, {treatment}"
  e.g. "100 × 44 pine, untreated". Sheets: "{thickness} mm {material}" e.g. "18 mm birch plywood".
  Hardware: what it is plus key size, e.g. "Wood screw 5×50 mm".
- name_he: natural Hebrew name a lumber yard would use.
- category: one of lumber, beams, boards, decking, plywood, mdf, osb, panels, screws, bolts,
  hinges, brackets, glue, finish, other.
- material / treatment: lowercase English (keep existing values when they are right).
- tags: up to 4 short lowercase tags (outdoor, indoor, structural, …).
Return every input id exactly once."""


class OrganizedItem(Model):
    id: str
    name_en: str
    name_he: str
    category: str
    material: str
    treatment: str
    tags: list[str]


class Organized(Model):
    items: list[OrganizedItem]


async def organize(items: list[CatalogItem]) -> Organized:
    lines = []
    for it in items:
        dims = (f"{it.width_mm:g}×{it.thickness_mm:g}" if it.kind == ItemKind.lumber and it.width_mm
                else f"{it.thickness_mm or ''} mm" if it.kind == ItemKind.sheet else "")
        lines.append(f"{it.id} | {it.kind} | en={it.name.en!r} | he={it.name.he!r} | material={it.material!r} | "
                     f"treatment={it.treatment!r} | category={it.category!r} | {dims}")
    result, _ = await get_ai().generate(Organized, ORGANIZE_SYSTEM, "ITEMS:\n" + "\n".join(lines),
                                        what="catalog.organize", temperature=0.1)
    return result


class Translation(Model):
    source: str
    text: str


class Translations(Model):
    items: list[Translation]


TRANSLATE_SYSTEM = """Translate short woodworking labels (assembly names, part names, hardware names)
into natural Hebrew as a carpenter would write them on a cut list. Keep numbers, sizes and
part labels like "A1" unchanged. Return every source string exactly once."""


async def translate_strings(strings: list[str], lang: str = "he") -> dict[str, str]:
    if not strings:
        return {}
    if lang != "he":
        return {s: s for s in strings}
    result, _ = await get_ai().generate(Translations, TRANSLATE_SYSTEM,
                                        "STRINGS:\n" + "\n".join(f"- {s}" for s in strings),
                                        what="translate", temperature=0.1)
    out = {t.source: t.text for t in result.items if t.source in strings and t.text}
    return out
