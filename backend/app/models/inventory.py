from datetime import datetime
from enum import StrEnum

from pydantic import Field

from app.models.common import Doc, Model, now


class StockKind(StrEnum):
    full = "full"  # a whole board/sheet you own
    offcut = "offcut"


class StockStatus(StrEnum):
    available = "available"
    used = "used"


class InventoryIn(Model):
    item_id: str
    kind: StockKind = StockKind.offcut
    length_mm: float = Field(gt=0)
    width_mm: float | None = Field(default=None, gt=0)
    qty: int = Field(default=1, ge=1)
    note: str = ""


class InventoryEntry(Doc, InventoryIn):
    owner_id: str
    status: StockStatus = StockStatus.available
    source_project_id: str | None = None
    created_at: datetime = Field(default_factory=now)


class InventoryOut(InventoryEntry):
    item_name: str = ""
    item_kind: str = ""
    source_project_name: str = ""
