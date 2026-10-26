"""Shared loaders for routers: projects with access checks, catalog maps, plan inputs."""

from __future__ import annotations

from typing import Literal

from fastapi import HTTPException, status

from app.db import get_db
from app.models.catalog import CatalogItem, Supplier
from app.models.inventory import InventoryEntry
from app.models.project import Project, ProjectStatus, Role
from app.models.user import User
from app.services.planner import PlanInputs, compute_plan

Need = Literal["view", "edit", "owner"]


async def load_project(project_id: str, user: User, need: Need = "view") -> Project:
    doc = await get_db().projects.find_one({"_id": project_id})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found.")
    p = Project.from_mongo(doc)
    role = p.role_of(user.id)
    public_template = p.is_template and p.template is not None and p.template.public
    if role is None and not user.is_admin and not (need == "view" and public_template):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found.")
    if need == "edit" and role not in (Role.owner, Role.editor) and not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can view this project but not edit it.")
    if need == "owner" and role != Role.owner and not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the project owner can do that.")
    return p


def edited_by(user: User) -> dict:
    """Fields recording who made a project's latest change."""
    return {"updated_by": user.id, "updated_by_name": user.name or user.email}


def project_item_ids(p: Project) -> set[str]:
    ids = {pt.item_id for a in p.assemblies for pt in a.parts if pt.item_id}
    ids |= {h.item_id for a in p.assemblies for h in a.hardware if h.item_id}
    ids |= {h.item_id for h in p.extras if h.item_id}
    if p.purchase:
        ids |= {ln.item_id for ln in p.purchase.lines}
    return ids


async def load_items(ids: set[str] | None = None) -> dict[str, CatalogItem]:
    q = {"_id": {"$in": list(ids)}} if ids is not None else {}
    return {d["_id"]: CatalogItem.from_mongo(d) async for d in get_db().catalog_items.find(q)}


async def load_suppliers() -> dict[str, Supplier]:
    return {d["_id"]: Supplier.from_mongo(d) async for d in get_db().suppliers.find({})}


async def load_inventory(owner_id: str, item_ids: set[str]) -> list[InventoryEntry]:
    q = {"owner_id": owner_id, "status": "available", "item_id": {"$in": list(item_ids)}}
    return [InventoryEntry.from_mongo(d) async for d in get_db().inventory.find(q)]


async def translations_for(project_id: str, lang: str) -> dict[str, str]:
    if lang == "en":
        return {}
    doc = await get_db().translations.find_one({"project_id": project_id, "lang": lang})
    return doc["strings"] if doc else {}


async def plan_for(p: Project, lang: str = "en", save_total: bool = True):
    ids = project_item_ids(p)
    items = await load_items(ids)
    suppliers = await load_suppliers()
    if not p.settings.use_inventory or p.is_template:
        inventory = []  # a template is planned for anyone: not against its author's workshop
    elif p.status in (ProjectStatus.cut, ProjectStatus.done) and p.cut_inventory is not None:
        inventory = p.cut_inventory
    else:
        inventory = await load_inventory(p.owner_id, ids)
    tr = await translations_for(p.id, lang)
    inp = PlanInputs(project=p, items=items, suppliers=suppliers, inventory=inventory, lang=lang,
                     translate=(lambda s: tr.get(s, s)) if tr else None)
    plan = await compute_plan(inp)
    if save_total and lang == "en" and p.last_total != plan.totals.cost and not p.is_template:
        await get_db().projects.update_one({"_id": p.id}, {"$set": {"last_total": plan.totals.cost}})
    return plan, items, suppliers, inventory
