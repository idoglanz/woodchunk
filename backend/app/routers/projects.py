from __future__ import annotations

import csv
import io
import secrets
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response

from app.auth import current_user
from app.db import get_db
from app.models.catalog import CatalogItem
from app.models.common import Model, new_id, now
from app.models.inventory import InventoryEntry, StockKind, StockStatus
from app.models.plan import PlanOut, ShoppingOut
from app.models.project import (
    Member,
    Part,
    Project,
    ProjectContent,
    ProjectCreate,
    ProjectStatus,
    ProjectSummary,
    ProjectUpdate,
    Role,
    TemplateMeta,
)
from app.models.user import User
from app.routers.deps import load_project, plan_for
from app.services.ai.catalog_ai import translate_strings
from app.services.ai.client import AIServiceError
from app.services.frame.parts import derive_all
from app.services.ratelimit import check_ai_quota
from app.services.shopping import build_shopping, purchase_from

router = APIRouter(prefix="/api", tags=["projects"])
Lang = Literal["en", "he"]


def _fresh_ids(content: ProjectContent) -> ProjectContent:
    c = content.model_copy(deep=True)
    for a in c.assemblies:
        a.id = new_id()
        for p in a.parts:
            p.id = new_id()
        for h in a.hardware:
            h.id = new_id()
    for h in c.extras:
        h.id = new_id()
    return c


def _summary(p: Project, user: User) -> ProjectSummary:
    owner = next((m for m in p.members if m.role == Role.owner), None)
    return ProjectSummary(
        id=p.id, name=p.name, description=p.description, status=p.status, archived=p.archived,
        role=p.role_of(user.id) or Role.viewer, updated_at=p.updated_at, assemblies=len(p.assemblies),
        parts=sum(pt.qty * a.qty for a in p.assemblies for pt in a.parts), total_cost=p.last_total,
        is_template=p.is_template, owner_name=(owner.name or owner.email) if owner else "",
    )


@router.get("/projects", response_model=list[ProjectSummary])
async def list_projects(archived: bool = False, user: User = Depends(current_user)):
    q = {"members.user_id": user.id, "archived": archived, "is_template": False}
    cur = get_db().projects.find(q).sort("updated_at", -1)
    return [_summary(Project.from_mongo(d), user) async for d in cur]


@router.post("/projects", response_model=Project, status_code=201)
async def create_project(body: ProjectCreate, user: User = Depends(current_user)):
    content = ProjectContent(name=body.name or "Untitled project", description=body.description,
                             settings=user.prefs.cutting)
    if body.template_id:
        tpl = await load_project(body.template_id, user, "view")
        content = _fresh_ids(ProjectContent.model_validate(tpl.model_dump(include=set(ProjectContent.model_fields))))
        content.settings = user.prefs.cutting
        content.name = body.name if body.name and body.name != "Untitled project" else tpl.name
        content = await derive_all(get_db(), content)
    p = Project(**content.model_dump(), owner_id=user.id,
                members=[Member(user_id=user.id, role=Role.owner, email=user.email, name=user.name)])
    await get_db().projects.insert_one(p.to_mongo())
    return p


@router.get("/projects/{project_id}", response_model=Project)
async def get_project(project_id: str, user: User = Depends(current_user)):
    return await load_project(project_id, user, "view")


@router.put("/projects/{project_id}", response_model=Project)
async def save_project(project_id: str, body: ProjectUpdate, user: User = Depends(current_user)):
    p = await load_project(project_id, user, "edit")
    if p.status == ProjectStatus.done:
        raise HTTPException(status.HTTP_409_CONFLICT, "This project is done. Reopen it to make changes.")
    if body.version != p.version:
        raise HTTPException(status.HTTP_409_CONFLICT, "Someone else changed this project. Reload to see their changes.")
    content = await derive_all(get_db(), ProjectContent.model_validate(body.model_dump(exclude={"version"})))
    update = {**content.model_dump(mode="python"), "updated_at": now(), "version": p.version + 1}
    res = await get_db().projects.find_one_and_update(
        {"_id": p.id, "version": p.version}, {"$set": update}, return_document=True)
    if res is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Someone else changed this project. Reload to see their changes.")
    return Project.from_mongo(res)


@router.post("/projects/{project_id}/duplicate", response_model=Project, status_code=201)
async def duplicate_project(project_id: str, user: User = Depends(current_user)):
    src = await load_project(project_id, user, "view")
    content = _fresh_ids(ProjectContent.model_validate(src.model_dump(include=set(ProjectContent.model_fields))))
    content.name = f"{src.name} copy"[:120]
    content = await derive_all(get_db(), content)
    p = Project(**content.model_dump(), owner_id=user.id,
                members=[Member(user_id=user.id, role=Role.owner, email=user.email, name=user.name)])
    await get_db().projects.insert_one(p.to_mongo())
    return p


class ArchiveIn(Model):
    archived: bool


@router.post("/projects/{project_id}/archive", response_model=Project)
async def archive_project(project_id: str, body: ArchiveIn, user: User = Depends(current_user)):
    p = await load_project(project_id, user, "owner")
    res = await get_db().projects.find_one_and_update(
        {"_id": p.id}, {"$set": {"archived": body.archived, "updated_at": now()}}, return_document=True)
    return Project.from_mongo(res)


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(project_id: str, user: User = Depends(current_user)):
    p = await load_project(project_id, user, "owner")
    if not p.archived and not p.is_template:
        raise HTTPException(status.HTTP_409_CONFLICT, "Archive the project before deleting it.")
    await get_db().projects.delete_one({"_id": p.id})
    await get_db().ai_conversations.delete_many({"project_id": p.id})
    await get_db().translations.delete_many({"project_id": p.id})


# ------------------------------------------------------------------ plan & shopping


@router.get("/projects/{project_id}/plan", response_model=PlanOut)
async def get_plan(project_id: str, lang: Lang = "en", user: User = Depends(current_user)):
    p = await load_project(project_id, user, "view")
    plan, *_ = await plan_for(p, lang)
    return plan


async def _shopping(p: Project, lang: str) -> ShoppingOut:
    plan, items, suppliers, _ = await plan_for(p, lang)
    lumber = [it for it in items.values() if it.kind == "lumber"]
    alts = []
    if lumber:
        q = {"kind": "lumber", "status": "active",
             "$or": [{"thickness_mm": it.thickness_mm, "width_mm": it.width_mm} for it in lumber]}
        alts = [CatalogItem.from_mongo(d) async for d in get_db().catalog_items.find(q)]
    return build_shopping(plan, p, items, suppliers, alts, lang)


@router.get("/projects/{project_id}/shopping", response_model=ShoppingOut)
async def get_shopping(project_id: str, lang: Lang = "en", user: User = Depends(current_user)):
    p = await load_project(project_id, user, "view")
    return await _shopping(p, lang)


class CheckIn(Model):
    key: str
    checked: bool


@router.put("/projects/{project_id}/shopping/checked", status_code=204)
async def check_line(project_id: str, body: CheckIn, user: User = Depends(current_user)):
    p = await load_project(project_id, user, "edit")
    if p.status == ProjectStatus.done:
        raise HTTPException(status.HTTP_409_CONFLICT, "This project is done. Reopen it to make changes.")
    op = "$addToSet" if body.checked else "$pull"
    await get_db().projects.update_one({"_id": p.id}, {op: {"shopping_checked": body.key}})


class StatusIn(Model):
    status: ProjectStatus


TRANSITIONS = {
    (ProjectStatus.planning, ProjectStatus.bought),
    (ProjectStatus.bought, ProjectStatus.planning),
    (ProjectStatus.bought, ProjectStatus.bought),  # bought the extra boards needed after edits
    (ProjectStatus.bought, ProjectStatus.cut),
    (ProjectStatus.cut, ProjectStatus.done),
    (ProjectStatus.done, ProjectStatus.cut),
}


@router.post("/projects/{project_id}/status", response_model=Project)
async def set_status(project_id: str, body: StatusIn, user: User = Depends(current_user)):
    p = await load_project(project_id, user, "edit")
    if (p.status, body.status) not in TRANSITIONS:
        raise HTTPException(status.HTTP_409_CONFLICT, f"A {p.status} project can't move to {body.status}.")
    db = get_db()
    update: dict = {"status": body.status, "updated_at": now(), "version": p.version + 1}
    stock_changes: list = []  # inventory writes, done only once this request has claimed the change
    if body.status == ProjectStatus.bought:
        plan, items, _, _ = await plan_for(p)
        if plan.unplaced:
            raise HTTPException(status.HTTP_409_CONFLICT, "Some parts don't fit any stock yet. Fix them first.")
        update["purchase"] = purchase_from(plan, p, items).model_dump(mode="python")
        update["shopping_checked"] = []
    elif body.status == ProjectStatus.planning:
        update["purchase"] = None
    elif body.status == ProjectStatus.cut and p.status == ProjectStatus.bought:
        plan, items, _, inventory = await plan_for(p)
        update["cut_inventory"] = [e.model_dump(mode="python") for e in inventory]
        entries = []
        for lp in plan.lumber:
            for pat in lp.patterns:
                if pat.leftover_kept:
                    entries.append(InventoryEntry(owner_id=p.owner_id, item_id=lp.item_id, kind=StockKind.offcut,
                                                  length_mm=round(pat.leftover), qty=pat.count,
                                                  source_project_id=p.id, note=f"From {p.name}"))
        for sp in plan.sheets:
            for lay in sp.layouts:
                for r in lay.offcuts:
                    L, W = max(r.w, r.h), min(r.w, r.h)
                    entries.append(InventoryEntry(owner_id=p.owner_id, item_id=sp.item_id, kind=StockKind.offcut,
                                                  length_mm=round(L), width_mm=round(W), source_project_id=p.id,
                                                  note=f"From {p.name}"))
        # Stock taken from the workshop is now used up.
        used: dict[tuple, int] = {}
        for lp_or_sp in [*plan.lumber, *plan.sheets]:
            for b in lp_or_sp.buy:
                if b.source == "inventory":
                    used[(lp_or_sp.item_id, b.length_mm, b.width_mm)] = used.get(
                        (lp_or_sp.item_id, b.length_mm, b.width_mm), 0) + b.qty
        for (item_id, length, width), qty in used.items():
            for e in inventory:
                if qty <= 0:
                    break
                if e.item_id == item_id and abs(e.length_mm - length) < 0.5 and (e.width_mm or None) == (width or None):
                    take = min(qty, e.qty)
                    qty -= take
                    if take >= e.qty:
                        stock_changes.append(({"_id": e.id}, {"$set": {"status": StockStatus.used}}))
                    else:
                        stock_changes.append(({"_id": e.id}, {"$inc": {"qty": -take}}))
        if entries:
            stock_changes.append(("insert", [e.to_mongo() for e in entries]))
    # Claim the change first (same status and version as we read): a double click or a second
    # tab gets a 409 instead of using up stock twice.
    res = await db.projects.find_one_and_update({"_id": p.id, "status": p.status, "version": p.version},
                                                {"$set": update}, return_document=True)
    if res is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The project changed at the same moment. Reload and try again.")
    for target, change in stock_changes:
        if target == "insert":
            await db.inventory.insert_many(change)
        else:
            await db.inventory.update_one(target, change)
    return Project.from_mongo(res)


# ------------------------------------------------------------------ translation & exports


def _strings(p: Project) -> list[str]:
    out = {p.name}
    for a in p.assemblies:
        out.add(a.name)
        out |= {pt.name for pt in a.parts}
        out |= {h.name for h in a.hardware if not h.item_id}
    out |= {h.name for h in p.extras if not h.item_id}
    return sorted(s for s in out if s and s.strip())


@router.post("/projects/{project_id}/translations", response_model=dict[str, str])
async def ensure_translations(project_id: str, lang: Lang = "he", user: User = Depends(current_user)):
    p = await load_project(project_id, user, "view")
    if lang == "en":
        return {}
    db = get_db()
    doc = await db.translations.find_one({"project_id": p.id, "lang": lang})
    have: dict[str, str] = doc["strings"] if doc else {}
    missing = [s for s in _strings(p) if s not in have]
    if missing:
        try:
            check_ai_quota(user)
            have.update(await translate_strings(missing, lang))
        except AIServiceError as e:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from e
        await db.translations.update_one({"project_id": p.id, "lang": lang},
                                         {"$set": {"strings": have, "updated_at": now()}}, upsert=True)
    return {s: have.get(s, s) for s in _strings(p)}


EXPORT_HEAD = {
    "en": ["Label", "Part", "Assembly", "Material", "Qty", "Length (mm)", "Width (mm)", "Ends", "Board / sheet"],
    "he": ["תווית", "חלק", "מכלול", "חומר", "כמות", "אורך (מ״מ)", "רוחב (מ״מ)", "קצוות", "קרש / לוח"],
}


def ends_text(pt: Part, lang: str) -> str:
    """Saw settings for a frame bar's two ends: "45° / square", "11.4° miter + 5° bevel", "on its side"."""
    if not pt.cuts or all(not e.miter and not e.bevel for e in pt.cuts):
        return ""
    he = lang == "he"

    def one(e) -> str:
        if not e.miter and not e.bevel:
            return "ישר" if he else "square"
        s = f"{e.miter:g}°"
        if e.bevel:
            s += f" + {'שיפוע' if he else 'bevel'} {e.bevel:g}°"
        return s
    text = " / ".join(one(e) for e in pt.cuts)
    if pt.face_up == "side":
        text += " (על הצד)" if he else " (on its side)"
    return text + (" · אורך לפי הנקודה הארוכה" if he else " · long point")


def _csv(rows: list[list]) -> str:
    buf = io.StringIO()
    csv.writer(buf).writerows(rows)
    return "﻿" + buf.getvalue()  # BOM so Excel reads Hebrew correctly


@router.get("/projects/{project_id}/export/cutlist.csv")
async def export_cutlist(project_id: str, lang: Lang = "en", user: User = Depends(current_user)):
    p = await load_project(project_id, user, "view")
    plan, items, _, _ = await plan_for(p, lang)
    tr = {}
    if lang != "en":
        doc = await get_db().translations.find_one({"project_id": p.id, "lang": lang})
        tr = doc["strings"] if doc else {}
    labels = p.part_labels()
    where: dict[str, list[str]] = {}
    for lp in plan.lumber:
        for i, pat in enumerate(lp.patterns, start=1):
            for s in pat.segments:
                if s.kind == "part":
                    where.setdefault(s.part_id, []).append(f"{pat.stock_length / 1000:.1f} m #{i}")
    for sp in plan.sheets:
        for i, lay in enumerate(sp.layouts, start=1):
            for pt in lay.parts:
                where.setdefault(pt.part_id, []).append(f"sheet {i}")
    rows = [EXPORT_HEAD[lang]]
    for a in p.assemblies:
        for pt in a.parts:
            item = items.get(pt.item_id or "")
            rows.append([labels[pt.id], tr.get(pt.name, pt.name), f"{a.letter} {tr.get(a.name, a.name)} ×{a.qty}",
                         item.display_name(lang) if item else "", pt.qty * a.qty, f"{pt.length_mm:g}",
                         f"{pt.width_mm:g}" if pt.width_mm else "", ends_text(pt, lang),
                         ", ".join(sorted(set(where.get(pt.id, []))))])
    name = "".join(ch for ch in p.name if ch.isalnum() or ch in " -_").strip() or "project"
    return Response(_csv(rows), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name} cut list.csv"'})


@router.get("/projects/{project_id}/export/shopping.csv")
async def export_shopping(project_id: str, lang: Lang = "en", user: User = Depends(current_user)):
    p = await load_project(project_id, user, "view")
    sh = await _shopping(p, lang)
    head = ["Supplier", "Item", "Size", "Qty", "Unit price", "Total"] if lang == "en" else [
        "ספק", "פריט", "מידה", "כמות", "מחיר ליחידה", "סה״כ"]
    rows = [head]
    for g in sh.groups:
        for ln in g.lines:
            rows.append([g.supplier_name, ln.name, ln.detail, f"{ln.qty:g}",
                         "" if ln.unit_price is None else f"{ln.unit_price:.2f}",
                         "" if ln.total is None else f"{ln.total:.2f}"])
    rows.append(["", "", "", "", "Total" if lang == "en" else "סה״כ", f"{sh.total:.2f}"])
    name = "".join(ch for ch in p.name if ch.isalnum() or ch in " -_").strip() or "project"
    return Response(_csv(rows), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name} shopping list.csv"'})


# ------------------------------------------------------------------ sharing


class InviteIn(Model):
    role: Literal["editor", "viewer"] = "editor"


class InviteOut(Model):
    token: str
    role: str
    expires_at: datetime
    project_name: str = ""
    invited_by: str = ""


@router.post("/projects/{project_id}/invites", response_model=InviteOut)
async def create_invite(project_id: str, body: InviteIn, user: User = Depends(current_user)):
    p = await load_project(project_id, user, "owner")
    inv = {"token": secrets.token_urlsafe(18), "project_id": p.id, "role": body.role, "created_by": user.id,
           "invited_by": user.name or user.email, "expires_at": now() + timedelta(days=14), "created_at": now()}
    await get_db().invites.insert_one({**inv, "_id": new_id()})
    return InviteOut(**inv, project_name=p.name)


@router.get("/invites/{token}", response_model=InviteOut)
async def get_invite(token: str, user: User = Depends(current_user)):
    inv = await get_db().invites.find_one({"token": token})
    if inv is None or inv["expires_at"] < now():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This invite link has expired. Ask for a new one.")
    p = await get_db().projects.find_one({"_id": inv["project_id"]}, {"name": 1})
    return InviteOut(token=token, role=inv["role"], expires_at=inv["expires_at"],
                     project_name=p["name"] if p else "", invited_by=inv.get("invited_by", ""))


@router.post("/invites/{token}/accept", response_model=Project)
async def accept_invite(token: str, user: User = Depends(current_user)):
    db = get_db()
    inv = await db.invites.find_one({"token": token})
    if inv is None or inv["expires_at"] < now():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This invite link has expired. Ask for a new one.")
    doc = await db.projects.find_one({"_id": inv["project_id"]})
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The project no longer exists.")
    p = Project.from_mongo(doc)
    role = p.role_of(user.id)
    if role is None:
        m = Member(user_id=user.id, role=Role(inv["role"]), email=user.email, name=user.name)
        doc = await db.projects.find_one_and_update({"_id": p.id, "members.user_id": {"$ne": user.id}},
                                                    {"$push": {"members": m.model_dump()}}, return_document=True) or doc
    elif role == Role.viewer and inv["role"] == Role.editor:
        # A viewer who opens an editor link is upgraded (never the other way round).
        doc = await db.projects.find_one_and_update({"_id": p.id, "members.user_id": user.id},
                                                    {"$set": {"members.$.role": Role.editor}}, return_document=True)
    return Project.from_mongo(doc)


@router.delete("/projects/{project_id}/members/{member_id}", response_model=Project)
async def remove_member(project_id: str, member_id: str, user: User = Depends(current_user)):
    p = await load_project(project_id, user, "view")
    if member_id != user.id and p.role_of(user.id) != Role.owner:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner can remove people.")
    if p.role_of(member_id) == Role.owner:
        raise HTTPException(status.HTTP_409_CONFLICT, "The owner can't be removed.")
    doc = await get_db().projects.find_one_and_update(
        {"_id": p.id}, {"$pull": {"members": {"user_id": member_id}}}, return_document=True)
    return Project.from_mongo(doc)


# ------------------------------------------------------------------ templates


class TemplateIn(Model):
    title: str
    summary: str = ""
    category: str = ""
    public: bool = False


class TemplateSummary(Model):
    id: str
    title: str
    summary: str
    category: str
    public: bool
    mine: bool
    assemblies: list[str]
    parts: int


@router.get("/templates", response_model=list[TemplateSummary])
async def list_templates(user: User = Depends(current_user)):
    q = {"is_template": True, "$or": [{"template.public": True}, {"members.user_id": user.id}]}
    out = []
    async for d in get_db().projects.find(q).sort("template.title", 1):
        p = Project.from_mongo(d)
        out.append(TemplateSummary(
            id=p.id, title=p.template.title, summary=p.template.summary, category=p.template.category,
            public=p.template.public, mine=p.owner_id == user.id,
            assemblies=[f"{a.name} ×{a.qty}" if a.qty > 1 else a.name for a in p.assemblies],
            parts=sum(pt.qty * a.qty for a in p.assemblies for pt in a.parts)))
    return out


@router.post("/projects/{project_id}/template", response_model=TemplateSummary, status_code=201)
async def save_as_template(project_id: str, body: TemplateIn, user: User = Depends(current_user)):
    src = await load_project(project_id, user, "view")
    if body.public and not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can publish templates for everyone.")
    content = _fresh_ids(ProjectContent.model_validate(src.model_dump(include=set(ProjectContent.model_fields))))
    content.name = body.title
    content = await derive_all(get_db(), content)
    t = Project(**content.model_dump(), owner_id=user.id, is_template=True,
                template=TemplateMeta(title=body.title, summary=body.summary, category=body.category,
                                      public=body.public),
                members=[Member(user_id=user.id, role=Role.owner, email=user.email, name=user.name)])
    await get_db().projects.insert_one(t.to_mongo())
    return TemplateSummary(id=t.id, title=body.title, summary=body.summary, category=body.category,
                           public=body.public, mine=True, assemblies=[a.name for a in t.assemblies],
                           parts=sum(pt.qty * a.qty for a in t.assemblies for pt in a.parts))


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(template_id: str, user: User = Depends(current_user)):
    t = await load_project(template_id, user, "owner")
    if not t.is_template:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template not found.")
    await get_db().projects.delete_one({"_id": t.id})
