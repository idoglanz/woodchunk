"""A drawn frame (weldment): nodes in 3D, members between them, and how corners meet.

Lengths are millimetres. World axes: X = width, Y = depth, Z = up. Node coordinates are numbers
or small expressions of the frame's named parameters ("W", "H - 40", "D/2").
"""

from typing import Literal

from pydantic import Field

from app.models.common import Model, new_id

Anchor = Literal["auto", "c", "t", "b", "l", "r", "tl", "tr", "bl", "br"]


class FrameParam(Model):
    name: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    mm: float


class FrameNode(Model):
    id: str = Field(default_factory=new_id)
    x: float | str = 0.0
    y: float | str = 0.0
    z: float | str = 0.0


class FrameMember(Model):
    id: str = Field(default_factory=new_id)
    a: str
    b: str
    item_id: str | None = None
    roll_deg: float = 0
    # Which point of the profile sits on the line. "auto" follows the frame's `lines` setting:
    # outside dimensions put the profile on the inner side of the line.
    anchor: Anchor = "auto"
    name: str = ""


class FrameJoint(Model):
    """An override for how the members meeting at a node are cut."""

    node: str
    kind: Literal["miter", "butt"]
    through: str | None = None  # butt: the member that runs through


class FrameDefaults(Model):
    corner: Literal["miter", "butt"] = "butt"
    lines: Literal["outside", "centerline"] = "outside"


class Frame(Model):
    version: int = 1
    params: list[FrameParam] = []
    defaults: FrameDefaults = FrameDefaults()
    nodes: list[FrameNode] = []
    members: list[FrameMember] = []
    joints: list[FrameJoint] = []
