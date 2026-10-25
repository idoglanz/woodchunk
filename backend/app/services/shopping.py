"""Shopping list: what to buy, grouped by supplier, from a computed plan."""

from __future__ import annotations

from collections import OrderedDict, defaultdict

from app.models.catalog import CatalogItem, Supplier
from app.models.plan import PlanOut, ShoppingGroup, ShoppingLine, ShoppingOut, Suggestion
from app.models.project import Project, Purchase, PurchaseLine

WORDS = {
    "en": {"other": "Other", "box": "box of {n}", "each": "each", "sheet": "sheet", "m": "m"},
    "he": {"other": "אחר", "box": "אריזה של {n}", "each": "יחידה", "sheet": "לוח", "m": "מ׳"},
}


def _w(lang: str, key: str, **kw) -> str:
    return WORDS.get(lang, WORDS["en"])[key].format(**kw)


def length_label(mm: float, lang: str) -> str:
    return f"{mm / 1000:.1f} {_w(lang, 'm')}"


def build_lines(plan: PlanOut, project: Project, items: dict[str, CatalogItem], lang: str) -> list[ShoppingLine]:
    """Every line still to buy. Purchased stock is free in the plan, so after "Mark as
    bought" only additional boards/sheets appear; hardware subtracts what was bought."""
    checked = set(project.shopping_checked)
    lines: list[ShoppingLine] = []
    for lp in plan.lumber:
        for b in lp.buy:
            if b.source != "buy":
                continue
            key = f"lumber:{lp.item_id}:{b.length_mm:g}"
            total = None if b.unit_price is None else round(b.unit_price * b.qty, 2)
            lines.append(ShoppingLine(key=key, kind="lumber", item_id=lp.item_id, name=lp.name,
                                      detail=length_label(b.length_mm, lang), qty=b.qty, unit_price=b.unit_price,
                                      total=total, checked=key in checked))
    for sp in plan.sheets:
        for b in sp.buy:
            if b.source != "buy":
                continue
            key = f"sheet:{sp.item_id}:{b.length_mm:g}x{b.width_mm:g}"
            total = None if b.unit_price is None else round(b.unit_price * b.qty, 2)
            lines.append(ShoppingLine(key=key, kind="sheet", item_id=sp.item_id, name=sp.name,
                                      detail=f"{b.width_mm:g} × {b.length_mm:g} {_w(lang, 'sheet')}", qty=b.qty,
                                      unit_price=b.unit_price, total=total, checked=key in checked))

    bought_hw: dict[str, float] = defaultdict(float)
    if project.purchase:
        for ln in project.purchase.lines:
            if ln.kind == "hardware":
                bought_hw[ln.item_id] += ln.qty
    for hw in plan.hardware:
        key = f"hardware:{hw.key}"
        need = hw.qty
        bought_id = hw.item_id or f"free:{key}"  # typed-in hardware is recorded by its line key
        if bought_id in bought_hw:
            need = max(0.0, need - bought_hw[bought_id] * (hw.pack_size if hw.packs is not None else 1))
        if need <= 0:
            continue
        if hw.packs is not None:
            qty = -(-need // hw.pack_size)
            detail = _w(lang, "box", n=hw.pack_size)
        else:
            qty = need
            detail = _w(lang, "each") if hw.unit == "each" else hw.unit
        total = None if hw.unit_price is None else round(hw.unit_price * qty, 2)
        lines.append(ShoppingLine(key=key, kind="hardware", item_id=hw.item_id, name=hw.name, detail=detail,
                                  qty=qty, unit_price=hw.unit_price, total=total, checked=key in checked))
    return lines


def build_shopping(
    plan: PlanOut,
    project: Project,
    items: dict[str, CatalogItem],
    suppliers: dict[str, Supplier],
    alternatives: list[CatalogItem],
    lang: str = "en",
) -> ShoppingOut:
    lines = build_lines(plan, project, items, lang)
    groups: OrderedDict[str | None, list[ShoppingLine]] = OrderedDict()
    def order(x: ShoppingLine):
        it = items.get(x.item_id) if x.item_id else None
        dims = (it.thickness_mm or 0, it.width_mm or 0) if it else (0, 0)
        return ({"lumber": 0, "sheet": 1, "hardware": 2}[x.kind], dims, x.name, -x.qty if x.kind == "hardware" else 0,
                x.detail)

    for ln in sorted(lines, key=order):
        item = items.get(ln.item_id) if ln.item_id else None
        sid = item.supplier_id if item and item.supplier_id in suppliers else None
        groups.setdefault(sid, []).append(ln)
    out_groups = []
    for sid, lns in sorted(groups.items(), key=lambda kv: (kv[0] is None, suppliers[kv[0]].name if kv[0] else "")):
        out_groups.append(ShoppingGroup(
            supplier_id=sid, supplier_name=suppliers[sid].name if sid else _w(lang, "other"), lines=lns,
            subtotal=round(sum(ln.total or 0 for ln in lns), 2)))

    suggestions = []
    used = {lp.item_id for lp in plan.lumber}
    for iid in used:
        item = items.get(iid)
        if not item or item.price_per_m is None:
            continue
        for alt in alternatives:
            if (alt.id != item.id and alt.supplier_id != item.supplier_id and alt.price_per_m is not None
                    and alt.thickness_mm == item.thickness_mm and alt.width_mm == item.width_mm
                    and alt.material == item.material and alt.treatment == item.treatment
                    and alt.price_per_m < item.price_per_m - 0.005):
                sup = suppliers.get(alt.supplier_id or "")
                diff = item.price_per_m - alt.price_per_m
                where = sup.name if sup else "another supplier"
                text = (f"{item.display_name(lang)} costs {diff:.2f}/m less at {where}." if lang != "he"
                        else f"{item.display_name(lang)} זול ב־{diff:.2f} למטר אצל {where}.")
                suggestions.append(Suggestion(item_id=alt.id, text=text))
                break

    total = round(sum(g.subtotal for g in out_groups), 2)
    count = sum(len(g.lines) for g in out_groups)
    checked = sum(1 for g in out_groups for ln in g.lines if ln.checked)
    return ShoppingOut(project_id=project.id, lang=lang, currency=plan.currency, status=project.status,
                       groups=out_groups, total=total, checked=checked, count=count, suggestions=suggestions,
                       already_bought=project.purchase is not None)


def purchase_from(plan: PlanOut, project: Project, items: dict[str, CatalogItem]) -> Purchase:
    """Snapshot what is being bought now, merged with anything bought earlier."""
    lines: list[PurchaseLine] = list(project.purchase.lines) if project.purchase else []
    for lp in plan.lumber:
        for b in lp.buy:
            if b.source == "buy":
                lines.append(PurchaseLine(item_id=lp.item_id, kind="lumber", length_mm=b.length_mm, qty=b.qty,
                                          unit_price=b.unit_price))
    for sp in plan.sheets:
        for b in sp.buy:
            if b.source == "buy":
                lines.append(PurchaseLine(item_id=sp.item_id, kind="sheet", length_mm=b.length_mm,
                                          width_mm=b.width_mm, qty=b.qty, unit_price=b.unit_price))
    for ln in build_lines(plan, project, items, "en"):
        if ln.kind == "hardware":
            lines.append(PurchaseLine(item_id=ln.item_id or f"free:{ln.key}", kind="hardware", qty=ln.qty,
                                      unit_price=ln.unit_price))
    return Purchase(lines=lines)
