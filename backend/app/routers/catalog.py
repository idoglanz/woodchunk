from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth import admin_user, current_user
from app.db import get_db
from app.models.catalog import (
    CatalogItem,
    CatalogItemIn,
    CatalogItemOut,
    ItemKind,
    ItemStatus,
    PricePoint,
    Supplier,
    SupplierIn,
)
from app.models.common import Model, now
from app.models.user import User
from app.routers.deps import load_suppliers

router = APIRouter(prefix="/api", tags=["catalog"])


def _out(item: CatalogItem, suppliers: dict[str, Supplier]) -> CatalogItemOut:
    sup = suppliers.get(item.supplier_id or "")
    return CatalogItemOut(**item.model_dump(), supplier_name=sup.name if sup else "")


@router.get("/catalog", response_model=list[CatalogItemOut])
async def list_catalog(
    q: str = "", kind: ItemKind | None = None, status_: ItemStatus | None = Query(None, alias="status"),
    supplier_id: str | None = None,
    user: User = Depends(current_user),
):
    query: dict = {"status": status_.value if status_ else {"$ne": "retired"}}
    if status_ is None and not user.is_admin:
        query["status"] = "active"
    if kind:
        query["kind"] = kind.value
    if supplier_id:
        query["supplier_id"] = supplier_id
    for word in re.findall(r"\S+", q.lower())[:6]:
        query.setdefault("$and", []).append({"search": {"$regex": re.escape(word.replace("×", "x"))}})
    suppliers = await load_suppliers()
    cur = get_db().catalog_items.find(query).limit(1000)
    items = [CatalogItem.from_mongo(d) async for d in cur]
    order = {"lumber": 0, "sheet": 1, "hardware": 2}
    items.sort(key=lambda i: (order[i.kind], i.thickness_mm or 0, i.width_mm or 0, i.name.en.lower()))
    return [_out(i, suppliers) for i in items]


@router.get("/catalog/{item_id}", response_model=CatalogItemOut)
async def get_item(item_id: str, user: User = Depends(current_user)):
    d = await get_db().catalog_items.find_one({"_id": item_id})
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found.")
    return _out(CatalogItem.from_mongo(d), await load_suppliers())


def _price_signature(it: CatalogItemIn | CatalogItem) -> tuple:
    return (it.price_per_m, it.price, tuple((s.length_mm, s.price) for s in it.lumber_stock),
            tuple((s.length_mm, s.width_mm, s.price) for s in it.sheet_stock))


def _headline_price(it: CatalogItemIn | CatalogItem) -> float | None:
    if it.kind == ItemKind.lumber:
        return it.price_per_m
    if it.kind == ItemKind.sheet:
        return next((s.price for s in it.sheet_stock if s.price is not None), None)
    return it.price


@router.post("/catalog", response_model=CatalogItemOut, status_code=201)
async def create_item(body: CatalogItemIn, user: User = Depends(current_user)):
    item = CatalogItem(**body.model_dump(), status=ItemStatus.active if user.is_admin else ItemStatus.suggested,
                       created_by=user.id, price_updated_at=now())
    hp = _headline_price(item)
    if hp is not None:
        item.price_history = [PricePoint(price=hp, note="created")]
    item.refresh_search()
    await get_db().catalog_items.insert_one(item.to_mongo())
    return _out(item, await load_suppliers())


@router.put("/catalog/{item_id}", response_model=CatalogItemOut)
async def update_item(item_id: str, body: CatalogItemIn, user: User = Depends(admin_user)):
    d = await get_db().catalog_items.find_one({"_id": item_id})
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found.")
    old = CatalogItem.from_mongo(d)
    item = CatalogItem(**{**old.model_dump(), **body.model_dump(), "id": old.id, "updated_at": now()})
    if _price_signature(item) != _price_signature(old):
        item.price_updated_at = now()
        hp = _headline_price(item)
        if hp is not None:
            item.price_history = [*old.price_history, PricePoint(price=hp, note="edited")][-50:]
    item.refresh_search()
    await get_db().catalog_items.replace_one({"_id": item.id}, item.to_mongo())
    return _out(item, await load_suppliers())


class StatusIn(Model):
    status: ItemStatus


@router.post("/catalog/{item_id}/status", response_model=CatalogItemOut)
async def set_item_status(item_id: str, body: StatusIn, user: User = Depends(admin_user)):
    d = await get_db().catalog_items.find_one_and_update(
        {"_id": item_id}, {"$set": {"status": body.status.value, "updated_at": now()}}, return_document=True)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found.")
    return _out(CatalogItem.from_mongo(d), await load_suppliers())


@router.get("/suppliers", response_model=list[Supplier])
async def list_suppliers(user: User = Depends(current_user)):
    return [Supplier.from_mongo(d) async for d in get_db().suppliers.find({}).sort("name", 1)]


@router.post("/suppliers", response_model=Supplier, status_code=201)
async def create_supplier(body: SupplierIn, user: User = Depends(admin_user)):
    s = Supplier(**body.model_dump())
    await get_db().suppliers.insert_one(s.to_mongo())
    return s


@router.put("/suppliers/{supplier_id}", response_model=Supplier)
async def update_supplier(supplier_id: str, body: SupplierIn, user: User = Depends(admin_user)):
    d = await get_db().suppliers.find_one_and_update({"_id": supplier_id}, {"$set": body.model_dump()},
                                                    return_document=True)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier not found.")
    return Supplier.from_mongo(d)
