from datetime import datetime
from enum import StrEnum
from string import ascii_uppercase
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.models.common import Doc, Model, new_id, now
from app.models.frame import Frame
from app.models.inventory import InventoryEntry


class ProjectStatus(StrEnum):
    planning = "planning"
    bought = "bought"
    cut = "cut"
    done = "done"


class Role(StrEnum):
    owner = "owner"
    editor = "editor"
    viewer = "viewer"


class CuttingSettings(Model):
    """How the shop cuts. Saw widths are separate because sheets are usually cut with a
    track/table saw and lumber with a miter or circular saw."""

    kerf_sheet_mm: float = Field(default=3.0, ge=0, le=10)
    kerf_lumber_mm: float = Field(default=3.0, ge=0, le=10)
    end_trim_mm: float = Field(default=0.0, ge=0, le=200)  # squared off the factory end of a board
    edge_trim_mm: float = Field(default=0.0, ge=0, le=100)  # trimmed off every sheet edge
    allow_rotation: bool = True  # rotate sheet parts that are not grain-locked
    min_offcut_mm: float = Field(default=300.0, ge=0)  # shortest lumber leftover worth keeping
    min_offcut_sheet_mm: float = Field(default=150.0, ge=0)  # narrowest sheet leftover worth keeping
    max_stock_length_mm: float | None = Field(default=None, gt=0)  # longest board you can carry
    use_inventory: bool = True
    # The saw's range, for warnings on angled cuts from frames.
    max_miter_deg: float = Field(default=50.0, ge=0, le=90)
    max_bevel_deg: float = Field(default=45.0, ge=0, le=90)


class EndCutSpec(Model):
    """Saw settings for one end of a bar: miter = table rotation, bevel = blade tilt (0 = square)."""

    miter: float = Field(default=0, ge=0, le=90)
    bevel: float = Field(default=0, ge=0, le=90)


class Part(Model):
    id: str = Field(default_factory=new_id)
    name: str = ""
    item_id: str | None = None
    qty: int = Field(default=1, ge=1, le=10000)
    length_mm: float = Field(default=0, ge=0, le=100_000)  # bars from a frame: long point to long point
    width_mm: float | None = Field(default=None, ge=0, le=100_000)  # sheet parts only
    grain_locked: bool = False
    notes: str = ""
    # Set on parts generated from the assembly's frame (read-only in the editor).
    members: list[str] = Field(default=[], max_length=10_000)  # frame member ids this part is cut for
    short_mm: float | None = Field(default=None, ge=0)  # short point
    cuts: list[EndCutSpec] = Field(default=[], max_length=2)  # the two ends
    face_up: Literal["top", "side", ""] = ""


class HardwareLine(Model):
    id: str = Field(default_factory=new_id)
    item_id: str | None = None
    name: str = ""
    qty: float = Field(default=1, ge=0)
    unit_price: float | None = Field(default=None, ge=0)  # overrides catalog price


class Assembly(Model):
    id: str = Field(default_factory=new_id)
    letter: str = ""
    name: str = ""
    qty: int = Field(default=1, ge=1, le=10000)
    parts: list[Part] = Field(default=[], max_length=1000)
    hardware: list[HardwareLine] = Field(default=[], max_length=300)
    notes: str = Field(default="", max_length=5000)
    # A drawn assembly: its parts are generated from this frame on every save.
    frame: Frame | None = None
    frame_warnings: list[str] = []


class PurchaseLine(Model):
    item_id: str
    kind: str  # lumber | sheet | hardware
    length_mm: float | None = None
    width_mm: float | None = None
    qty: float
    unit_price: float | None = None


class Purchase(Model):
    at: datetime = Field(default_factory=now)
    lines: list[PurchaseLine] = []


class Member(Model):
    user_id: str
    role: Role
    email: str = ""
    name: str = ""


class TemplateMeta(Model):
    title: str
    summary: str = ""
    category: str = ""
    public: bool = False


def letter_for(index: int) -> str:
    """0 → A … 25 → Z, 26 → AA …"""
    s = ""
    index += 1
    while index:
        index, r = divmod(index - 1, 26)
        s = ascii_uppercase[r] + s
    return s


class ProjectContent(Model):
    """The part of a project the editor changes (and autosaves)."""

    name: str = Field(default="Untitled project", min_length=1, max_length=120)
    description: str = Field(default="", max_length=5000)
    settings: CuttingSettings = CuttingSettings()
    assemblies: list[Assembly] = Field(default=[], max_length=200)
    extras: list[HardwareLine] = Field(default=[], max_length=300)

    @model_validator(mode="after")
    def _assign_letters(self):
        used = {a.letter for a in self.assemblies if a.letter}
        seen: set[str] = set()
        i = 0
        for a in self.assemblies:
            if not a.letter or a.letter in seen:
                while letter_for(i) in used:
                    i += 1
                a.letter = letter_for(i)
                used.add(a.letter)
            seen.add(a.letter)
        return self


class Project(Doc, ProjectContent):
    owner_id: str
    members: list[Member] = []
    status: ProjectStatus = ProjectStatus.planning
    archived: bool = False
    purchase: Purchase | None = None
    # The workshop stock as it was when the project was cut: its plan keeps using it afterwards,
    # so cutting (which uses up boards and adds offcuts) doesn't change what the project shows.
    cut_inventory: list[InventoryEntry] | None = None
    shopping_checked: list[str] = []  # shopping line keys ticked off
    last_total: float | None = None  # cached from the latest plan, for project cards
    is_template: bool = False
    template: TemplateMeta | None = None
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)
    version: int = 1
    # Who made the latest change (shown to collaborators), and a counter of shopping ticks, which
    # don't change the version: open copies watch both to refresh.
    updated_by: str = ""
    updated_by_name: str = ""
    checks_rev: int = 0

    def role_of(self, user_id: str) -> Role | None:
        for m in self.members:
            if m.user_id == user_id:
                return m.role
        return None

    def part_labels(self) -> dict[str, str]:
        return {p.id: f"{a.letter}{i + 1}" for a in self.assemblies for i, p in enumerate(a.parts)}


class ProjectUpdate(ProjectContent):
    version: int

    @field_validator("assemblies")
    @classmethod
    def _limit(cls, v):
        if len(v) > 200:
            raise ValueError("too many assemblies")
        return v


class ProjectCreate(Model):
    name: str = "Untitled project"
    description: str = ""
    template_id: str | None = None


class ProjectSummary(Model):
    id: str
    name: str
    description: str
    status: ProjectStatus
    archived: bool
    role: Role
    updated_at: datetime
    assemblies: int
    parts: int
    total_cost: float | None = None
    is_template: bool = False
    owner_name: str = ""
