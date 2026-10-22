"""API shapes for computed plans and shopping lists (never stored by the user)."""

from datetime import datetime
from typing import Literal

from app.models.common import Model


class BuyLine(Model):
    length_mm: float
    width_mm: float | None = None
    qty: int
    unit_price: float | None
    source: Literal["buy", "inventory", "purchased"]


class Segment(Model):
    kind: Literal["part", "offcut", "waste"]
    start: float
    length: float
    label: str = ""
    name: str = ""
    part_id: str = ""
    assembly: str = ""  # letter


class BoardPattern(Model):
    stock_length: float
    source: Literal["buy", "inventory", "purchased"]
    count: int
    segments: list[Segment]
    leftover: float
    leftover_kept: bool


class LumberPlan(Model):
    item_id: str
    name: str
    supplier_name: str = ""
    kerf: float
    cost: float
    waste_pct: float
    optimal: bool
    longest_stock: float
    buy: list[BuyLine]
    patterns: list[BoardPattern]


class PlacedPart(Model):
    label: str
    name: str
    part_id: str
    assembly: str
    x: float
    y: float
    w: float
    h: float
    rotated: bool


class Rect(Model):
    x: float
    y: float
    w: float
    h: float


class CutStep(Model):
    n: int
    kind: Literal["rip", "crosscut"]
    offset: float  # fence setting: distance from the piece's near edge
    piece_w: float
    piece_h: float
    x1: float
    y1: float
    x2: float
    y2: float


class SheetLayoutOut(Model):
    length: float
    width: float
    source: Literal["buy", "inventory", "purchased"]
    unit_price: float | None
    parts: list[PlacedPart]
    offcuts: list[Rect]
    cuts: list[CutStep]
    used_pct: float


class SheetPlan(Model):
    item_id: str
    name: str
    supplier_name: str = ""
    thickness_mm: float | None
    has_grain: bool
    kerf: float
    edge_trim: float
    cost: float
    waste_pct: float
    buy: list[BuyLine]
    layouts: list[SheetLayoutOut]


class HardwareTotal(Model):
    key: str
    item_id: str | None
    name: str
    qty: float  # pieces needed
    packs: int | None  # packs to buy when the item comes in packs
    pack_size: int
    unit: str
    unit_price: float | None
    total: float | None
    assemblies: list[str]


class Unplaced(Model):
    part_id: str
    label: str
    name: str
    item_id: str | None
    reason: str


class Totals(Model):
    cost: float
    lumber_cost: float
    sheet_cost: float
    hardware_cost: float
    unpriced_lines: int
    boards: int
    sheets: int
    from_inventory: int
    waste_pct: float
    parts: int
    offcuts: int


class PlanOut(Model):
    project_id: str
    computed_at: datetime
    input_hash: str
    currency: str
    totals: Totals
    lumber: list[LumberPlan]
    sheets: list[SheetPlan]
    hardware: list[HardwareTotal]
    unplaced: list[Unplaced]
    warnings: list[str]


class ShoppingLine(Model):
    key: str
    kind: Literal["lumber", "sheet", "hardware"]
    item_id: str | None
    name: str
    detail: str
    qty: float
    unit_price: float | None
    total: float | None
    checked: bool


class ShoppingGroup(Model):
    supplier_id: str | None
    supplier_name: str
    lines: list[ShoppingLine]
    subtotal: float


class Suggestion(Model):
    item_id: str
    text: str


class ShoppingOut(Model):
    project_id: str
    lang: str
    currency: str
    status: str
    groups: list[ShoppingGroup]
    total: float
    checked: int
    count: int
    suggestions: list[Suggestion]
    already_bought: bool
