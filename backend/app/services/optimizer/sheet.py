"""2D sheet optimizer (guillotine cuts) for plywood, MDF and other panels.

Coordinates: x runs along the sheet *length* (the grain direction for grained sheets),
y runs across the *width*. A part's `length` is measured along the grain.

Every layout is produced by guillotine cuts only - each cut runs straight across the
piece it divides - so it can be made on a panel saw, table saw or with a track saw.
The cuts are recorded in an order that can be followed in the shop: a cut is only
ever made on a piece that earlier cuts have already separated.

The search tries several placement heuristics, split rules and part orderings (plus
seeded random orderings until the time budget runs out) and keeps the best plan by:
unplaced parts, cost, sheet count, then the largest reusable offcut.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field

EPS = 1e-6


@dataclass(frozen=True)
class Panel:
    key: str  # unique per instance
    label: str
    length: float  # along grain (x)
    width: float  # across grain (y)
    grain_locked: bool = False
    part_id: str = ""


@dataclass(frozen=True)
class SheetOption:
    key: str
    length: float
    width: float
    price: float
    available: int | None = None
    has_grain: bool = True
    source: str = "buy"
    ref: str | None = None


@dataclass(frozen=True)
class SheetSettings:
    kerf: float = 3.0
    edge_trim: float = 0.0
    allow_rotation: bool = True
    min_offcut: float = 150.0  # smallest side worth keeping
    time_limit: float = 1.5
    seed: int = 7


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    w: float  # extent along x (length)
    h: float  # extent along y (width)

    @property
    def area(self) -> float:
        return self.w * self.h

    def contains(self, o: Rect) -> bool:
        return (o.x >= self.x - EPS and o.y >= self.y - EPS and o.x + o.w <= self.x + self.w + EPS
                and o.y + o.h <= self.y + self.h + EPS)

    def overlaps(self, o: Rect) -> bool:
        return (self.x < o.x + o.w - EPS and o.x < self.x + self.w - EPS
                and self.y < o.y + o.h - EPS and o.y < self.y + self.h - EPS)


@dataclass
class Placement:
    panel: Panel
    rect: Rect
    rotated: bool  # True when the part's length runs across the sheet


@dataclass
class SheetCut:
    """A straight cut through `piece` (the board being cut at that moment).

    axis "x": the cut line runs along x (a rip, parallel to the grain) at y = `at`.
    axis "y": the cut line runs along y (a crosscut) at x = `at`.
    """

    axis: str
    at: float
    piece: Rect

    @property
    def offset(self) -> float:
        """Distance from the piece's near edge - what you set the fence to."""
        return self.at - (self.piece.y if self.axis == "x" else self.piece.x)


@dataclass
class SheetLayout:
    option: SheetOption
    placements: list[Placement] = field(default_factory=list)
    cuts: list[SheetCut] = field(default_factory=list)
    free: list[Rect] = field(default_factory=list)  # leftover pieces after all cuts

    @property
    def used_area(self) -> float:
        return sum(p.rect.area for p in self.placements)

    def offcuts(self, min_side: float) -> list[Rect]:
        return sorted(
            (r for r in self.free if min(r.w, r.h) + EPS >= min_side), key=lambda r: -r.area
        )


@dataclass
class SheetResult:
    sheets: list[SheetLayout]
    unplaced: list[Panel]
    settings: SheetSettings
    iterations: int = 0

    @property
    def cost(self) -> float:
        return sum(s.option.price for s in self.sheets)

    @property
    def sheet_area(self) -> float:
        return sum(s.option.length * s.option.width for s in self.sheets)

    @property
    def used_area(self) -> float:
        return sum(s.used_area for s in self.sheets)

    @property
    def offcut_area(self) -> float:
        return sum(r.area for s in self.sheets for r in s.offcuts(self.settings.min_offcut))

    @property
    def largest_offcut(self) -> float:
        return max((r.area for s in self.sheets for r in s.offcuts(self.settings.min_offcut)), default=0.0)


def can_rotate(panel: Panel, option: SheetOption, s: SheetSettings) -> bool:
    if not option.has_grain:
        return True
    return s.allow_rotation and not panel.grain_locked


def orientations(panel: Panel, option: SheetOption, s: SheetSettings) -> list[tuple[float, float, bool]]:
    out = [(panel.length, panel.width, False)]
    if can_rotate(panel, option, s) and abs(panel.length - panel.width) > EPS:
        out.append((panel.width, panel.length, True))
    return out


def usable_rect(option: SheetOption, s: SheetSettings) -> Rect:
    t = s.edge_trim
    return Rect(t, t, option.length - 2 * t, option.width - 2 * t)


def fits_option(panel: Panel, option: SheetOption, s: SheetSettings) -> bool:
    u = usable_rect(option, s)
    return any(w <= u.w + EPS and h <= u.h + EPS for w, h, _ in orientations(panel, option, s))


# ----------------------------------------------------------------- single sheet packing

PLACE_RULES = ("baf", "bssf", "blsf")
SPLIT_RULES = ("shorter", "longer", "min_area", "max_area")


def _score(rule: str, free: Rect, w: float, h: float) -> tuple[float, float]:
    dw, dh = free.w - w, free.h - h
    if rule == "baf":
        return (free.area - w * h, min(dw, dh))
    if rule == "bssf":
        return (min(dw, dh), max(dw, dh))
    return (max(dw, dh), min(dw, dh))  # blsf


def _split(free: Rect, w: float, h: float, rule: str, kerf: float) -> tuple[bool, list[Rect], list[SheetCut]]:
    """Return (cut_along_x_first, new free rects, cuts) for a part placed at free's corner."""
    rw = free.w - w - kerf  # width of the remainder to the right (along x)
    bh = free.h - h - kerf  # height of the remainder above (along y)
    if rule == "shorter":
        along_x = rw < bh
    elif rule == "longer":
        along_x = rw >= bh
    else:
        # along_x: top strip spans the full free width; along_y: right strip spans full height
        a_x = max(free.w * max(bh, 0), max(rw, 0) * h)
        a_y = max(max(rw, 0) * free.h, w * max(bh, 0))
        along_x = a_x >= a_y if rule == "max_area" else a_x < a_y

    rects: list[Rect] = []
    cuts: list[SheetCut] = []
    if along_x:
        if h < free.h - EPS:
            cuts.append(SheetCut("x", free.y + h, free))
            if bh > EPS:
                rects.append(Rect(free.x, free.y + h + kerf, free.w, bh))
        strip = Rect(free.x, free.y, free.w, h)
        if w < free.w - EPS:
            cuts.append(SheetCut("y", free.x + w, strip))
            if rw > EPS:
                rects.append(Rect(free.x + w + kerf, free.y, rw, h))
    else:
        if w < free.w - EPS:
            cuts.append(SheetCut("y", free.x + w, free))
            if rw > EPS:
                rects.append(Rect(free.x + w + kerf, free.y, rw, free.h))
        strip = Rect(free.x, free.y, w, free.h)
        if h < free.h - EPS:
            cuts.append(SheetCut("x", free.y + h, strip))
            if bh > EPS:
                rects.append(Rect(free.x, free.y + h + kerf, w, bh))
    return along_x, rects, cuts


def pack_sheet(
    option: SheetOption, panels: list[Panel], s: SheetSettings, place_rule: str, split_rule: str
) -> tuple[SheetLayout, list[Panel]]:
    """Pack as many of `panels` (in order) as fit on one sheet. Returns (layout, leftovers)."""
    layout = SheetLayout(option=option, free=[usable_rect(option, s)])
    rest: list[Panel] = []
    for panel in panels:
        best = None
        for i, fr in enumerate(layout.free):
            for w, h, rot in orientations(panel, option, s):
                if w <= fr.w + EPS and h <= fr.h + EPS:
                    sc = _score(place_rule, fr, w, h)
                    if best is None or sc < best[0]:
                        best = (sc, i, w, h, rot)
        if best is None:
            rest.append(panel)
            continue
        _, i, w, h, rot = best
        fr = layout.free.pop(i)
        _, new_rects, cuts = _split(fr, w, h, split_rule, s.kerf)
        layout.free.extend(new_rects)
        layout.cuts.extend(cuts)
        layout.placements.append(Placement(panel, Rect(fr.x, fr.y, w, h), rot))
    return layout, rest


# ----------------------------------------------------------------- multi sheet search

ORDERS = {
    "area": lambda p: (-(p.length * p.width), -max(p.length, p.width)),
    "long_side": lambda p: (-max(p.length, p.width), -(p.length * p.width)),
    "perimeter": lambda p: (-(p.length + p.width), -(p.length * p.width)),
    "length": lambda p: (-p.length, -p.width),
    "width": lambda p: (-p.width, -p.length),
}


def _pack_all(
    panels: list[Panel], options: list[SheetOption], s: SheetSettings, place_rule: str, split_rule: str
) -> SheetResult:
    remaining = list(panels)
    used: dict[str, int] = {}
    sheets: list[SheetLayout] = []
    while remaining:
        best = None
        for opt in options:
            if opt.available is not None and used.get(opt.key, 0) >= opt.available:
                continue
            layout, rest = pack_sheet(opt, remaining, s, place_rule, split_rule)
            if not layout.placements:
                continue
            placed = layout.used_area
            # Owned stock first (free), then the most part area per currency unit.
            key = (0, -placed) if opt.price <= 0 else (1, -(placed / opt.price), -placed)
            if best is None or key < best[0]:
                best = (key, opt, layout, rest)
        if best is None:
            break
        _, opt, layout, rest = best
        used[opt.key] = used.get(opt.key, 0) + 1
        sheets.append(layout)
        remaining = rest

    # The last sheet is often mostly empty: try a cheaper option that still holds its parts.
    if sheets:
        last = sheets[-1]
        parts = [pl.panel for pl in last.placements]
        for opt in sorted(options, key=lambda o: o.price):
            if opt.price >= last.option.price - EPS:
                break
            if opt.available is not None and used.get(opt.key, 0) >= opt.available:
                continue
            layout, rest = pack_sheet(opt, parts, s, place_rule, split_rule)
            if not rest:
                used[last.option.key] -= 1
                used[opt.key] = used.get(opt.key, 0) + 1
                sheets[-1] = layout
                break
    return SheetResult(sheets=sheets, unplaced=remaining, settings=s)


def _rank(r: SheetResult) -> tuple:
    return (len(r.unplaced), round(r.cost, 2), len(r.sheets), -round(r.largest_offcut), -round(r.offcut_area))


def optimize_sheets(
    panels: list[Panel], options: list[SheetOption], settings: SheetSettings | None = None
) -> SheetResult:
    s = settings or SheetSettings()
    options = [o for o in options if o.available is None or o.available > 0]
    fitting = [p for p in panels if any(fits_option(p, o, s) for o in options)]
    too_big = [p for p in panels if p not in fitting]
    if not fitting:
        return SheetResult(sheets=[], unplaced=too_big, settings=s)

    best: SheetResult | None = None
    iterations = 0
    deadline = time.monotonic() + s.time_limit

    def consider(order: list[Panel], pr: str, sr: str) -> None:
        nonlocal best, iterations
        iterations += 1
        res = _pack_all(order, options, s, pr, sr)
        if best is None or _rank(res) < _rank(best):
            best = res

    for key in ORDERS.values():
        order = sorted(fitting, key=lambda p, k=key: (*k(p), p.label, p.key))
        for pr in PLACE_RULES:
            for sr in SPLIT_RULES:
                consider(order, pr, sr)

    rng = random.Random(s.seed)
    base = sorted(fitting, key=lambda p: (*ORDERS["area"](p), p.label, p.key))
    while time.monotonic() < deadline and iterations < 4000:
        order = base[:]
        # Perturb: swap a few neighbours so big parts stay roughly first.
        for _ in range(max(1, len(order) // 4)):
            i = rng.randrange(len(order))
            j = min(len(order) - 1, i + rng.randint(1, 3))
            order[i], order[j] = order[j], order[i]
        consider(order, rng.choice(PLACE_RULES), rng.choice(SPLIT_RULES))

    assert best is not None
    best.unplaced = best.unplaced + too_big
    best.iterations = iterations
    return best


# ----------------------------------------------------------------- verification


def replay_cuts(layout: SheetLayout, s: SheetSettings) -> list[Rect]:
    """Physically replay a layout's cuts and return the resulting pieces.

    Raises ValueError when a cut does not run fully across exactly one existing piece -
    i.e. when the sequence could not be made with straight through-cuts.
    """
    pieces = [usable_rect(layout.option, s)]
    for cut in layout.cuts:
        target = None
        for i, p in enumerate(pieces):
            if (abs(p.x - cut.piece.x) < EPS and abs(p.y - cut.piece.y) < EPS
                    and abs(p.w - cut.piece.w) < EPS and abs(p.h - cut.piece.h) < EPS):
                target = i
                break
        if target is None:
            raise ValueError(f"cut {cut} is not on an existing piece")
        p = pieces.pop(target)
        k = s.kerf
        if cut.axis == "x":
            if not (p.y < cut.at < p.y + p.h + EPS):
                raise ValueError(f"rip outside piece: {cut}")
            a = Rect(p.x, p.y, p.w, cut.at - p.y)
            b = Rect(p.x, cut.at + k, p.w, p.y + p.h - cut.at - k)
        else:
            if not (p.x < cut.at < p.x + p.w + EPS):
                raise ValueError(f"crosscut outside piece: {cut}")
            a = Rect(p.x, p.y, cut.at - p.x, p.h)
            b = Rect(cut.at + k, p.y, p.x + p.w - cut.at - k, p.h)
        pieces.extend(r for r in (a, b) if r.w > EPS and r.h > EPS)
    return pieces
