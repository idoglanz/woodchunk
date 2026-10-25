import math

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from app.services.optimizer.sheet import (
    EPS,
    Panel,
    Rect,
    SheetOption,
    SheetSettings,
    optimize_sheets,
    replay_cuts,
    usable_rect,
)

BIRCH = SheetOption("birch18", 2400, 1200, 650.0, has_grain=True)


def panels_of(spec):
    out = []
    for label, length, width, qty, *rest in spec:
        locked = rest[0] if rest else False
        for i in range(qty):
            out.append(Panel(key=f"{label}-{i}", label=label, length=length, width=width, grain_locked=locked))
    return out


def assert_valid(res, panels, s):
    placed = [pl.panel.key for sh in res.sheets for pl in sh.placements]
    assert sorted(placed + [p.key for p in res.unplaced]) == sorted(p.key for p in panels)
    assert len(set(placed)) == len(placed)
    for sh in res.sheets:
        area = usable_rect(sh.option, s)
        rects = [pl.rect for pl in sh.placements]
        for pl in sh.placements:
            assert area.contains(pl.rect), (pl, area)
            dims = sorted((pl.rect.w, pl.rect.h))
            assert dims == sorted((pl.panel.length, pl.panel.width))
            if pl.panel.grain_locked and sh.option.has_grain:
                assert not pl.rotated
                assert math.isclose(pl.rect.w, pl.panel.length)
        for i, a in enumerate(rects):
            for b in rects[i + 1:]:
                assert not a.overlaps(b), (a, b)
        # The cut sequence must be physically doable and yield exactly the parts.
        pieces = replay_cuts(sh, s)
        for r in rects:
            assert any(
                abs(p.x - r.x) < EPS and abs(p.y - r.y) < EPS and abs(p.w - r.w) < EPS and abs(p.h - r.h) < EPS
                for p in pieces
            ), f"part {r} is not a separate piece after the cuts"
        # Leftover pieces (free rects) never overlap parts.
        for f in sh.free:
            for r in rects:
                assert not f.overlaps(r)


def test_carpenter_table_sheet_fits_on_one_sheet():
    s = SheetSettings(kerf=3)
    panels = panels_of([("B4", 1150, 560, 1), ("B5", 560, 300, 2), ("A3", 300, 200, 12)])
    res = optimize_sheets(panels, [BIRCH], s)
    assert_valid(res, panels, s)
    assert len(res.sheets) == 1 and not res.unplaced
    assert res.largest_offcut > 0


def test_kerf_matters():
    # Four 600 mm strips across a 1200 mm wide sheet fit only without kerf... in two rows of 2.
    panels = panels_of([("S", 2400, 600, 2)])
    no_kerf = optimize_sheets(panels, [BIRCH], SheetSettings(kerf=0))
    assert len(no_kerf.sheets) == 1
    with_kerf = optimize_sheets(panels, [BIRCH], SheetSettings(kerf=3))
    assert_valid(with_kerf, panels, SheetSettings(kerf=3))
    assert len(with_kerf.sheets) == 2


def test_grain_lock_prevents_rotation():
    s = SheetSettings(kerf=3)
    panels = panels_of([("D", 1100, 2300, 1, True)])  # would only fit rotated
    res = optimize_sheets(panels, [BIRCH], s)
    assert [p.label for p in res.unplaced] == ["D"]
    res2 = optimize_sheets(panels_of([("D", 1100, 2300, 1, False)]), [BIRCH], s)
    assert not res2.unplaced and res2.sheets[0].placements[0].rotated


def test_grainless_sheet_rotates_even_when_locked():
    mdf = SheetOption("mdf", 2440, 1220, 300.0, has_grain=False)
    s = SheetSettings(kerf=3)
    res = optimize_sheets(panels_of([("D", 1100, 2300, 1, True)]), [mdf], s)
    assert not res.unplaced


def test_prefers_cheaper_sheet_for_small_last_sheet():
    half = SheetOption("half", 1200, 1200, 380.0)
    s = SheetSettings(kerf=3)
    panels = panels_of([("Big", 2300, 1100, 1), ("Small", 500, 400, 1)])
    res = optimize_sheets(panels, [BIRCH, half], s)
    assert_valid(res, panels, s)
    assert res.cost <= 650 + 380 + EPS


def test_edge_trim_respected():
    s = SheetSettings(kerf=3, edge_trim=10)
    panels = panels_of([("F", 2400, 1200, 1)])
    res = optimize_sheets(panels, [BIRCH], s)
    assert [p.label for p in res.unplaced] == ["F"]


def test_area_lower_bound():
    s = SheetSettings(kerf=3, time_limit=0.5)
    panels = panels_of([("P", 700, 500, 20)])
    res = optimize_sheets(panels, [BIRCH], s)
    assert_valid(res, panels, s)
    u = usable_rect(BIRCH, s)
    assert len(res.sheets) >= math.ceil(sum(p.length * p.width for p in panels) / (u.w * u.h))
    # 3 × 2 parts per sheet (with kerf) is achievable: 20 parts need 4 sheets.
    assert len(res.sheets) <= 4


@settings(max_examples=40, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    spec=st.lists(
        st.tuples(
            st.integers(min_value=50, max_value=2500),
            st.integers(min_value=50, max_value=1300),
            st.integers(min_value=1, max_value=6),
            st.booleans(),
        ),
        min_size=1,
        max_size=8,
    ),
    kerf=st.sampled_from([0.0, 2.2, 3.2]),
    trim=st.sampled_from([0.0, 5.0]),
)
def test_random_layouts_are_valid(spec, kerf, trim):
    s = SheetSettings(kerf=kerf, edge_trim=trim, time_limit=0.2)
    panels = panels_of([(f"P{i}", float(L), float(W), q, lock) for i, (L, W, q, lock) in enumerate(spec)])
    options = [BIRCH, SheetOption("small", 1220, 610, 200.0)]
    res = optimize_sheets(panels, options, s)
    assert_valid(res, panels, s)
    # A panel is only unplaced when it fits no sheet in any allowed orientation.
    for p in res.unplaced:
        u = usable_rect(BIRCH, s)
        fits = (p.length <= u.w + EPS and p.width <= u.h + EPS) or (
            not p.grain_locked and p.width <= u.w + EPS and p.length <= u.h + EPS
        )
        assert not fits


def test_rect_helpers():
    a = Rect(0, 0, 10, 10)
    assert a.contains(Rect(1, 1, 5, 5))
    assert not a.overlaps(Rect(10, 0, 5, 5))
