from __future__ import annotations

import mimetypes
import re
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.auth import admin_user, current_user
from app.db import get_db
from app.models.catalog import CatalogItem, CatalogItemBase, ItemStatus, PricePoint, Supplier
from app.models.common import Localized, Model, new_id, now
from app.models.project import Project, ProjectContent, ProjectStatus
from app.models.user import User
from app.routers.deps import edited_by, load_project, plan_for
from app.services.ai import project_chat
from app.services.ai.catalog_ai import CatalogImport, ImportProposalItem, extract, match_items, organize, to_catalog
from app.services.ai.client import AIServiceError, get_ai
from app.services.frame.parts import derive_all
from app.services.proposals import Proposal, apply_ops
from app.services.ratelimit import check_ai_quota
from app.services.scraping import FetchError, fetch_page_text, table_file_to_text

router = APIRouter(prefix="/api/ai", tags=["ai"])


class AIStatus(Model):
    enabled: bool
    calls_today: int


@router.get("/status", response_model=AIStatus)
async def ai_status(user: User = Depends(current_user)):
    day = datetime.now(UTC).strftime("%Y-%m-%d")
    calls = sum([d.get("calls", 0) async for d in get_db().ai_usage.find({"day": day})])
    return AIStatus(enabled=get_ai().enabled, calls_today=calls)


def _ai_error(e: AIServiceError) -> HTTPException:
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))


# ------------------------------------------------------------------ project chat


class ChatMessage(Model):
    role: str  # user | assistant
    text: str
    at: datetime
    proposal_id: str | None = None


class Conversation(Model):
    messages: list[ChatMessage]
    proposals: list[Proposal]


async def _catalog() -> list[CatalogItem]:
    return [CatalogItem.from_mongo(d) async for d in get_db().catalog_items.find({"status": "active"})]


async def _conversation(project_id: str, user: User) -> Conversation:
    db = get_db()
    doc = await db.ai_conversations.find_one({"project_id": project_id, "user_id": user.id})
    msgs = [ChatMessage(**m) for m in (doc or {}).get("messages", [])]
    ids = [m.proposal_id for m in msgs if m.proposal_id]
    props = [Proposal.from_mongo(d) async for d in db.proposals.find({"_id": {"$in": ids}})]
    return Conversation(messages=msgs, proposals=props)


@router.get("/projects/{project_id}/conversation", response_model=Conversation)
async def get_conversation(project_id: str, user: User = Depends(current_user)):
    await load_project(project_id, user, "view")
    return await _conversation(project_id, user)


@router.delete("/projects/{project_id}/conversation", status_code=204)
async def clear_conversation(project_id: str, user: User = Depends(current_user)):
    await get_db().ai_conversations.delete_one({"project_id": project_id, "user_id": user.id})


async def _make_proposal(p: Project, user: User, answer: project_chat.ChatAnswer, source: str) -> Proposal | None:
    if not answer.ops:
        return None
    items = {i.id: i for i in await _catalog()}
    content = ProjectContent.model_validate(p.model_dump(include=set(ProjectContent.model_fields)))
    new_content, diff = apply_ops(content, answer.ops, items)
    if not diff:
        return None
    before, *_ = await plan_for(p)
    after_project = Project(**{**p.model_dump(), **new_content.model_dump()})
    after, *_ = await plan_for(after_project, save_total=False)
    prop = Proposal(project_id=p.id, user_id=user.id, source=source, base_version=p.version, summary=answer.summary,
                    ops=answer.ops, diff=diff, cost_before=before.totals.cost, cost_after=after.totals.cost)
    await get_db().proposals.insert_one(prop.to_mongo())
    return prop


class ChatIn(Model):
    message: str


@router.post("/projects/{project_id}/chat", response_model=Conversation)
async def chat(project_id: str, body: ChatIn, user: User = Depends(current_user)):
    p = await load_project(project_id, user, "edit")
    if p.status == ProjectStatus.done:
        raise HTTPException(status.HTTP_409_CONFLICT, "This project is done. Reopen it to make changes.")
    text = body.message.strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Write a message first.")
    check_ai_quota(user)
    convo = await _conversation(project_id, user)
    history = [{"role": m.role, "text": m.text} for m in convo.messages]
    try:
        answer = await project_chat.chat(p, history, text[:4000], await _catalog())
    except AIServiceError as e:
        raise _ai_error(e) from e
    prop = await _make_proposal(p, user, answer, "chat")
    new_msgs = [ChatMessage(role="user", text=text, at=now()),
                ChatMessage(role="assistant", text=answer.reply, at=now(), proposal_id=prop.id if prop else None)]
    await get_db().ai_conversations.update_one(
        {"project_id": project_id, "user_id": user.id},
        {"$push": {"messages": {"$each": [m.model_dump() for m in new_msgs], "$slice": -60}},
         "$setOnInsert": {"_id": new_id()}, "$set": {"updated_at": now()}},
        upsert=True)
    return await _conversation(project_id, user)


@router.post("/projects/{project_id}/import", response_model=Conversation)
async def import_cutlist(
    project_id: str, file: UploadFile | None = File(None), text: str = Form(""), user: User = Depends(current_user)
):
    p = await load_project(project_id, user, "edit")
    check_ai_quota(user)
    if file is not None:
        data = await file.read(5_000_001)  # read no more than the limit (+1 to detect a bigger file)
        if len(data) > 5_000_000:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Files up to 5 MB, please.")
        try:
            rows = table_file_to_text(data, file.filename or "upload.csv")
        except Exception as e:  # noqa: BLE001 - bad spreadsheets raise many types
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Couldn't read that file. Use CSV or XLSX.") from e
        name = file.filename or "spreadsheet"
    else:
        rows, name = text.strip(), "pasted cut list"
    if not rows:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The file is empty.")
    try:
        answer = await project_chat.import_rows(p, rows, await _catalog(), name)
    except AIServiceError as e:
        raise _ai_error(e) from e
    prop = await _make_proposal(p, user, answer, "spreadsheet")
    msgs = [ChatMessage(role="user", text=f"Import cut list from {name}", at=now()),
            ChatMessage(role="assistant", text=answer.reply, at=now(), proposal_id=prop.id if prop else None)]
    await get_db().ai_conversations.update_one(
        {"project_id": project_id, "user_id": user.id},
        {"$push": {"messages": {"$each": [m.model_dump() for m in msgs], "$slice": -60}},
         "$setOnInsert": {"_id": new_id()}, "$set": {"updated_at": now()}}, upsert=True)
    return await _conversation(project_id, user)


@router.post("/proposals/{proposal_id}/apply", response_model=Project)
async def apply_proposal(proposal_id: str, user: User = Depends(current_user)):
    db = get_db()
    prop = Proposal.from_mongo(await db.proposals.find_one({"_id": proposal_id}))
    if prop is None or prop.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "This suggestion was already applied or discarded.")
    p = await load_project(prop.project_id, user, "edit")
    if p.status == ProjectStatus.done:
        raise HTTPException(status.HTTP_409_CONFLICT, "This project is done. Reopen it to make changes.")
    if p.version != prop.base_version:
        await db.proposals.update_one({"_id": prop.id}, {"$set": {"status": "stale"}})
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "The project changed after this suggestion. Ask again to get an updated one.")
    items = {i.id: i for i in await _catalog()}
    content = ProjectContent.model_validate(p.model_dump(include=set(ProjectContent.model_fields)))
    new_content, _ = apply_ops(content, prop.ops, items)
    new_content = await derive_all(db, new_content)
    res = await db.projects.find_one_and_update(
        {"_id": p.id, "version": p.version},
        {"$set": {**new_content.model_dump(mode="python"), "version": p.version + 1, "updated_at": now(), **edited_by(user)}},
        return_document=True)
    if res is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The project changed at the same moment. Try again.")
    await db.proposals.update_one({"_id": prop.id}, {"$set": {"status": "applied"}})
    return Project.from_mongo(res)


@router.post("/proposals/{proposal_id}/discard", status_code=204)
async def discard_proposal(proposal_id: str, user: User = Depends(current_user)):
    prop = Proposal.from_mongo(await get_db().proposals.find_one({"_id": proposal_id}))
    if prop is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Suggestion not found.")
    await load_project(prop.project_id, user, "edit")
    await get_db().proposals.update_one({"_id": prop.id, "status": "pending"}, {"$set": {"status": "discarded"}})


# ------------------------------------------------------------------ catalog import & organize


async def _supplier_for(supplier_id: str | None, name: str | None, currency: str | None, user: User) -> Supplier | None:
    db = get_db()
    if supplier_id:
        d = await db.suppliers.find_one({"_id": supplier_id})
        if d:
            return Supplier.from_mongo(d)
    if name:
        d = await db.suppliers.find_one({"name": {"$regex": f"^{re.escape(name.strip())}$", "$options": "i"}})
        if d:
            return Supplier.from_mongo(d)
        if not user.is_admin:
            return None  # only admins add suppliers; a member's import names it in the items instead
        s = Supplier(name=name.strip(), currency=(currency or "ILS").upper()[:3])
        await db.suppliers.insert_one(s.to_mongo())
        return s
    return None


@router.post("/catalog/import", response_model=CatalogImport)
async def catalog_import(
    url: str = Form(""), text: str = Form(""), supplier_id: str = Form(""), file: UploadFile | None = File(None),
    user: User = Depends(current_user),
):
    page_text, file_bytes, mime, source = None, None, None, ""
    try:
        if url.strip():
            title, page_text = await fetch_page_text(url.strip())
            source = url.strip()
            page_text = f"PAGE TITLE: {title}\nURL: {source}\n\n{page_text}"
        elif file is not None:
            data = await file.read(15_000_001)
            if len(data) > 15_000_000:
                raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Files up to 15 MB, please.")
            source = file.filename or "upload"
            mime = file.content_type or mimetypes.guess_type(source)[0] or ""
            if source.lower().endswith((".csv", ".xlsx", ".xlsm", ".txt")):
                page_text = table_file_to_text(data, source)
                mime = None
            elif mime in ("application/pdf",) or mime.startswith("image/"):
                file_bytes = data
            else:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Upload a PDF, image, CSV or XLSX price list.")
        elif text.strip():
            page_text, source = text.strip()[:60000], "pasted text"
        else:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Add a web address, a file or some text.")
        check_ai_quota(user)
        extraction = await extract(page_text, file_bytes, mime, hint=source)
    except FetchError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    except AIServiceError as e:
        raise _ai_error(e) from e

    supplier = await _supplier_for(supplier_id or None, extraction.supplier_name, extraction.currency, user)
    drafts = [c for c in (to_catalog(e, supplier.id if supplier else None) for e in extraction.items) if c]
    existing = [CatalogItem.from_mongo(d) async for d in get_db().catalog_items.find({"status": {"$ne": "retired"}})]
    imp = CatalogImport(created_by=user.id, source=source, supplier_id=supplier.id if supplier else None,
                        supplier_name=supplier.name if supplier else "", items=match_items(drafts, existing),
                        note="" if drafts else "No products found on that source.")
    await get_db().catalog_imports.insert_one(imp.to_mongo())
    return imp


@router.get("/catalog/imports", response_model=list[CatalogImport])
async def list_imports(user: User = Depends(current_user)):
    q = {} if user.is_admin else {"created_by": user.id}
    return [CatalogImport.from_mongo(d) async for d in get_db().catalog_imports.find(q).sort("created_at", -1).limit(30)]


@router.get("/catalog/imports/{import_id}", response_model=CatalogImport)
async def get_import(import_id: str, user: User = Depends(current_user)):
    d = await get_db().catalog_imports.find_one({"_id": import_id})
    if d is None or (not user.is_admin and d["created_by"] != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import not found.")
    return CatalogImport.from_mongo(d)


class ApplyImportIn(Model):
    selected: list[int]


class ApplyImportOut(Model):
    created: int
    updated: int
    suggested: bool


@router.post("/catalog/imports/{import_id}/apply", response_model=ApplyImportOut)
async def apply_import(import_id: str, body: ApplyImportIn, user: User = Depends(current_user)):
    db = get_db()
    imp = await get_import(import_id, user)
    # Claim it first, so a double click can't add the same items twice.
    claimed = await db.catalog_imports.find_one_and_update({"_id": imp.id, "status": "review"},
                                                           {"$set": {"status": "applying"}})
    if claimed is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This import was already applied or discarded.")
    created = updated = 0
    for idx in body.selected:
        if not 0 <= idx < len(imp.items):
            continue
        prop: ImportProposalItem = imp.items[idx]
        if prop.action == "new" or (prop.match_id and not user.is_admin):
            item = CatalogItem(**prop.item.model_dump(), created_by=user.id, source_url=imp.source,
                               status=ItemStatus.active if user.is_admin else ItemStatus.suggested,
                               price_updated_at=now())
            item.refresh_search()
            await db.catalog_items.insert_one(item.to_mongo())
            created += 1
        elif prop.match_id:
            d = await db.catalog_items.find_one({"_id": prop.match_id})
            if not d:
                continue
            old = CatalogItem.from_mongo(d)
            merged = _merge(old, prop.item, imp.kind)
            await db.catalog_items.replace_one({"_id": old.id}, merged.to_mongo())
            updated += 1
    await db.catalog_imports.update_one({"_id": imp.id}, {"$set": {"status": "applied"}})
    return ApplyImportOut(created=created, updated=updated, suggested=not user.is_admin)


def _merge(old: CatalogItem, new: CatalogItemBase, kind: str) -> CatalogItem:
    data = old.model_dump()
    if kind == "organize":
        for f in ("name", "category", "material", "treatment", "tags"):
            data[f] = getattr(new, f)
    else:
        data["name"] = Localized(en=old.name.en or new.name.en, he=old.name.he or new.name.he)
        for f in ("price_per_m", "price", "sku", "url"):
            if getattr(new, f):
                data[f] = getattr(new, f)
        if new.lumber_stock:
            data["lumber_stock"] = new.lumber_stock
        if new.sheet_stock:
            data["sheet_stock"] = new.sheet_stock
    item = CatalogItem(**data)
    if kind != "organize":
        item.price_updated_at = now()
        hp = item.price_per_m if item.kind == "lumber" else (
            next((s.price for s in item.sheet_stock if s.price), None) if item.kind == "sheet" else item.price)
        if hp is not None:
            item.price_history = [*old.price_history, PricePoint(price=hp, note="import")][-50:]
    item.updated_at = now()
    item.refresh_search()
    return item


@router.delete("/catalog/imports/{import_id}", status_code=204)
async def discard_import(import_id: str, user: User = Depends(current_user)):
    imp = await get_import(import_id, user)
    await get_db().catalog_imports.update_one({"_id": imp.id}, {"$set": {"status": "discarded"}})


class OrganizeIn(Model):
    item_ids: list[str] = []


@router.post("/catalog/organize", response_model=CatalogImport)
async def catalog_organize(body: OrganizeIn, user: User = Depends(admin_user)):
    q = {"_id": {"$in": body.item_ids}} if body.item_ids else {"status": {"$ne": "retired"}}
    items = [CatalogItem.from_mongo(d) async for d in get_db().catalog_items.find(q).limit(80)]
    if not items:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No items to organize.")
    try:
        result = await organize(items)
    except AIServiceError as e:
        raise _ai_error(e) from e
    by_id = {i.id: i for i in items}
    proposals = []
    for o in result.items:
        old = by_id.get(o.id)
        if not old:
            continue
        new = CatalogItemBase(**{**old.model_dump(), "name": Localized(en=o.name_en.strip(), he=o.name_he.strip()),
                                 "category": o.category, "material": o.material.lower(),
                                 "treatment": o.treatment.lower(), "tags": o.tags})
        changes = []
        if new.name.en != old.name.en:
            changes.append(f"name: {old.name.en} → {new.name.en}")
        if new.name.he != old.name.he:
            changes.append(f"Hebrew: {old.name.he or '—'} → {new.name.he}")
        if new.category != old.category:
            changes.append(f"category: {old.category or '—'} → {new.category}")
        if (new.material, new.treatment) != (old.material, old.treatment):
            changes.append(f"material: {old.material}/{old.treatment} → {new.material}/{new.treatment}")
        if new.tags != old.tags:
            changes.append(f"tags: {', '.join(new.tags)}")
        if changes:
            proposals.append(ImportProposalItem(action="update", match_id=old.id, item=new, changes=changes))
    imp = CatalogImport(created_by=user.id, kind="organize", source=f"{len(items)} catalog items", items=proposals,
                        note="" if proposals else "Everything already looks tidy.")
    await get_db().catalog_imports.insert_one(imp.to_mongo())
    return imp
