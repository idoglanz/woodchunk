"""A drawn frame (weldment): nodes in 3D, members between them, and how corners meet.

Lengths are millimetres. World axes: X = width, Y = depth, Z = up. Node coordinates are numbers
or small expressions of the frame's named parameters ("W", "H - 40", "D/2").
"""

from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.models.common import Model, new_id

Anchor = Literal["auto", "c", "t", "b", "l", "r", "tl", "tr", "bl", "br"]

MAX_MM = 100_000.0  # 100 m: far beyond any frame, small enough to keep the math finite
MAX_EXPR = 200
MAX_NODES = 2000
MAX_MEMBERS = 2000


class FrameParam(Model):
    name: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$", max_length=32)
    mm: float = Field(ge=-MAX_MM, le=MAX_MM)
    label: str = Field(default="", max_length=60)  # "Width", "Middle shelf height"…


class FrameNode(Model):
    id: str = Field(default_factory=new_id, min_length=1, max_length=64)
    x: float | str = 0.0
    y: float | str = 0.0
    z: float | str = 0.0

    @field_validator("x", "y", "z")
    @classmethod
    def _bounded(cls, v: float | str) -> float | str:
        if isinstance(v, str):
            if len(v) > MAX_EXPR:
                raise ValueError(f"expression longer than {MAX_EXPR} characters")
        elif not -MAX_MM <= v <= MAX_MM:
            raise ValueError("coordinate out of range")
        return v


class FrameMember(Model):
    id: str = Field(default_factory=new_id, min_length=1, max_length=64)
    a: str = Field(max_length=64)
    b: str = Field(max_length=64)
    item_id: str | None = Field(default=None, max_length=64)
    roll_deg: float = Field(default=0, ge=-360, le=360)
    # Which point of the profile sits on the line. "auto" follows the frame's `lines` setting:
    # outside dimensions put the profile on the inner side of the line.
    anchor: Anchor = "auto"
    name: str = Field(default="", max_length=60)


class FrameJoint(Model):
    """An override for how the members meeting at a node are cut."""

    node: str = Field(max_length=64)
    kind: Literal["miter", "butt"]
    through: str | None = Field(default=None, max_length=64)  # butt: the member that runs through


class FrameDefaults(Model):
    corner: Literal["miter", "butt"] = "butt"
    lines: Literal["outside", "centerline"] = "outside"


class Frame(Model):
    version: int = 1
    params: list[FrameParam] = Field(default=[], max_length=50)
    defaults: FrameDefaults = FrameDefaults()
    nodes: list[FrameNode] = Field(default=[], max_length=MAX_NODES)
    members: list[FrameMember] = Field(default=[], max_length=MAX_MEMBERS)
    joints: list[FrameJoint] = Field(default=[], max_length=MAX_NODES)

    @model_validator(mode="after")
    def _unique(self):
        for what, ids in (("parameter", [p.name for p in self.params]), ("node", [n.id for n in self.nodes]),
                          ("member", [m.id for m in self.members])):
            if len(ids) != len(set(ids)):
                raise ValueError(f"duplicate {what} ids")
        return self
