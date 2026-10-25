"""Frame kernel: the shared golden fixtures (also run by the frontend), expressions, and invariants."""

import json
import math
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from app.models.frame import Frame, FrameJoint, FrameMember
from app.services.frame.expr import ExprError, evaluate
from app.services.frame.kernel import Profile, solve, stable_id

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "frames"
TOL = 0.11


def load(name: str):
    data = json.loads((FIXTURES / name).read_text())
    profiles = {k: Profile(v["shape"], v["w"], v["h"], v.get("t", 0)) for k, v in data["profiles"].items()}
    return data, Frame.model_validate(data["frame"]), profiles


def matches(expected: dict, g) -> bool:
    if expected["item_id"] != g.item_id or expected["qty"] != g.qty:
        return False
    if abs(expected["lp"] - g.lp) > TOL or abs(expected["sp"] - g.sp) > TOL:
        return False
    want = sorted(tuple(e) for e in expected["ends"])
    got = sorted((e.miter, e.bevel) for e in g.ends)
    if any(abs(a - b) > TOL for w, h in zip(want, got, strict=True) for a, b in zip(w, h, strict=True)):
        return False
    return "face_up" not in expected or expected["face_up"] == g.face_up


@pytest.mark.parametrize("name", sorted(p.name for p in FIXTURES.glob("*.json")))
def test_golden_fixture(name):
    data, frame, profiles = load(name)
    result = solve(frame, profiles)
    exp = data["expect"]
    assert len(result.warnings) == exp["warnings"], result.warnings
    assert len(result.groups) == len(exp["groups"]), [(g.item_id, g.qty, g.lp, g.sp) for g in result.groups]
    for want in exp["groups"]:
        assert any(matches(want, g) for g in result.groups), (want, [
            (g.item_id, g.qty, g.lp, g.sp, [(e.miter, e.bevel) for e in g.ends], g.face_up) for g in result.groups])


def test_parameters_move_the_frame():
    data, frame, profiles = load("table-butt.json")
    frame.params[0].mm = 1500  # W
    groups = solve(frame, profiles).groups
    assert sorted(g.lp for g in groups if g.item_id == "apron") == [460, 1360]


def test_joint_override_changes_who_runs_through():
    data, frame, profiles = load("t-junction.json")
    frame.joints = [FrameJoint(node="c2", kind="butt", through="short1")]
    by_id = {m.id: m for m in solve(frame, profiles).members}
    assert by_id["short1"].lp == 560  # runs through at the corner (from 0), still stops at long2 (y = 560)
    assert by_id["long1"].lp == 960  # now stops at short1's inner face


def test_expressions():
    p = {"W": 1200, "H": 750}
    assert evaluate("W", p) == 1200
    assert evaluate("H - 40", p) == 710
    assert evaluate("(W - 2*35) / 2", p) == 565
    assert evaluate("-W/4 + 10", p) == -290
    assert evaluate(12.5, p) == 12.5
    for bad in ("W +", "X", "2 / 0", "(W", "W W", ""):
        with pytest.raises(ExprError):
            evaluate(bad, p)


@settings(max_examples=60, deadline=None)
@given(w=st.integers(200, 3000), d=st.integers(200, 2000), size=st.integers(15, 80),
       corner=st.sampled_from(["miter", "butt"]))
def test_rectangle_frames(w, d, size, corner):
    """Any flat rectangle: every piece fits inside its side, miters are 45°, butts square."""
    frame = Frame.model_validate({
        "defaults": {"corner": corner, "lines": "outside"},
        "nodes": [{"id": "a", "x": 0, "y": 0}, {"id": "b", "x": w, "y": 0},
                  {"id": "c", "x": w, "y": d}, {"id": "d", "x": 0, "y": d}],
        "members": [{"id": "ab", "a": "a", "b": "b", "item_id": "p"}, {"id": "bc", "a": "b", "b": "c", "item_id": "p"},
                    {"id": "cd", "a": "c", "b": "d", "item_id": "p"}, {"id": "da", "a": "d", "b": "a", "item_id": "p"}],
    })
    res = solve(frame, {"p": Profile("rect_tube", size, size, 2)})
    assert not res.warnings
    sides = {"ab": w, "bc": d, "cd": w, "da": d}
    for m in res.members:
        assert m.sp <= m.lp <= sides[m.id] + 0.05
        for e in m.ends:
            assert e.bevel == 0
            assert e.miter in ((45.0,) if corner == "miter" else (0.0,))
    total = sum(m.lp for m in res.members)
    if corner == "miter":
        assert math.isclose(total, 2 * (w + d), abs_tol=0.2)
    else:
        assert math.isclose(total, 2 * (w + d) - 4 * size, abs_tol=0.2)


def test_deterministic():
    _, frame, profiles = load("table-butt.json")
    a = [(g.key, g.qty) for g in solve(frame, profiles).groups]
    b = [(g.key, g.qty) for g in solve(frame, profiles).groups]
    assert a == b


PARITY = FIXTURES.parent / "frame-parity.json"


def parity_snapshot() -> dict:
    """Every fixture's piece keys and part ids: the editor's TS kernel must produce the same strings."""
    out = {}
    for path in sorted(FIXTURES.glob("*.json")):
        _, frame, profiles = load(path.name)
        out[path.name] = {g.key: stable_id(f"asm|{g.key}") for g in solve(frame, profiles).groups}
    return out


def test_parity_file_is_current():
    """Regenerate with: uv run python -c 'from tests.test_frame import write_parity; write_parity()'"""
    assert json.loads(PARITY.read_text()) == parity_snapshot()


def write_parity() -> None:
    PARITY.write_text(json.dumps(parity_snapshot(), indent=2, ensure_ascii=False) + "\n")


def test_splay_sweep_is_continuous():
    """A leg splaying from 0° to 15° changes the rail it butts into smoothly (no 90° section flip)."""
    prev = None
    for tenth in range(0, 151, 5):
        dx = 700 * math.tan(math.radians(tenth / 10))
        frame = Frame.model_validate({
            "defaults": {"corner": "butt", "lines": "centerline"},
            "nodes": [{"id": "f", "x": 0, "y": 0, "z": 0}, {"id": "p", "x": dx, "y": 0, "z": 700},
                      {"id": "q", "x": dx + 600, "y": 0, "z": 700}],
            "members": [{"id": "leg", "a": "f", "b": "p", "item_id": "board"},
                        {"id": "rail", "a": "p", "b": "q", "item_id": "board"}],
        })
        res = solve(frame, {"board": Profile("rect", 100, 44)})
        leg = next(m for m in res.members if m.id == "leg")
        if prev is not None:
            assert abs(leg.lp - prev) < 15, (tenth, leg.lp, prev)
        prev = leg.lp


def test_bad_expressions_are_contained():
    for bad in ("(" * 2000 + "1" + ")" * 2000, "-" * 3000 + "1", "9" * 400, "9" * 400 + " - " + "9" * 400):
        with pytest.raises(ExprError):
            evaluate(bad, {})
    frame = Frame.model_validate({
        "nodes": [{"id": "a", "x": 0}, {"id": "b", "x": "W"}, {"id": "c", "x": 0, "y": 500}],
        "members": [{"id": "ab", "a": "a", "b": "b", "item_id": "p", "name": "Rail"},
                    {"id": "ac", "a": "a", "b": "c", "item_id": "p"}],
    })
    res = solve(frame, {"p": Profile("rect", 40, 40)})
    assert [m.id for m in res.members] == ["ac"]  # the bar on the bad joint is left out, not measured from 0
    assert any("Rail is left out" in w for w in res.warnings)


def test_a_diagonal_brace_does_not_lengthen_the_legs():
    """A brace drawn corner to corner trims to the legs' faces; the legs keep their length."""
    _, frame, profiles = load("table-butt.json")
    frame.members.append(FrameMember(id="brace", a="b1", b="t2", item_id="leg"))
    by_id = {m.id: m for m in solve(frame, profiles).members}
    assert by_id["l1"].lp == 750 and by_id["l2"].lp == 750
    assert 1100 < by_id["brace"].lp < 1450 and any(e.miter or e.bevel for e in by_id["brace"].ends)
