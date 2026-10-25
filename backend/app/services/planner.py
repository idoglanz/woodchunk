"""Turn a project (plus the catalog and the owner's stock) into a cut plan.

The planner is pure: it receives everything it needs and returns a `PlanOut`. Each
material is optimized independently, in a worker thread, and whole plans are cached by
a hash of their inputs so repeated requests (and undo/redo back to a previous state)
are instant.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
from collections import OrderedDict, defaultdict
from collections.abc import Callable
from dataclasses import dataclass

from app.models.catalog import CatalogItem, ItemKind, Supplier
from app.models.common import now
from app.models.inventory import InventoryEntry
from app.models.plan import (
    BoardPattern,
    BuyLine,
    CutStep,
    HardwareTotal,
    LumberPlan,
    PlacedPart,
    PlanOut,
    Rect,
    Segment,
    SheetLayoutOut,
    SheetPlan,
    Totals,
    Unplaced,
)
from app.models.project import EndCutSpec, HardwareLine, Project
from app.services.optimizer.linear import LinearResult, LinearSettings, Piece, StockOption, optimize_linear
from app.services.optimizer.sheet import Panel, SheetOption, SheetResult, SheetSettings, optimize_sheets

Translate = Callable[[str], str]


@dataclass
class PlanInputs:
    project: Project
    items: dict[str, CatalogItem]
    suppliers: dict[str, Supplier]
    inventory: list[InventoryEntry]
    lang: str = "en"
    translate: Translate | None = None

    def t(self, text: str) -> str:
        return self.translate(text) if self.translate and text else text


def fmt_len(mm: float) -> str:
    return f"{mm / 1000:.1f} m" if mm >= 1000 else f"{mm:g} mm"


def input_hash(inp: PlanInputs) -> str:
    p = inp.project
    used_items = sorted({pt.item_id for a in p.assemblies for pt in a.parts if pt.item_id}
                        | {h.item_id for a in p.assemblies for h in a.hardware if h.item_id}
                        | {h.item_id for h in p.extras if h.item_id})
    payload = {
        "v": 3,
        "lang": inp.lang,
        "settings": p.settings.model_dump(mode="json"),
        "assemblies": [a.model_dump(mode="json") for a in p.assemblies],
        "extras": [h.model_dump(mode="json") for h in p.extras],
        "purchase": p.purchase.model_dump(mode="json") if p.purchase else None,
        "items": [inp.items[i].model_dump(mode="json", exclude={"search"}) for i in used_items if i in inp.items],
        "inventory": [e.model_dump(mode="json") for e in inp.inventory if e.item_id in used_items],
        "tr": [inp.t(x) for x in sorted({pt.name for a in p.assemblies for pt in a.parts})] if inp.translate else [],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:24]


# --------------------------------------------------------------------- lumber


def _lumber_options(inp: PlanInputs, item: CatalogItem) -> tuple[list[StockOption], bool]:
    """Stock options for one lumber item. Returns (options, prices_known)."""
    s = inp.project.settings
    opts: list[StockOption] = []
    known = True
    for st in sorted(item.lumber_stock, key=lambda x: x.length_mm):
        if s.max_stock_length_mm and st.length_mm > s.max_stock_length_mm + 0.5:
            continue
        price = item.stock_price(st.length_mm)
        if price is None:
            known = False
            price = st.length_mm / 1000  # relative cost so the optimizer still prefers less wood
        opts.append(StockOption(key=f"buy:{st.length_mm:g}", length=st.length_mm, price=price))
    if s.use_inventory:
        for e in inp.inventory:
            if e.item_id == item.id and e.status == "available":
                opts.append(StockOption(key=f"inv:{e.id}", length=e.length_mm, price=0.0,
                                        available=e.qty, source="inventory", ref=e.id))
    if inp.project.purchase:
        bought: dict[float, int] = defaultdict(int)
        for ln in inp.project.purchase.lines:
            if ln.item_id == item.id and ln.kind == "lumber" and ln.length_mm:
                bought[ln.length_mm] += int(ln.qty)
        for length, qty in bought.items():
            opts.append(StockOption(key=f"pur:{length:g}", length=length, price=0.0, available=qty,
                                    source="purchased"))
    return opts, known


def angle_allowance(cuts: list[EndCutSpec], kerf: float) -> tuple[float, float]:
    """Extra bar each end of a piece uses: an angled cut removes kerf / cos(angle) along the bar."""
    out = []
    for i in range(2):
        e = cuts[i] if i < len(cuts) else None
        if not e or (not e.miter and not e.bevel):
            out.append(0.0)
            continue
        cos = max(0.1, math.cos(math.radians(e.miter)) * math.cos(math.radians(e.bevel)))
        out.append(round(kerf * (1 / cos - 1), 2))
    return out[0], out[1]


def _plan_lumber(inp: PlanInputs, item: CatalogItem, pieces: list[Piece], meta: dict[str, dict]):
    s = inp.project.settings
    opts, prices_known = _lumber_options(inp, item)
    settings = LinearSettings(kerf=s.kerf_lumber_mm, end_trim=s.end_trim_mm, min_offcut=s.min_offcut_mm,
                              time_limit=2.0)
    res: LinearResult = optimize_linear(pieces, opts, settings)

    # Group identical boards into patterns.
    groups: OrderedDict[tuple, list] = OrderedDict()
    for b in sorted(res.boards, key=lambda b: (-b.stock.length, b.stock.source, -b.used)):
        sig = (b.stock.length, b.stock.source, tuple((c.piece.label, c.piece.length) for c in b.cuts))
        groups.setdefault(sig, []).append(b)
    patterns = []
    for (length, source, _), boards in groups.items():
        b = boards[0]
        segs = []
        for c in b.cuts:
            m = meta[c.piece.part_id]
            # The piece's footprint includes its angle allowance; draw the part itself inside it.
            segs.append(Segment(kind="part", start=c.start + m["allow"][0], length=m["lp"], label=c.piece.label,
                                name=m["name"], part_id=c.piece.part_id, assembly=m["assembly"], cuts=m["cuts"]))
        last_end = (b.cuts[-1].start + b.cuts[-1].piece.length) if b.cuts else s.end_trim_mm
        if b.leftover > 0:
            segs.append(Segment(kind="offcut" if b.is_offcut else "waste", start=last_end + s.kerf_lumber_mm,
                                length=b.leftover))
        patterns.append(BoardPattern(stock_length=length, source=source, count=len(boards), segments=segs,
                                     leftover=b.leftover, leftover_kept=b.is_offcut))

    buy: dict[tuple, int] = defaultdict(int)
    for b in res.boards:
        buy[(b.stock.length, b.stock.source)] += 1
    buy_lines = [
        BuyLine(length_mm=length, qty=q, source=src,
                unit_price=(item.stock_price(length) if src == "buy" else 0.0))
        for (length, src), q in sorted(buy.items(), key=lambda kv: (kv[0][1] != "buy", -kv[0][0]))
    ]
    cost = sum((ln.unit_price or 0) * ln.qty for ln in buy_lines if ln.source == "buy")
    stock_len = res.stock_length
    allowance = sum(sum(meta[c.piece.part_id]["allow"]) for b in res.boards for c in b.cuts)
    plan = LumberPlan(
        item_id=item.id, name=item.display_name(inp.lang),
        supplier_name=inp.suppliers[item.supplier_id].name if item.supplier_id in inp.suppliers else "",
        kerf=s.kerf_lumber_mm, cost=round(cost, 2),
        waste_pct=round(100 * (res.waste + allowance) / stock_len, 1) if stock_len else 0.0,
        optimal=res.optimal, longest_stock=max((o.length for o in opts), default=0.0),
        buy=buy_lines, patterns=patterns,
    )
    longest = max((o.length for o in opts), default=0.0) - s.end_trim_mm
    unplaced = []
    for pc in res.unplaced:
        if not opts:
            reason = (f"No {item.display_name(inp.lang)} boards within your {fmt_len(s.max_stock_length_mm)} "
                      "carry limit." if s.max_stock_length_mm else "This material has no stock lengths.")
        else:
            reason = (f"{pc.label} is {meta[pc.part_id]['lp']:g} mm but the longest usable board is {longest:g} mm"
                      + (f" (carry limit {fmt_len(s.max_stock_length_mm)})." if s.max_stock_length_mm else "."))
        unplaced.append(Unplaced(part_id=pc.part_id, label=pc.label, name=meta[pc.part_id]["name"],
                                 item_id=item.id, reason=reason))
    leftovers = [b.leftover for b in res.boards if b.is_offcut]
    return plan, unplaced, prices_known, leftovers, res


# --------------------------------------------------------------------- sheets


def _sheet_options(inp: PlanInputs, item: CatalogItem) -> tuple[list[SheetOption], bool]:
    opts: list[SheetOption] = []
    known = True
    for st in item.sheet_stock:
        price = st.price
        if price is None:
            known = False
            price = st.length_mm * st.width_mm / 1e6
        opts.append(SheetOption(key=f"buy:{st.length_mm:g}x{st.width_mm:g}", length=st.length_mm,
                                width=st.width_mm, price=price, has_grain=item.has_grain))
    if inp.project.settings.use_inventory:
        for e in inp.inventory:
            if e.item_id == item.id and e.status == "available" and e.width_mm:
                opts.append(SheetOption(key=f"inv:{e.id}", length=e.length_mm, width=e.width_mm, price=0.0,
                                        available=e.qty, has_grain=item.has_grain, source="inventory", ref=e.id))
    if inp.project.purchase:
        bought: dict[tuple, int] = defaultdict(int)
        for ln in inp.project.purchase.lines:
            if ln.item_id == item.id and ln.kind == "sheet" and ln.length_mm and ln.width_mm:
                bought[(ln.length_mm, ln.width_mm)] += int(ln.qty)
        for (L, W), q in bought.items():
            opts.append(SheetOption(key=f"pur:{L:g}x{W:g}", length=L, width=W, price=0.0, available=q,
                                    has_grain=item.has_grain, source="purchased"))
    return opts, known


def _sheet_price(item: CatalogItem, L: float, W: float) -> float | None:
    for st in item.sheet_stock:
        if abs(st.length_mm - L) < 0.5 and abs(st.width_mm - W) < 0.5:
            return st.price
    return None


def _plan_sheets(inp: PlanInputs, item: CatalogItem, panels: list[Panel], meta: dict[str, dict]):
    s = inp.project.settings
    opts, prices_known = _sheet_options(inp, item)
    settings = SheetSettings(kerf=s.kerf_sheet_mm, edge_trim=s.edge_trim_mm, allow_rotation=s.allow_rotation,
                             min_offcut=s.min_offcut_sheet_mm, time_limit=1.0)
    res: SheetResult = optimize_sheets(panels, opts, settings)
    layouts = []
    buy: dict[tuple, int] = defaultdict(int)
    for sh in sorted(res.sheets, key=lambda x: (x.option.source != "inventory", -x.used_area)):
        o = sh.option
        buy[(o.length, o.width, o.source)] += 1
        parts = []
        for pl in sh.placements:
            m = meta[pl.panel.part_id]
            parts.append(PlacedPart(label=pl.panel.label, name=m["name"], part_id=pl.panel.part_id,
                                    assembly=m["assembly"], x=pl.rect.x, y=pl.rect.y, w=pl.rect.w, h=pl.rect.h,
                                    rotated=pl.rotated))
        cuts = []
        for n, c in enumerate(sh.cuts, start=1):
            p = c.piece
            if c.axis == "x":
                x1, y1, x2, y2 = p.x, c.at, p.x + p.w, c.at
            else:
                x1, y1, x2, y2 = c.at, p.y, c.at, p.y + p.h
            cuts.append(CutStep(n=n, kind="rip" if c.axis == "x" else "crosscut", offset=round(c.offset, 1),
                                piece_w=p.w, piece_h=p.h, x1=x1, y1=y1, x2=x2, y2=y2))
        offcuts = [Rect(x=r.x, y=r.y, w=r.w, h=r.h) for r in sh.offcuts(settings.min_offcut)]
        layouts.append(SheetLayoutOut(
            length=o.length, width=o.width, source=o.source,
            unit_price=_sheet_price(item, o.length, o.width) if o.source == "buy" else 0.0,
            parts=parts, offcuts=offcuts, cuts=cuts,
            used_pct=round(100 * sh.used_area / (o.length * o.width), 1),
        ))
    buy_lines = [
        BuyLine(length_mm=L, width_mm=W, qty=q, source=src,
                unit_price=_sheet_price(item, L, W) if src == "buy" else 0.0)
        for (L, W, src), q in sorted(buy.items(), key=lambda kv: (kv[0][2] != "buy", -kv[0][0] * kv[0][1]))
    ]
    cost = sum((ln.unit_price or 0) * ln.qty for ln in buy_lines if ln.source == "buy")
    area = res.sheet_area
    waste = area - res.used_area - res.offcut_area
    plan = SheetPlan(
        item_id=item.id, name=item.display_name(inp.lang),
        supplier_name=inp.suppliers[item.supplier_id].name if item.supplier_id in inp.suppliers else "",
        thickness_mm=item.thickness_mm, has_grain=item.has_grain, kerf=s.kerf_sheet_mm,
        edge_trim=s.edge_trim_mm, cost=round(cost, 2),
        waste_pct=round(100 * waste / area, 1) if area else 0.0, buy=buy_lines, layouts=layouts,
    )
    unplaced = []
    for pn in res.unplaced:
        if not opts:
            reason = "This sheet material has no sheet sizes in the catalog."
        else:
            biggest = max(opts, key=lambda o: o.length * o.width)
            grain = " and it is grain-locked" if pn.grain_locked and item.has_grain else ""
            reason = (f"{pn.label} is {pn.length:g} × {pn.width:g} mm{grain}; the largest usable sheet is "
                      f"{biggest.length - 2 * s.edge_trim_mm:g} × {biggest.width - 2 * s.edge_trim_mm:g} mm.")
        unplaced.append(Unplaced(part_id=pn.part_id, label=pn.label, name=meta[pn.part_id]["name"],
                                 item_id=item.id, reason=reason))
    offcut_count = sum(len(lo.offcuts) for lo in layouts)
    return plan, unplaced, prices_known, offcut_count, res


# --------------------------------------------------------------------- hardware


def hardware_totals(inp: PlanInputs) -> list[HardwareTotal]:
    p = inp.project
    acc: OrderedDict[str, dict] = OrderedDict()

    def add(line: HardwareLine, mult: int, letter: str):
        item = inp.items.get(line.item_id) if line.item_id else None
        name = item.display_name(inp.lang) if item else inp.t(line.name.strip())
        if not name or line.qty <= 0:
            return
        key = f"item:{line.item_id}" if item else f"name:{line.name.strip().lower()}"
        e = acc.setdefault(key, {"item": item, "name": name, "qty": 0.0, "price": None, "assemblies": []})
        e["qty"] += line.qty * mult
        if line.unit_price is not None:
            e["price"] = line.unit_price
        if letter and letter not in e["assemblies"]:
            e["assemblies"].append(letter)

    for a in p.assemblies:
        for h in a.hardware:
            add(h, a.qty, a.letter)
    for h in p.extras:
        add(h, 1, "")

    out = []
    for key, e in acc.items():
        item: CatalogItem | None = e["item"]
        pack = item.pack_size if item else 1
        price = e["price"] if e["price"] is not None else (item.price if item else None)
        packs = math.ceil(e["qty"] / pack - 1e-9) if pack > 1 else None
        total = None if price is None else round(price * (packs if packs is not None else e["qty"]), 2)
        out.append(HardwareTotal(key=key, item_id=item.id if item else None, name=e["name"], qty=e["qty"],
                                 packs=packs, pack_size=pack, unit=item.unit if item else "each",
                                 unit_price=price, total=total, assemblies=e["assemblies"]))
    return out


# --------------------------------------------------------------------- whole plan


_cache: OrderedDict[str, PlanOut] = OrderedDict()
_CACHE_SIZE = 256


def clear_cache() -> None:
    _cache.clear()


async def compute_plan(inp: PlanInputs) -> PlanOut:
    h = input_hash(inp)
    if h in _cache:
        _cache.move_to_end(h)
        return _cache[h]
    plan = await _compute_async(inp, h)
    _cache[h] = plan
    if len(_cache) > _CACHE_SIZE:
        _cache.popitem(last=False)
    return plan


MAX_PIECES = 5000  # pieces per plan; beyond this the optimizer would take too long (and memory)


async def _compute_async(inp: PlanInputs, h: str) -> PlanOut:
    p = inp.project
    labels = p.part_labels()
    meta: dict[str, dict] = {}
    lumber_pieces: dict[str, list[Piece]] = defaultdict(list)
    sheet_panels: dict[str, list[Panel]] = defaultdict(list)
    unplaced: list[Unplaced] = []
    warnings: list[str] = []
    part_count = 0
    budget = MAX_PIECES

    for a in p.assemblies:
        for pt in a.parts:
            label = labels[pt.id]
            allow = angle_allowance(pt.cuts, p.settings.kerf_lumber_mm)
            meta[pt.id] = {"name": inp.t(pt.name) or label, "assembly": a.letter, "lp": pt.length_mm,
                           "cuts": pt.cuts, "allow": allow}
            n = pt.qty * a.qty
            part_count += n
            item = inp.items.get(pt.item_id) if pt.item_id else None
            if item is None:
                unplaced.append(Unplaced(part_id=pt.id, label=label, name=meta[pt.id]["name"], item_id=pt.item_id,
                                         reason="Choose a material for this part."))
                continue
            if item.status == "retired":
                warnings.append(f"{label} uses {item.display_name('en')}, which is no longer in the catalog.")
            if pt.length_mm <= 0:
                unplaced.append(Unplaced(part_id=pt.id, label=label, name=meta[pt.id]["name"], item_id=item.id,
                                         reason="Enter a length."))
                continue
            if item.kind in (ItemKind.lumber, ItemKind.sheet):
                if n > budget:
                    unplaced.append(Unplaced(part_id=pt.id, label=label, name=meta[pt.id]["name"], item_id=item.id,
                                             reason=f"Too many pieces to plan at once (the limit is {MAX_PIECES}). "
                                                    "Lower the quantity or split the project."))
                    continue
                budget -= n
            if item.kind == ItemKind.lumber:
                for i in range(n):
                    lumber_pieces[item.id].append(Piece(key=f"{pt.id}#{i}", label=label,
                                                        length=pt.length_mm + sum(allow), part_id=pt.id))
                too_far = [e for e in pt.cuts if e.miter > p.settings.max_miter_deg + 0.05
                           or e.bevel > p.settings.max_bevel_deg + 0.05]
                if too_far:
                    e = too_far[0]
                    over = (f"a {e.miter:g}° miter (your saw: {p.settings.max_miter_deg:g}°)"
                            if e.miter > p.settings.max_miter_deg + 0.05
                            else f"a {e.bevel:g}° bevel (your saw: {p.settings.max_bevel_deg:g}°)")
                    warnings.append(f"{label} needs {over}. Cut it by hand or change the joint.")
            elif item.kind == ItemKind.sheet:
                if not pt.width_mm:
                    unplaced.append(Unplaced(part_id=pt.id, label=label, name=meta[pt.id]["name"],
                                             item_id=item.id, reason="Enter a width for this panel."))
                    continue
                for i in range(n):
                    sheet_panels[item.id].append(Panel(key=f"{pt.id}#{i}", label=label, length=pt.length_mm,
                                                       width=pt.width_mm, grain_locked=pt.grain_locked,
                                                       part_id=pt.id))
            else:
                unplaced.append(Unplaced(part_id=pt.id, label=label, name=meta[pt.id]["name"], item_id=item.id,
                                         reason="Hardware can't be cut; add it under hardware instead."))

    lumber_jobs = [asyncio.to_thread(_plan_lumber, inp, inp.items[iid], pcs, meta)
                   for iid, pcs in lumber_pieces.items()]
    sheet_jobs = [asyncio.to_thread(_plan_sheets, inp, inp.items[iid], pns, meta)
                  for iid, pns in sheet_panels.items()]
    lumber_results = await asyncio.gather(*lumber_jobs)
    sheet_results = await asyncio.gather(*sheet_jobs)

    lumber_plans, sheet_plans = [], []
    offcuts = 0
    weighted_waste, weight = 0.0, 0.0
    from_inventory = 0
    def gross(item_id: str, lines, sheet: bool) -> float:
        # Weight each material's waste by what its stock is worth, whoever paid for it.
        it = inp.items[item_id]
        if sheet:
            return sum((_sheet_price(it, b.length_mm, b.width_mm or 0) or 0) * b.qty for b in lines)
        return sum((it.stock_price(b.length_mm) or 0) * b.qty for b in lines)

    for plan, unp, known, leftovers, _res in lumber_results:
        lumber_plans.append(plan)
        unplaced.extend(unp)
        offcuts += len(leftovers)
        plan.priced = known
        if not known:
            warnings.append(f"Some lengths of {plan.name} have no price; its cost is incomplete.")
        w = gross(plan.item_id, plan.buy, False) or 1.0
        weighted_waste += plan.waste_pct * w
        weight += w
        from_inventory += sum(b.qty for b in plan.buy if b.source == "inventory")
    for plan, unp, known, n_off, _res in sheet_results:
        sheet_plans.append(plan)
        unplaced.extend(unp)
        offcuts += n_off
        plan.priced = known
        if not known:
            warnings.append(f"Some sizes of {plan.name} have no price; its cost is incomplete.")
        w = gross(plan.item_id, plan.buy, True) or 1.0
        weighted_waste += plan.waste_pct * w
        weight += w
        from_inventory += sum(b.qty for b in plan.buy if b.source == "inventory")

    hardware = hardware_totals(inp)
    unpriced = sum(1 for hw in hardware if hw.total is None)
    if unpriced:
        warnings.append(f"{unpriced} hardware line{'s' if unpriced > 1 else ''} without a price.")

    lumber_cost = sum(pl.cost for pl in lumber_plans)
    sheet_cost = sum(pl.cost for pl in sheet_plans)
    hardware_cost = sum(hw.total or 0 for hw in hardware)
    purchased_value = 0.0
    if p.purchase:
        purchased_value = sum((ln.unit_price or 0) * ln.qty for ln in p.purchase.lines if ln.kind != "hardware")

    currency = "ILS"
    for iid in list(lumber_pieces) + list(sheet_panels):
        sup = inp.suppliers.get(inp.items[iid].supplier_id or "")
        if sup:
            currency = sup.currency
            break

    totals = Totals(
        cost=round(lumber_cost + sheet_cost + hardware_cost + purchased_value, 2),
        lumber_cost=round(lumber_cost, 2), sheet_cost=round(sheet_cost, 2), hardware_cost=round(hardware_cost, 2),
        unpriced_lines=unpriced,
        unpriced_materials=sum(1 for pl in [*lumber_plans, *sheet_plans] if not pl.priced),
        boards=sum(b.qty for pl in lumber_plans for b in pl.buy if b.source != "inventory"),
        sheets=sum(b.qty for pl in sheet_plans for b in pl.buy if b.source != "inventory"),
        from_inventory=from_inventory,
        waste_pct=round(weighted_waste / weight, 1) if weight else 0.0,
        parts=part_count, offcuts=offcuts,
    )
    lumber_plans.sort(key=lambda x: -x.cost)
    sheet_plans.sort(key=lambda x: -x.cost)
    return PlanOut(project_id=p.id, computed_at=now(), input_hash=h, currency=currency, totals=totals,
                   lumber=lumber_plans, sheets=sheet_plans, hardware=hardware, unplaced=unplaced,
                   warnings=warnings)
