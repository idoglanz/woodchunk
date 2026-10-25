"""1D cutting-stock optimizer for lumber.

Given the pieces a project needs from one lumber material and the stock lengths that
material comes in, decide which boards to buy (or take from inventory) and how to cut
each one so that:

1. every piece is cut exactly once (or reported as unplaced when no stock is long enough),
2. the total price is minimal,
3. among equally cheap plans, the leftover that is too short to reuse is minimal - which
   pushes leftovers together into offcuts worth keeping.

The exact model is solved with CP-SAT and warm-started with a first-fit-decreasing plan,
which also serves as the answer when the solver is unavailable or times out without one.

Units: lengths in millimetres (floats allowed), prices in currency units.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field

from ortools.sat.python import cp_model

# CP-SAT works in integers; lengths are scaled to tenths of a millimetre.
SCALE = 10
EPS = 1e-6


@dataclass(frozen=True)
class Piece:
    """One physical piece to cut. `key` is unique per instance."""

    key: str
    label: str
    length: float
    part_id: str = ""


@dataclass(frozen=True)
class StockOption:
    key: str
    length: float
    price: float
    available: int | None = None  # None = unlimited (buy as many as needed)
    source: str = "buy"  # buy | inventory | purchased
    ref: str | None = None  # inventory/purchase entry id


@dataclass(frozen=True)
class LinearSettings:
    kerf: float = 3.0
    end_trim: float = 0.0
    min_offcut: float = 300.0
    time_limit: float = 2.0


@dataclass
class Cut:
    piece: Piece
    start: float  # position of the piece's start along the board


@dataclass
class Board:
    stock: StockOption
    cuts: list[Cut] = field(default_factory=list)
    leftover: float = 0.0  # reusable or not, see is_offcut
    is_offcut: bool = False

    @property
    def used(self) -> float:
        return sum(c.piece.length for c in self.cuts)


@dataclass
class LinearResult:
    boards: list[Board]
    unplaced: list[Piece]
    optimal: bool
    solver: str  # cp-sat | ffd

    @property
    def cost(self) -> float:
        return sum(b.stock.price for b in self.boards)

    @property
    def stock_length(self) -> float:
        return sum(b.stock.length for b in self.boards)

    @property
    def waste(self) -> float:
        """Material that is neither a part nor a kept offcut (kerf, trim, short scraps)."""
        return sum(b.stock.length - b.used - (b.leftover if b.is_offcut else 0) for b in self.boards)


def usable_length(stock: StockOption, s: LinearSettings) -> float:
    return stock.length - s.end_trim


def fits_on(length: float, stock: StockOption, s: LinearSettings) -> bool:
    return length <= usable_length(stock, s) + EPS


def layout_board(stock: StockOption, pieces: list[Piece], s: LinearSettings) -> Board:
    """Place pieces left to right (longest first) and compute the leftover."""
    ordered = sorted(pieces, key=lambda p: (-p.length, p.label, p.key))
    pos = s.end_trim
    cuts = []
    for i, p in enumerate(ordered):
        if i > 0:
            pos += s.kerf
        cuts.append(Cut(piece=p, start=pos))
        pos += p.length
    remaining = stock.length - pos
    if not ordered:
        remaining = stock.length - s.end_trim
    # Separating the leftover takes one more kerf; anything thinner than a kerf is dust.
    leftover = remaining - s.kerf if ordered and remaining > s.kerf else (remaining if not ordered else 0.0)
    leftover = max(0.0, leftover)
    return Board(stock=stock, cuts=cuts, leftover=leftover, is_offcut=leftover + EPS >= s.min_offcut)


def board_capacity_ok(stock: StockOption, pieces: list[Piece], s: LinearSettings) -> bool:
    if not pieces:
        return True
    need = sum(p.length for p in pieces) + s.kerf * (len(pieces) - 1)
    return need <= usable_length(stock, s) + EPS


# --------------------------------------------------------------------------- FFD


def first_fit_decreasing(pieces: list[Piece], stocks: list[StockOption], s: LinearSettings) -> LinearResult:
    """Greedy baseline: open boards one at a time, choosing for each new board the stock
    option that is cheapest per millimetre of parts it ends up holding."""
    placeable = [p for p in pieces if any(fits_on(p.length, st, s) for st in stocks)]
    unplaced = [p for p in pieces if p not in placeable]
    remaining = sorted(placeable, key=lambda p: (-p.length, p.key))
    used_count: dict[str, int] = defaultdict(int)
    boards: list[Board] = []

    def greedy_fill(stock: StockOption, items: list[Piece]) -> list[Piece]:
        chosen: list[Piece] = []
        for p in items:
            if board_capacity_ok(stock, chosen + [p], s):
                chosen.append(p)
        return chosen

    while remaining:
        best = None
        for st in stocks:
            if st.available is not None and used_count[st.key] >= st.available:
                continue
            chosen = greedy_fill(st, remaining)
            if not chosen:
                continue
            filled = sum(p.length for p in chosen)
            # Free stock (inventory) first; otherwise price per mm of useful wood.
            score = (st.price / filled) if st.price > 0 else -filled
            key = (score, -filled, st.length)
            if best is None or key < best[0]:
                best = (key, st, chosen)
        if best is None:  # Only limited stock left and none of it fits
            unplaced.extend(remaining)
            break
        _, st, chosen = best
        used_count[st.key] += 1
        boards.append(layout_board(st, chosen, s))
        chosen_keys = {p.key for p in chosen}
        remaining = [p for p in remaining if p.key not in chosen_keys]

    return LinearResult(boards=boards, unplaced=unplaced, optimal=False, solver="ffd")


# --------------------------------------------------------------------------- CP-SAT


def optimize_linear(
    pieces: list[Piece], stocks: list[StockOption], settings: LinearSettings | None = None
) -> LinearResult:
    s = settings or LinearSettings()
    stocks = [st for st in stocks if st.length > s.end_trim and (st.available is None or st.available > 0)]
    if not pieces:
        return LinearResult(boards=[], unplaced=[], optimal=True, solver="cp-sat")
    if not stocks:
        return LinearResult(boards=[], unplaced=list(pieces), optimal=True, solver="cp-sat")

    baseline = first_fit_decreasing(pieces, stocks, s)
    placeable = [p for p in pieces if p not in baseline.unplaced]
    if not placeable:
        return baseline

    # Group by length: the model decides counts per length per board.
    by_len: dict[int, list[Piece]] = defaultdict(list)
    for p in placeable:
        by_len[round(p.length * SCALE)].append(p)
    lengths = sorted(by_len, reverse=True)
    demand = {L: len(by_len[L]) for L in lengths}
    kerf = round(s.kerf * SCALE)
    n_boards = len(baseline.boards)

    m = cp_model.CpModel()
    use = {(b, j): m.new_bool_var(f"use_{b}_{j}") for b in range(n_boards) for j in range(len(stocks))}
    cnt = {
        (b, L): m.new_int_var(0, demand[L], f"n_{b}_{L}") for b in range(n_boards) for L in lengths
    }
    caps = [round(usable_length(st, s) * SCALE) for st in stocks]
    max_cap = max(caps)
    waste_terms = []
    min_off = round(s.min_offcut * SCALE)

    for b in range(n_boards):
        m.add(sum(use[b, j] for j in range(len(stocks))) <= 1)
        used_b = m.new_bool_var(f"open_{b}")
        m.add(sum(use[b, j] for j in range(len(stocks))) == used_b)
        # Every piece adds its length plus one kerf; the last piece needs no kerf after it,
        # hence the +kerf on the capacity side (only when the board is open).
        load = sum(cnt[b, L] * (L + kerf) for L in lengths)
        cap_expr = sum(use[b, j] * (caps[j] + kerf) for j in range(len(stocks)))
        m.add(load <= cap_expr)
        m.add(sum(cnt[b, L] for L in lengths) >= 1).only_enforce_if(used_b)
        m.add(sum(cnt[b, L] for L in lengths) == 0).only_enforce_if(used_b.Not())
        # Leftover length on this board and whether it is long enough to keep.
        left = m.new_int_var(0, max_cap + kerf, f"left_{b}")
        m.add(left == cap_expr - load)
        keep = m.new_bool_var(f"keep_{b}")
        m.add(left >= min_off + kerf).only_enforce_if(keep)
        m.add(keep <= used_b)
        waste = m.new_int_var(0, max_cap + kerf, f"waste_{b}")
        m.add(waste >= left - (max_cap + kerf) * keep)
        waste_terms.append(waste)
        # Symmetry breaking: open boards come first, ordered by stock option index.
        if b > 0:
            prev_open = sum(use[b - 1, j] for j in range(len(stocks)))
            m.add(prev_open >= used_b)
            m.add(sum(j * use[b - 1, j] for j in range(len(stocks)))
                  >= sum(j * use[b, j] for j in range(len(stocks))))

    for L in lengths:
        m.add(sum(cnt[b, L] for b in range(n_boards)) == demand[L])
    for j, st in enumerate(stocks):
        if st.available is not None:
            m.add(sum(use[b, j] for b in range(n_boards)) <= st.available)

    prices = [round(st.price * 100) for st in stocks]  # minor currency units
    big = (max_cap + kerf) * n_boards + 1
    m.minimize(big * sum(use[b, j] * prices[j] for b in range(n_boards) for j in range(len(stocks)))
               + sum(waste_terms))

    # Warm start from the greedy plan (ordered the same way as the symmetry breaking).
    stock_index = {st.key: j for j, st in enumerate(stocks)}
    hint_boards = sorted(baseline.boards, key=lambda bd: -stock_index[bd.stock.key])
    for b, board in enumerate(hint_boards):
        j0 = stock_index[board.stock.key]
        for j in range(len(stocks)):
            m.add_hint(use[b, j], 1 if j == j0 else 0)
        counts = defaultdict(int)
        for c in board.cuts:
            counts[round(c.piece.length * SCALE)] += 1
        for L in lengths:
            m.add_hint(cnt[b, L], counts[L])

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = s.time_limit
    # Interleaved search keeps multi-worker solving deterministic, so the same project
    # always gets the same plan (no layouts jumping around between recomputes).
    solver.parameters.num_workers = 8
    solver.parameters.interleave_search = True
    solver.parameters.random_seed = 7
    status = solver.solve(m)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return baseline

    queues = {L: sorted(by_len[L], key=lambda p: (p.label, p.key)) for L in lengths}
    boards: list[Board] = []
    for b in range(n_boards):
        chosen = [j for j in range(len(stocks)) if solver.value(use[b, j])]
        if not chosen:
            continue
        st = stocks[chosen[0]]
        items: list[Piece] = []
        for L in lengths:
            for _ in range(solver.value(cnt[b, L])):
                items.append(queues[L].pop())
        boards.append(layout_board(st, items, s))

    result = LinearResult(
        boards=boards, unplaced=list(baseline.unplaced), optimal=status == cp_model.OPTIMAL, solver="cp-sat"
    )
    # Never return something worse than the greedy plan (guards against a bad timeout).
    if (result.cost, result.waste) > (baseline.cost + EPS, baseline.waste + EPS):
        return baseline
    return result


def lower_bound_boards(pieces: list[Piece], longest_usable: float, kerf: float) -> int:
    """Simple bound used in tests: total length / longest board."""
    total = sum(p.length + kerf for p in pieces)
    return math.ceil(total / (longest_usable + kerf)) if pieces else 0
