from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import Field

from app.auth import current_user
from app.db import get_db
from app.models.catalog import CatalogItem
from app.models.common import Model
from app.models.inventory import InventoryEntry, InventoryIn, InventoryOut, StockStatus
from app.models.user import User

router = APIRouter(prefix="/api/workshop", tags=["workshop"])


async def _out(entries: list[InventoryEntry]) -> list[InventoryOut]:
    db = get_db()
    items = {d["_id"]: CatalogItem.from_mongo(d)
             async for d in db.catalog_items.find({"_id": {"$in": list({e.item_id for e in entries})}})}
    pids = list({e.source_project_id for e in entries if e.source_project_id})
    projects = {d["_id"]: d["name"] async for d in db.projects.find({"_id": {"$in": pids}}, {"name": 1})}
    return [InventoryOut(**e.model_dump(), item_name=items[e.item_id].name.en if e.item_id in items else "",
                         item_kind=items[e.item_id].kind if e.item_id in items else "",
                         source_project_name=projects.get(e.source_project_id or "", ""))
            for e in entries]


@router.get("/inventory", response_model=list[InventoryOut])
async def list_inventory(include_used: bool = False, user: User = Depends(current_user)):
    q: dict = {"owner_id": user.id}
    if not include_used:
        q["status"] = StockStatus.available
    entries = [InventoryEntry.from_mongo(d) async for d in get_db().inventory.find(q).sort("created_at", -1)]
    return await _out(entries)


@router.post("/inventory", response_model=InventoryOut, status_code=201)
async def add_inventory(body: InventoryIn, user: User = Depends(current_user)):
    item = await get_db().catalog_items.find_one({"_id": body.item_id})
    if item is None or item["kind"] == "hardware":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pick a lumber or sheet material.")
    if item["kind"] == "sheet" and not body.width_mm:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Sheet pieces need a width.")
    e = InventoryEntry(**body.model_dump(), owner_id=user.id)
    if item["kind"] == "lumber":
        e.width_mm = None
    await get_db().inventory.insert_one(e.to_mongo())
    return (await _out([e]))[0]


class InventoryPatch(Model):
    qty: int | None = Field(default=None, ge=1)
    length_mm: float | None = Field(default=None, gt=0)
    width_mm: float | None = Field(default=None, gt=0)
    note: str | None = None
    status: StockStatus | None = None


@router.patch("/inventory/{entry_id}", response_model=InventoryOut)
async def patch_inventory(entry_id: str, body: InventoryPatch, user: User = Depends(current_user)):
    changes = body.model_dump(exclude_none=True)
    d = await get_db().inventory.find_one_and_update({"_id": entry_id, "owner_id": user.id}, {"$set": changes},
                                                     return_document=True)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not in your workshop.")
    return (await _out([InventoryEntry.from_mongo(d)]))[0]


@router.delete("/inventory/{entry_id}", status_code=204)
async def delete_inventory(entry_id: str, user: User = Depends(current_user)):
    await get_db().inventory.delete_one({"_id": entry_id, "owner_id": user.id})
