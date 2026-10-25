"""AI (and import) proposals: a list of edit operations applied to a project only when
the user presses Apply. Operations are validated against the real catalog here, so a
model that invents an item id or a negative length cannot corrupt a project."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.models.catalog import CatalogItem, ItemKind
from app.models.common import Doc, Model, now
from app.models.project import Assembly, HardwareLine, Part, ProjectContent

Action = Literal[
    "add_assembly", "update_assembly", "remove_assembly",
    "add_part", "update_part", "remove_part",
    "add_hardware", "update_hardware", "remove_hardware",
]


class AIOp(Model):
    """One edit. Flat on purpose: it is also the schema the model fills in."""

    action: Action
    assembly: str = Field(description='Existing assembly letter ("A"), "EXTRAS" for project-level hardware, '
                                      'or a new key like "NEW1" for an assembly added in this same answer.')
    name: str | None = Field(description="Assembly, part or hardware name (English).")
    qty: int | None = Field(description="Assembly quantity, part quantity per assembly, or hardware quantity.")
    target: str | None = Field(description='For update/remove: the part label ("B2") or hardware name.')
    item_id: str | None = Field(description="Catalog item id, copied exactly from the catalog list.")
    length_mm: float | None = Field(description="Part length in mm (along the grain for sheet parts).")
    width_mm: float | None = Field(description="Sheet parts only: width in mm.")
    grain_locked: bool | None = Field(description="Sheet parts only: true when the grain must run along the length.")
    unit_price: float | None = Field(description="Hardware not in the catalog: price per unit if known.")


def _qty(v: float | None, lo: int = 1) -> int:
    """AI numbers are suggestions: keep them inside what the models accept."""
    return int(min(10_000, max(lo, round(v or lo))))


def _mm(v: float | None) -> float:
    return float(min(100_000.0, max(0.0, v or 0.0)))


def _drawn(op, a, labels) -> bool:
    """Does this part op touch an assembly drawn in 3D?"""
    if op.action == "add_part":
        return bool(a and a.frame)
    hit = labels().get((op.target or "").strip().upper())
    return bool(hit and hit[0].frame)


class DiffLine(Model):
    kind: Literal["add", "change", "remove", "note"]
    text: str


class Proposal(Doc):
    project_id: str
    user_id: str
    source: Literal["chat", "spreadsheet"] = "chat"
    base_version: int
    summary: str = ""
    ops: list[AIOp] = []
    diff: list[DiffLine] = []
    cost_before: float | None = None
    cost_after: float | None = None
    status: Literal["pending", "applied", "discarded", "stale"] = "pending"
    created_at: datetime = Field(default_factory=now)


def describe_item(item: CatalogItem | None) -> str:
    return item.display_name("en") if item else "no material"


def _fmt_part(label: str, p: Part, item: CatalogItem | None) -> str:
    dims = f"{p.length_mm:g}" + (f" × {p.width_mm:g}" if p.width_mm else "") + " mm"
    return f"{label} {p.name or 'Part'} · {describe_item(item)} · ×{p.qty} · {dims}"


def apply_ops(
    content: ProjectContent, ops: list[AIOp], items: dict[str, CatalogItem]
) -> tuple[ProjectContent, list[DiffLine]]:
    """Return a new content with `ops` applied, plus a human-readable diff."""
    c = content.model_copy(deep=True)
    diff: list[DiffLine] = []
    new_keys: dict[str, Assembly] = {}

    def find_assembly(key: str) -> Assembly | None:
        k = (key or "").strip().upper()
        if k in new_keys:
            return new_keys[k]
        return next((a for a in c.assemblies if a.letter.upper() == k), None)

    def labels() -> dict[str, tuple[Assembly, Part]]:
        out = {}
        for a in c.assemblies:
            for i, p in enumerate(a.parts):
                out[f"{a.letter}{i + 1}".upper()] = (a, p)
        return out

    def valid_item(item_id: str | None, kinds: set[ItemKind]) -> str | None:
        if item_id and item_id in items and items[item_id].kind in kinds and items[item_id].status != "retired":
            return item_id
        return None

    def ensure_letters() -> None:
        # Re-run letter assignment for new assemblies.
        nonlocal c
        c = ProjectContent.model_validate(c.model_dump())
        for k, a in list(new_keys.items()):
            match = next((x for x in c.assemblies if x.id == a.id), None)
            if match:
                new_keys[k] = match

    cuttable = {ItemKind.lumber, ItemKind.sheet}
    for op in ops:
        a = find_assembly(op.assembly) if op.assembly.upper() != "EXTRAS" else None
        if op.action == "add_assembly":
            asm = Assembly(name=(op.name or "Assembly").strip()[:120], qty=_qty(op.qty))
            c.assemblies.append(asm)
            new_keys[op.assembly.strip().upper()] = asm
            ensure_letters()
            asm = new_keys[op.assembly.strip().upper()]
            diff.append(DiffLine(kind="add", text=f"Assembly {asm.letter} {asm.name} ×{asm.qty}"))
        elif op.action == "update_assembly" and a:
            changes = []
            if op.name and op.name != a.name:
                changes.append(f"rename to {op.name}")
                a.name = op.name
            if op.qty and _qty(op.qty) != a.qty:
                changes.append(f"×{a.qty} → ×{_qty(op.qty)}")
                a.qty = _qty(op.qty)
            if changes:
                diff.append(DiffLine(kind="change", text=f"Assembly {a.letter} {a.name}: {', '.join(changes)}"))
        elif op.action == "remove_assembly" and a:
            c.assemblies = [x for x in c.assemblies if x.id != a.id]
            diff.append(DiffLine(kind="remove", text=f"Assembly {a.letter} {a.name}"))
        elif op.action in ("add_part", "update_part", "remove_part") and _drawn(op, a, labels):
            # A drawn assembly's parts come from its 3D frame; the AI can't edit them directly.
            asm_name = a.name if a else op.target
            diff.append(DiffLine(kind="note", text=f"{asm_name} is drawn in 3D: change its bars in the 3D view."))
        elif op.action == "add_part" and a:
            item_id = valid_item(op.item_id, cuttable)
            item = items.get(item_id) if item_id else None
            is_sheet = item is not None and item.kind == ItemKind.sheet
            part = Part(
                name=(op.name or "Part").strip()[:120], item_id=item_id, qty=_qty(op.qty),
                length_mm=_mm(op.length_mm),
                width_mm=(_mm(op.width_mm) if op.width_mm else None) if is_sheet else None,
                grain_locked=bool(op.grain_locked) if is_sheet else False,
            )
            a.parts.append(part)
            diff.append(DiffLine(kind="add", text=_fmt_part(f"{a.letter}{len(a.parts)}", part, item)))
            if op.item_id and not item_id:
                diff.append(DiffLine(kind="note", text=f"{a.letter}{len(a.parts)}: pick a material, the "
                                                        "suggested one is not in the catalog."))
        elif op.action in ("update_part", "remove_part"):
            hit = labels().get((op.target or "").strip().upper())
            if not hit:
                continue
            asm, part = hit
            label = f"{asm.letter}{asm.parts.index(part) + 1}"
            if op.action == "remove_part":
                asm.parts = [p for p in asm.parts if p.id != part.id]
                diff.append(DiffLine(kind="remove", text=f"{label} {part.name}"))
                continue
            before = _fmt_part(label, part, items.get(part.item_id or ""))
            if op.name:
                part.name = op.name.strip()
            if op.qty:
                part.qty = _qty(op.qty)
            if op.length_mm:
                part.length_mm = _mm(op.length_mm)
            new_item = valid_item(op.item_id, cuttable)
            if new_item:
                part.item_id = new_item
            item = items.get(part.item_id or "")
            if item is not None and item.kind == ItemKind.sheet:
                if op.width_mm:
                    part.width_mm = _mm(op.width_mm)
                if op.grain_locked is not None:
                    part.grain_locked = op.grain_locked
            else:
                part.width_mm = None
                part.grain_locked = False
            after = _fmt_part(label, part, item)
            if after != before:
                diff.append(DiffLine(kind="change", text=after))
        elif op.action in ("add_hardware", "update_hardware", "remove_hardware"):
            target_list = c.extras if op.assembly.upper() == "EXTRAS" or a is None else a.hardware
            where = "Extras" if target_list is c.extras else f"{a.letter} {a.name}"
            if op.action == "add_hardware":
                item_id = valid_item(op.item_id, {ItemKind.hardware})
                item = items.get(item_id) if item_id else None
                line = HardwareLine(item_id=item_id, name=(op.name or (item.name.en if item else "Hardware")).strip(),
                                    qty=min(1e6, max(0, op.qty or 1)),
                                    unit_price=max(0.0, op.unit_price) if op.unit_price is not None and not item_id else None)
                target_list.append(line)
                diff.append(DiffLine(kind="add", text=f"{where}: {item.name.en if item else line.name} ×{line.qty:g}"))
            else:
                key = (op.target or op.name or "").strip().lower()
                line = next((h for h in target_list if h.name.lower() == key
                             or (h.item_id and items.get(h.item_id) and items[h.item_id].name.en.lower() == key)),
                            None)
                if not line:
                    continue
                if op.action == "remove_hardware":
                    target_list.remove(line)
                    diff.append(DiffLine(kind="remove", text=f"{where}: {line.name}"))
                else:
                    if op.qty is not None:
                        line.qty = min(1e6, max(0, op.qty))
                    if op.unit_price is not None:
                        line.unit_price = max(0.0, op.unit_price)
                    diff.append(DiffLine(kind="change", text=f"{where}: {line.name} ×{line.qty:g}"))
    return ProjectContent.model_validate(c.model_dump()), diff
