from datetime import datetime
from enum import StrEnum

from pydantic import Field, field_validator

from app.models.common import Doc, Localized, Model, now


class ItemKind(StrEnum):
    lumber = "lumber"
    sheet = "sheet"
    hardware = "hardware"


class ItemStatus(StrEnum):
    active = "active"
    suggested = "suggested"  # proposed by a user or an import, awaiting an admin
    retired = "retired"


class LumberStock(Model):
    length_mm: float = Field(gt=0)
    price: float | None = Field(default=None, ge=0)  # None: derive from price_per_m


class SheetStock(Model):
    length_mm: float = Field(gt=0)
    width_mm: float = Field(gt=0)
    price: float | None = Field(default=None, ge=0)


class PricePoint(Model):
    at: datetime = Field(default_factory=now)
    price: float
    note: str = ""


class Supplier(Doc):
    name: str
    url: str = ""
    currency: str = "ILS"
    notes: str = ""
    created_at: datetime = Field(default_factory=now)


class SupplierIn(Model):
    name: str = Field(min_length=1)
    url: str = ""
    currency: str = "ILS"
    notes: str = ""


class CatalogItemBase(Model):
    kind: ItemKind
    supplier_id: str | None = None
    name: Localized
    sku: str = ""
    url: str = ""
    image: str = ""
    category: str = ""
    tags: list[str] = []
    material: str = ""  # pine, birch plywood, MDF, steel…
    treatment: str = ""  # treated, untreated, planed…
    # lumber: cross-section; sheet: thickness only
    thickness_mm: float | None = Field(default=None, gt=0)
    width_mm: float | None = Field(default=None, gt=0)
    price_per_m: float | None = Field(default=None, ge=0)
    lumber_stock: list[LumberStock] = []
    sheet_stock: list[SheetStock] = []
    has_grain: bool = True
    # hardware
    unit: str = "each"
    pack_size: int = Field(default=1, ge=1)
    price: float | None = Field(default=None, ge=0)

    @field_validator("tags")
    @classmethod
    def _clean_tags(cls, v: list[str]) -> list[str]:
        return sorted({t.strip().lower() for t in v if t.strip()})

    def stock_price(self, length_mm: float) -> float | None:
        for st in self.lumber_stock:
            if abs(st.length_mm - length_mm) < 0.5 and st.price is not None:
                return st.price
        if self.price_per_m is not None:
            return round(self.price_per_m * length_mm / 1000, 2)
        return None

    def display_name(self, lang: str = "en") -> str:
        return self.name.get(lang)


class CatalogItem(Doc, CatalogItemBase):
    status: ItemStatus = ItemStatus.active
    price_updated_at: datetime | None = None
    price_history: list[PricePoint] = []
    source_url: str = ""
    created_by: str | None = None
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)
    search: str = ""  # lowercased text for simple search

    def refresh_search(self) -> None:
        parts = [self.name.en, self.name.he, self.material, self.treatment, self.category, self.sku, *self.tags]
        if self.thickness_mm and self.width_mm:
            parts.append(f"{self.width_mm:g}x{self.thickness_mm:g} {self.thickness_mm:g}x{self.width_mm:g}")
        elif self.thickness_mm:
            parts.append(f"{self.thickness_mm:g}mm")
        self.search = " ".join(p for p in parts if p).lower().replace("×", "x")


class CatalogItemIn(CatalogItemBase):
    pass


class CatalogItemOut(CatalogItem):
    supplier_name: str = ""
