from functools import cache

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from app.services.optimizer.linear import (
    EPS,
    LinearSettings,
    Piece,
    StockOption,
    board_capacity_ok,
    first_fit_decreasing,
    optimize_linear,
)

S = LinearSettings(kerf=3, end_trim=0, min_offcut=300, time_limit=5)
STOCK = [
    StockOption("2400", 2400, 30.46),
    StockOption("3000", 3000, 38.07),
    StockOption("3600", 3600, 45.68),
]


def pieces_of(spec: list[tuple[str, float, int]]) -> list[Piece]:
    out = []
    for label, length, qty in spec:
        for i in range(qty):
            out.append(Piece(key=f"{label}-{i}", label=label, length=length))
    return out


def assert_valid(result, pieces, stocks, s):
    placed = [c.piece.key for b in result.boards for c in b.cuts]
    unplaced = [p.key for p in result.unplaced]
    # Every piece exactly once, either cut or reported.
    assert sorted(placed + unplaced) == sorted(p.key for p in pieces)
    assert len(set(placed)) == len(placed)
    for b in result.boards:
        assert board_capacity_ok(b.stock, [c.piece for c in b.cuts], s)
        # Cuts do not overlap and stay on the board, with a kerf between pieces.
        cuts = sorted(b.cuts, key=lambda c: c.start)
        assert cuts[0].start >= s.end_trim - EPS
        for a, c in zip(cuts, cuts[1:]):
            assert c.start >= a.start + a.piece.length + s.kerf - EPS
        assert cuts[-1].start + cuts[-1].piece.length <= b.stock.length + EPS
        assert b.leftover >= 0
    used = {}
    for b in result.boards:
        used[b.stock.key] = used.get(b.stock.key, 0) + 1
    for st_ in stocks:
        if st_.available is not None:
            assert used.get(st_.key, 0) <= st_.available


def brute_force_cost(pieces: list[Piece], stocks: list[StockOption], s: LinearSettings) -> float:
    """Exact minimum cost by trying every way to group pieces onto boards (tiny inputs only)."""
    lengths = tuple(sorted((p.length for p in pieces), reverse=True))

    def cheapest(group: tuple[float, ...]) -> float | None:
        best = None
        for st_ in stocks:
            need = sum(group) + s.kerf * (len(group) - 1)
            if need <= st_.length - s.end_trim + EPS and (best is None or st_.price < best):
                best = st_.price
        return best

    @cache
    def solve(rest: tuple[float, ...]) -> float:
        if not rest:
            return 0.0
        first, others = rest[0], rest[1:]
        best = float("inf")
        n = len(others)
        # The first piece goes on a board together with any subset of the others.
        for mask in range(1 << n):
            group = (first,) + tuple(others[i] for i in range(n) if mask >> i & 1)
            c = cheapest(group)
            if c is None:
                continue
            left = tuple(others[i] for i in range(n) if not mask >> i & 1)
            best = min(best, c + solve(left))
        return best

    return solve(lengths)


def test_carpenter_table_sawhorse_plan_is_cheap_and_valid():
    pieces = pieces_of([("A1", 800, 12), ("A2", 560, 12)])
    res = optimize_linear(pieces, STOCK, S)
    assert_valid(res, pieces, STOCK, S)
    assert not res.unplaced
    greedy = first_fit_decreasing(pieces, STOCK, S)
    assert res.cost <= greedy.cost + EPS
    # 12×800 + 12×560 = 16 320 mm of parts; at least 5 boards of 3.6 m are needed.
    assert len(res.boards) >= 5


def test_too_long_piece_is_reported_not_dropped():
    pieces = pieces_of([("B2", 2500, 1), ("X", 4000, 1)])
    short = [StockOption("2400", 2400, 30), StockOption("3000", 3000, 38)]
    res = optimize_linear(pieces, short, S)
    assert [p.label for p in res.unplaced] == ["X"]
    assert_valid(res, pieces, short, S)


def test_inventory_is_used_first_and_limited():
    pieces = pieces_of([("P", 1000, 4)])
    stocks = [StockOption("inv", 2100, 0.0, available=1, source="inventory"), *STOCK]
    res = optimize_linear(pieces, stocks, S)
    assert_valid(res, pieces, stocks, S)
    assert sum(1 for b in res.boards if b.stock.key == "inv") == 1


def test_leftover_is_kept_reusable_rather_than_scrap():
    # 3 × 1500 + 3 × 400 on 2.4 m boards always needs 3 boards. Greedy packs
    # 1500+400+400 on the first board and leaves a 91 mm scrap; the optimizer should
    # instead lay out the same 3 boards so every leftover is long enough to keep.
    pieces = pieces_of([("A", 1500, 3), ("B", 400, 3)])
    stocks = [StockOption("2400", 2400, 30.0)]
    greedy = first_fit_decreasing(pieces, stocks, S)
    assert greedy.waste > 3 * 2 * S.kerf  # greedy leaves an unusable scrap
    res = optimize_linear(pieces, stocks, S)
    assert_valid(res, pieces, stocks, S)
    assert len(res.boards) == 3
    assert all(b.is_offcut for b in res.boards), [(b.leftover, [c.piece.label for c in b.cuts]) for b in res.boards]
    assert res.waste < greedy.waste


def test_deterministic():
    pieces = pieces_of([("A", 800, 7), ("B", 650, 5), ("C", 1450, 3)])
    a = optimize_linear(pieces, STOCK, S)
    b = optimize_linear(pieces, STOCK, S)
    assert [(x.stock.key, [c.piece.key for c in x.cuts]) for x in a.boards] == [
        (x.stock.key, [c.piece.key for c in x.cuts]) for x in b.boards
    ]


@settings(max_examples=60, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    lengths=st.lists(st.integers(min_value=150, max_value=2400), min_size=1, max_size=7),
    kerf=st.sampled_from([0.0, 2.2, 3.0, 3.2]),
)
def test_matches_brute_force_optimum(lengths, kerf):
    s = LinearSettings(kerf=kerf, end_trim=0, min_offcut=300, time_limit=5)
    pieces = [Piece(key=f"p{i}", label=f"P{i}", length=float(L)) for i, L in enumerate(lengths)]
    res = optimize_linear(pieces, STOCK, s)
    assert_valid(res, pieces, STOCK, s)
    assert not res.unplaced
    assert abs(res.cost - brute_force_cost(pieces, STOCK, s)) < 1e-6


@settings(max_examples=30, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    spec=st.lists(
        st.tuples(st.integers(min_value=100, max_value=3600), st.integers(min_value=1, max_value=8)),
        min_size=1,
        max_size=10,
    ),
    trim=st.sampled_from([0.0, 10.0]),
)
def test_larger_instances_valid_and_never_worse_than_greedy(spec, trim):
    s = LinearSettings(kerf=3, end_trim=trim, min_offcut=300, time_limit=1.5)
    pieces = pieces_of([(f"L{i}", float(L), q) for i, (L, q) in enumerate(spec)])
    res = optimize_linear(pieces, STOCK, s)
    assert_valid(res, pieces, STOCK, s)
    greedy = first_fit_decreasing(pieces, STOCK, s)
    assert res.cost <= greedy.cost + EPS
