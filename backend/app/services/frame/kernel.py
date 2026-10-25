"""Frame geometry and cut list.

Turns a drawn frame (nodes, members, joints) into straight members bounded by two end planes,
then measures each one the way a shop does: long point to long point (LP), short point (SP), and
per end the saw settings (miter = table rotation, bevel = blade tilt, 0° = square).

Mirrored in frontend/src/lib/frame/kernel.ts (the editor's live view); this copy is the authority
for plans and exports. Both run the golden fixtures in fixtures/frames/. Keep them in step:
same formulas, same order of operations, same rounding.

Member frame: x = axis from node a to node b. The profile's "up" (v) is world Z projected off the
axis (world Y for vertical members); u = v × x, so (x, u, v) is right-handed. roll_deg turns
(u, v) about x. A profile is centred on its bounding box in (u, v); the anchor says which point of
it sits on the line.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from app.models.frame import Frame, FrameMember
from app.services.frame.expr import ExprError, evaluate

Vec = tuple[float, float, float]
UV = tuple[float, float]

ON_LINE_MM = 0.5  # a node this close to a member's span sits on it (a T)
AUTO_SIDE_MM = 1.0  # the frame's centre must be this far off a line to pick a side
MIN_PLANE_COS = 0.02  # end planes nearly parallel to the axis are rejected
VERTICAL_Z = 0.7  # members steeper than this run through at butt joints by default
# A member this close to vertical takes its profile "up" from world Y instead of Z. Kept far from
# normal splays (cos 30°) so a slightly splayed leg doesn't turn its section 90°.
UPRIGHT_Z = 0.866
STRAIGHT = 0.999  # two ends this opposed at a joint are one straight run
MAX_COORD = 100_000.0  # 100 m: anything further out is a typo, not a frame


# --- vectors -------------------------------------------------------------------------------------

def add(a: Vec, b: Vec) -> Vec:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def scale(a: Vec, k: float) -> Vec:
    return (a[0] * k, a[1] * k, a[2] * k)


def dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: Vec, b: Vec) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def length(a: Vec) -> float:
    return math.sqrt(dot(a, a))


def unit(a: Vec) -> Vec:
    n = length(a)
    return (0.0, 0.0, 0.0) if n < 1e-12 else scale(a, 1 / n)


def rnd(x: float, digits: int = 1) -> float:
    """Half away from zero, identical in Python and JS (Python's round() is banker's); symmetric, so
    mirror-image values round alike."""
    f = 10**digits
    v = math.floor(abs(x) * f + 0.5) / f
    v = -v if x < 0 else v
    return 0.0 if v == 0 else v


# --- profiles ------------------------------------------------------------------------------------

CIRCLE_SEGMENTS = 24
SHAPES = ("rect", "flat_bar", "rect_tube", "round_tube", "round_bar", "angle", "channel")


@dataclass(frozen=True)
class Profile:
    """A cross-section in (u, v), centred on its bounding box. w along u, h along v, t = wall."""

    shape: str
    w: float
    h: float
    t: float = 0.0

    def loops(self) -> list[list[UV]]:
        """Outer loop counter-clockwise, then holes clockwise."""
        w2, h2, t = self.w / 2, self.h / 2, self.t
        if self.shape in ("round_tube", "round_bar"):
            outer = _circle(w2)
            if self.shape == "round_tube" and 0 < t < w2:
                return [outer, _circle(w2 - t)[::-1]]
            return [outer]
        if self.shape == "angle":  # legs along the bottom (-v) and left (-u) edges
            return [[(-w2, -h2), (w2, -h2), (w2, -h2 + t), (-w2 + t, -h2 + t), (-w2 + t, h2), (-w2, h2)]]
        if self.shape == "channel":  # web along the bottom, flanges up
            return [[(-w2, -h2), (w2, -h2), (w2, h2), (w2 - t, h2), (w2 - t, -h2 + t),
                     (-w2 + t, -h2 + t), (-w2 + t, h2), (-w2, h2)]]
        outer = _rect(w2, h2)
        if self.shape == "rect_tube" and 0 < t < min(w2, h2):
            return [outer, _rect(w2 - t, h2 - t)[::-1]]
        return [outer]

    def symmetry(self) -> str:
        """Which turns of the bar leave its section unchanged (for grouping identical pieces)."""
        if self.shape in ("rect", "flat_bar", "rect_tube", "round_tube", "round_bar"):
            return "square" if abs(self.w - self.h) < 1e-6 else "rect"
        if self.shape == "channel":
            return "mirror_u"
        return "none"


def _rect(w2: float, h2: float) -> list[UV]:
    return [(-w2, -h2), (w2, -h2), (w2, h2), (-w2, h2)]


def _circle(r: float) -> list[UV]:
    return [(r * math.cos(2 * math.pi * k / CIRCLE_SEGMENTS), r * math.sin(2 * math.pi * k / CIRCLE_SEGMENTS))
            for k in range(CIRCLE_SEGMENTS)]


FALLBACK_PROFILE = Profile("rect", 30, 30)  # members without a material, so they can still be drawn


# --- results -------------------------------------------------------------------------------------

@dataclass
class Plane:
    point: Vec
    normal: Vec  # unit, pointing out of the member


@dataclass
class EndCut:
    miter: float  # degrees, 0 = square
    bevel: float
    normal: Vec  # outward normal in the member frame (x, u, v), for diagrams


@dataclass
class MemberResult:
    id: str
    item_id: str | None
    a: Vec  # node positions
    b: Vec
    x: Vec  # member frame
    u: Vec
    v: Vec
    anchor_uv: UV  # the profile point that sits on the line
    profile: Profile
    planes: tuple[Plane, Plane]
    lp: float
    sp: float
    ends: tuple[EndCut, EndCut]
    face_up: str  # "top": the profile's +v face up on the saw; "side": turned 90° so +u is up
    key: str = ""


@dataclass
class CutGroup:
    key: str
    item_id: str | None
    qty: int
    lp: float
    sp: float
    ends: tuple[EndCut, EndCut]
    face_up: str
    members: list[str] = field(default_factory=list)


@dataclass
class FrameResult:
    members: list[MemberResult]
    groups: list[CutGroup]
    warnings: list[str]


# --- solving -------------------------------------------------------------------------------------

@dataclass
class _M:
    label: str
    m: FrameMember
    a: Vec
    b: Vec
    x: Vec
    u: Vec
    v: Vec
    profile: Profile
    cu: float = 0.0
    cv: float = 0.0
    planes: list[Plane | None] = field(default_factory=lambda: [None, None])

    def offset(self, p: UV) -> Vec:
        """World offset from the line to profile point p."""
        return add(scale(self.u, p[0] - self.cu), scale(self.v, p[1] - self.cv))

    def outer(self) -> list[Vec]:
        return [self.offset(p) for p in self.profile.loops()[0]]

    def node_pos(self, end: int) -> Vec:
        return self.a if end == 0 else self.b

    def into(self, end: int) -> Vec:
        """Direction from this end's node into the member."""
        return self.x if end == 0 else scale(self.x, -1)

    def length(self) -> float:
        return length(sub(self.b, self.a))


def member_axes(a: Vec, b: Vec, roll_deg: float) -> tuple[Vec, Vec, Vec]:
    x = unit(sub(b, a))
    ref: Vec = (0.0, 1.0, 0.0) if abs(x[2]) > UPRIGHT_Z else (0.0, 0.0, 1.0)
    v = unit(sub(ref, scale(x, dot(ref, x))))
    u = cross(v, x)
    if roll_deg:
        c, s = math.cos(math.radians(roll_deg)), math.sin(math.radians(roll_deg))
        u, v = add(scale(u, c), scale(v, s)), add(scale(u, -s), scale(v, c))
    return x, u, v


_ANCHORS: dict[str, UV] = {"c": (0, 0), "t": (0, 1), "b": (0, -1), "l": (-1, 0), "r": (1, 0),
                           "tl": (-1, 1), "tr": (1, 1), "bl": (-1, -1), "br": (1, -1)}


def _place_anchor(mm: _M, centroid: Vec, outside: bool) -> None:
    w2, h2 = mm.profile.w / 2, mm.profile.h / 2
    if mm.m.anchor != "auto":
        ku, kv = _ANCHORS[mm.m.anchor]
        mm.cu, mm.cv = ku * w2, kv * h2
        return
    if not outside:
        return
    mid = scale(add(mm.a, mm.b), 0.5)
    toward = sub(centroid, mid)
    su, sv = dot(toward, mm.u), dot(toward, mm.v)
    # The line is the outside edge: put the profile on the side facing the frame's centre.
    mm.cu = -w2 if su > AUTO_SIDE_MM else w2 if su < -AUTO_SIDE_MM else 0.0
    mm.cv = -h2 if sv > AUTO_SIDE_MM else h2 if sv < -AUTO_SIDE_MM else 0.0


def _face_plane(target: _M, node: Vec, d: Vec) -> tuple[Plane, float] | None:
    """The face of `target` that a member arriving along -d (body along +d from `node`) stops at.

    Returns the end plane for the arriving member and how far along d from the node it is.
    Faces are the target's bounding box in (u, v); round sections use their tangent plane.
    """
    w2, h2 = target.profile.w / 2, target.profile.h / 2
    faces = [(target.u, w2 - target.cu), (scale(target.u, -1), w2 + target.cu),
             (target.v, h2 - target.cv), (scale(target.v, -1), h2 + target.cv)]
    best: tuple[Vec, float] | None = None
    for f, dist in faces:
        if best is None or dot(f, d) > dot(best[0], d) + 1e-9:
            best = (f, dist)
    assert best is not None
    f, dist = best
    fd = dot(f, d)
    if fd < 0.05:
        return None
    # The face is the plane through (closest point of target's line to node) + f * dist.
    on_line = add(target.a, scale(target.x, dot(sub(node, target.a), target.x)))
    point = add(on_line, scale(f, dist))
    t = dot(sub(point, node), f) / fd
    return Plane(point, scale(f, -1)), t


def _square(node: Vec, d: Vec, shift: float = 0.0) -> Plane:
    """A square end at `node`, moved `shift` outward (away from the member body)."""
    return Plane(add(node, scale(d, -shift)), scale(d, -1))


def solve(frame: Frame, profiles: dict[str, Profile]) -> FrameResult:
    warnings: list[str] = []
    params = {p.name: p.mm for p in frame.params}
    pos: dict[str, Vec] = {}
    bad: set[str] = set()
    for n in frame.nodes:
        try:
            p = (evaluate(n.x, params), evaluate(n.y, params), evaluate(n.z, params))
            if any(abs(c) > MAX_COORD for c in p):
                raise ExprError("it's more than 100 m from the origin")
            pos[n.id] = p
        except ExprError as e:
            warnings.append(f"A joint's position can't be worked out: {e}")
            bad.add(n.id)

    ms: list[_M] = []
    for i, m in enumerate(frame.members):
        label = m.name or f"Bar {i + 1}"
        if m.a in bad or m.b in bad:
            warnings.append(f"{label} is left out: one of its joints has a bad position")
            continue
        if m.a not in pos or m.b not in pos or m.a == m.b:
            warnings.append(f"{label} needs two different joints")
            continue
        a, b = pos[m.a], pos[m.b]
        if length(sub(b, a)) < 1:
            warnings.append(f"{label} has no length")
            continue
        profile = profiles.get(m.item_id or "") or FALLBACK_PROFILE
        x, u, v = member_axes(a, b, m.roll_deg)
        ms.append(_M(label, m, a, b, x, u, v, profile))
        if not m.item_id or m.item_id not in profiles:
            warnings.append(f"{label} has no material")

    # Sum in a fixed order so the result is identical everywhere (Python and the editor).
    used = sorted({k for mm in ms for k in (mm.m.a, mm.m.b)})
    centroid: Vec = (0.0, 0.0, 0.0)
    for k in used:
        centroid = add(centroid, pos[k])
    if used:
        centroid = scale(centroid, 1 / len(used))
    for mm in ms:
        _place_anchor(mm, centroid, frame.defaults.lines == "outside")

    # Who meets at each node: member ends, and members whose span the node lies on (T-joints).
    ends_at: dict[str, list[tuple[_M, int]]] = {}
    spans_at: dict[str, list[_M]] = {}
    for mm in ms:
        ends_at.setdefault(mm.m.a, []).append((mm, 0))
        ends_at.setdefault(mm.m.b, []).append((mm, 1))
    for node_id, p in pos.items():
        for mm in ms:
            if node_id in (mm.m.a, mm.m.b):
                continue
            t = dot(sub(p, mm.a), mm.x)
            if 1e-6 < t < mm.length() - 1e-6 and length(sub(add(mm.a, scale(mm.x, t)), p)) <= ON_LINE_MM:
                spans_at.setdefault(node_id, []).append(mm)

    overrides = {j.node: j for j in frame.joints}
    for node_id, ends in ends_at.items():
        node = pos[node_id]
        spans = spans_at.get(node_id, [])
        j = overrides.get(node_id)
        if spans:
            for mm, e in ends:
                _butt_into(mm, e, node, spans, warnings)
            if j:
                warnings.append("A joint setting on a bar's span (a T-joint) is ignored: bars there always butt")
            continue
        if len(ends) == 1:
            continue
        # A straight run split at a joint continues: both halves end square, the rest butt into it.
        run = _straight_pair(ends)
        if run:
            for mm, e in run:
                mm.planes[e] = _square(node, mm.into(e))
            for mm, e in ends:
                if (mm, e) not in run:
                    _butt_into(mm, e, node, [run[0][0], run[1][0]], warnings)
            continue
        kind = j.kind if j else frame.defaults.corner
        through = _through(ends, j.through if j else None)
        if j and j.through and through[0].m.id != j.through:
            warnings.append("A joint's 'runs through' bar isn't at that joint; using the automatic choice")
        others = [x for x in ends if x is not through]
        if kind == "miter" and len(others) == 2 and len(ends) == 3:
            (m1, e1), (m2, e2) = others
            _miter(m1, e1, m2, e2, node)
            _butt_into(through[0], through[1], node, [m1, m2], warnings)
        elif kind == "miter" and len(ends) == 2:
            (m1, e1), (m2, e2) = ends
            _miter(m1, e1, m2, e2, node)
        else:
            if kind == "miter":
                warnings.append(f"Miters join 2 or 3 bars; {len(ends)} meet at one joint, so they butt")
            tm, te = through
            d_t = tm.into(te)
            reach = 0.0
            for mm, e in others:
                if dot(mm.into(e), d_t) > STRAIGHT:
                    warnings.append(f"{mm.label} and {tm.label} overlap along the same line")
                    continue
                _butt_into(mm, e, node, [tm], warnings)
                reach = max(reach, max(dot(q, scale(d_t, -1)) for q in mm.outer()))
            tm.planes[te] = _square(node, d_t, reach)

    results = [_measure(mm, warnings) for mm in ms]
    groups = _group(results)
    return FrameResult(results, groups, list(dict.fromkeys(warnings)))


def _straight_pair(ends: list[tuple[_M, int]]) -> list[tuple[_M, int]] | None:
    for i in range(len(ends)):
        for k in range(i + 1, len(ends)):
            if dot(ends[i][0].into(ends[i][1]), ends[k][0].into(ends[k][1])) < -STRAIGHT:
                return [ends[i], ends[k]]
    return None


def _through(ends: list[tuple[_M, int]], override: str | None) -> tuple[_M, int]:
    if override:
        for x in ends:
            if x[0].m.id == override:
                return x
    steep = max(ends, key=lambda x: abs(x[0].x[2]))
    if abs(steep[0].x[2]) > VERTICAL_Z:
        return steep
    return max(ends, key=lambda x: x[0].length())  # first longest wins ties (stable max)


def _miter(m1: _M, e1: int, m2: _M, e2: int, node: Vec) -> None:
    d1, d2 = m1.into(e1), m2.into(e2)
    n = unit(sub(d2, d1))
    if length(sub(d2, d1)) < 1e-9:
        m1.planes[e1] = _square(node, d1)
        m2.planes[e2] = _square(node, d2)
        return
    m1.planes[e1] = Plane(node, n)
    m2.planes[e2] = Plane(node, scale(n, -1))


def _butt_into(mm: _M, e: int, node: Vec, targets: list[_M], warnings: list[str]) -> None:
    """End `mm` at the first face of `targets` it reaches."""
    d = mm.into(e)
    best: tuple[Plane, float] | None = None
    for t in targets:
        hit = _face_plane(t, node, d)
        if hit and (best is None or hit[1] > best[1]):
            best = hit
    if best is None:
        warnings.append(f"{mm.label} meets {targets[0].label} at a very shallow angle; its end is left square")
        mm.planes[e] = _square(node, d)
    else:
        mm.planes[e] = best[0]


def _measure(mm: _M, warnings: list[str]) -> MemberResult:
    planes: list[Plane] = []
    for e in (0, 1):
        p = mm.planes[e] or _square(mm.node_pos(e), mm.into(e))
        if abs(dot(p.normal, mm.x)) < MIN_PLANE_COS:
            warnings.append(f"{mm.label}: a cut would run along the bar; its end is left square")
            p = _square(mm.node_pos(e), mm.into(e))
        planes.append(p)

    lengths = []
    for q in mm.outer():
        start = add(mm.a, q)
        ta = dot(sub(planes[0].point, start), planes[0].normal) / dot(mm.x, planes[0].normal)
        tb = dot(sub(planes[1].point, start), planes[1].normal) / dot(mm.x, planes[1].normal)
        lengths.append(tb - ta)
    lp, sp = max(lengths), min(lengths)
    if sp <= 0:
        warnings.append(f"{mm.label} is used up by its joints (too short for the bars around it)")

    local = [(dot(p.normal, mm.x), dot(p.normal, mm.u), dot(p.normal, mm.v)) for p in planes]
    # Lay the bar so the cuts need as little blade tilt as possible; prefer the profile's top up.
    top = max(_bevel(n[2]) for n in local)
    side = max(_bevel(n[1]) for n in local)
    face_up = "side" if side < top - 0.05 else "top"
    ends = tuple(_end_cut(n, face_up) for n in local)
    return MemberResult(mm.m.id, mm.m.item_id, mm.a, mm.b, mm.x, mm.u, mm.v, (mm.cu, mm.cv), mm.profile,
                        (planes[0], planes[1]), rnd(lp), rnd(sp), (ends[0], ends[1]), face_up)


def _bevel(component: float) -> float:
    return math.degrees(math.asin(min(1.0, abs(component))))


def _end_cut(n: Vec, face_up: str) -> EndCut:
    nx, nu, nv = n
    across, tilt = (nu, nv) if face_up == "top" else (nv, nu)
    miter = math.degrees(math.atan2(abs(across), abs(nx)))
    return EndCut(rnd(miter), rnd(_bevel(tilt)), (rnd(nx, 3), rnd(nu, 3), rnd(nv, 3)))


# --- grouping identical pieces -------------------------------------------------------------------

def _turns(symmetry: str) -> list[tuple[bool, int, int, bool]]:
    """Rigid turns of a bar that keep its section: (flip end for end, u sign, v sign, swap u/v)."""
    turns = [(False, 1, 1, False)]
    if symmetry in ("rect", "square"):
        turns += [(False, -1, -1, False), (True, -1, 1, False), (True, 1, -1, False)]
    elif symmetry == "mirror_u":
        turns += [(True, -1, 1, False)]
    if symmetry == "square":
        turns += [(False, -1, 1, True), (False, 1, -1, True), (True, 1, 1, True), (True, -1, -1, True)]
    return turns


def num(x: float) -> str:
    """Shortest fixed form of a number, identical in Python and JS (keys and ids depend on it)."""
    s = f"{rnd(x, 3):.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _key(r: MemberResult) -> str:
    best: tuple | None = None
    for flip, su, sv, swap in _turns(r.profile.symmetry()):
        ns = [e.normal for e in r.ends]
        if flip:
            ns = ns[::-1]
        out = []
        for nx, nu, nv in ns:
            if swap:
                nu, nv = nv, nu
            out.append((rnd(-nx if flip else nx, 3) + 0.0, rnd(nu * su, 3) + 0.0, rnd(nv * sv, 3) + 0.0))
        cand = tuple(out)
        if best is None or cand < best:
            best = cand
    p = r.profile
    assert best is not None
    normals = ",".join(num(c) for n in best for c in n)
    return f"{r.item_id or ''}|{p.shape}:{num(p.w)}x{num(p.h)}x{num(p.t)}|{num(r.lp)}|{num(r.sp)}|{normals}"


def stable_id(text: str) -> str:
    """16 hex chars from two FNV-1a passes; the editor computes the same ids."""
    def fnv(seed: int) -> int:
        h = seed
        for byte in text.encode():
            h = ((h ^ byte) * 0x01000193) & 0xFFFFFFFF
        return h
    return f"{fnv(0x811C9DC5):08x}{fnv(0x01234567):08x}"


def _group(results: list[MemberResult]) -> list[CutGroup]:
    groups: dict[str, CutGroup] = {}
    for r in results:
        r.key = _key(r)
        g = groups.get(r.key)
        if g:
            g.qty += 1
            g.members.append(r.id)
        else:
            groups[r.key] = CutGroup(r.key, r.item_id, 1, r.lp, r.sp, r.ends, r.face_up, [r.id])
    return sorted(groups.values(), key=lambda g: (g.item_id or "", -g.lp, -g.sp, g.key))
