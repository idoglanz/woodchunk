"""2D sketches (the project's scratch pads): points, shapes on them and constraints. Solved in the
browser (frontend/src/lib/sketch); the server stores them and checks they hang together."""

from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.models.common import Model, new_id

MAX_MM = 100_000.0  # 100 m: further out is a typo
# Every sketch has these, unstored: an origin fixed at 0, 0 and the two axes through it.
ORIGIN, AXES = "origin", {"x_axis", "y_axis"}
Mm = Annotated[float, Field(ge=-MAX_MM, le=MAX_MM)]


class SketchPoint(Model):
    id: str = Field(min_length=1, max_length=40)
    x: Mm
    y: Mm


class SketchLine(Model):
    id: str = Field(min_length=1, max_length=40)
    kind: Literal["line"] = "line"
    a: str
    b: str


class SketchCircle(Model):
    id: str = Field(min_length=1, max_length=40)
    kind: Literal["circle"] = "circle"
    c: str
    r: float = Field(gt=0, le=MAX_MM)


class SketchArc(Model):
    """Centre, start and end, counter-clockwise from start to end."""

    id: str = Field(min_length=1, max_length=40)
    kind: Literal["arc"] = "arc"
    c: str
    a: str
    b: str


SketchShape = Annotated[SketchLine | SketchCircle | SketchArc, Field(discriminator="kind")]

ConstraintKind = Literal[
    "coincident", "horizontal", "vertical", "parallel", "perpendicular", "equal", "tangent",
    "on_line", "on_circle", "midpoint", "fix",
    "distance", "point_line_distance", "angle", "radius", "diameter",
]


class SketchConstraint(Model):
    id: str = Field(min_length=1, max_length=40)
    kind: ConstraintKind
    refs: list[str] = Field(min_length=1, max_length=3)
    value: float | None = Field(default=None, ge=-MAX_MM, le=MAX_MM)  # mm, or degrees for angles
    driving: bool = True  # false: a reference dimension (measures, doesn't constrain)
    side: int | None = Field(default=None, ge=-1, le=1)


class Sketch(Model):
    id: str = Field(default_factory=new_id, max_length=40)
    name: str = Field(default="Sketch", min_length=1, max_length=80)
    assembly_id: str | None = Field(default=None, max_length=40)  # the assembly it's drawn for, if any
    points: list[SketchPoint] = Field(default=[], max_length=2000)
    shapes: list[SketchShape] = Field(default=[], max_length=2000)
    constraints: list[SketchConstraint] = Field(default=[], max_length=4000)

    @model_validator(mode="after")
    def _references(self):
        """Ids are unique, shapes use existing points (or the origin), constraints existing points,
        shapes, the origin or an axis."""
        points = {p.id for p in self.points}
        shapes = {s.id for s in self.shapes}
        if len(points) != len(self.points) or len(shapes) != len(self.shapes) or points & shapes:
            raise ValueError("sketch ids must be unique")
        if (points | shapes) & (AXES | {ORIGIN}):
            raise ValueError("origin, x_axis and y_axis are built in")
        points |= {ORIGIN}
        for s in self.shapes:
            used = [s.a, s.b] if s.kind == "line" else [s.c] if s.kind == "circle" else [s.c, s.a, s.b]
            if any(p not in points for p in used):
                raise ValueError(f"shape {s.id} uses a point that isn't in the sketch")
        for c in self.constraints:
            if any(r not in points and r not in shapes and r not in AXES for r in c.refs):
                raise ValueError(f"constraint {c.id} refers to something that isn't in the sketch")
        return self
