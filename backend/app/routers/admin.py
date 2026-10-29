"""Admin panel: how much people use Woodchunk, never what they build.

Everything here is counts and dates. No endpoint returns project names, descriptions, parts, sketches or chats;
queries on projects read only `created_at`, `members` and counts.
"""

from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth import admin_user
from app.db import get_db
from app.models.common import Model
from app.models.project import Role
from app.models.user import User, UserRole
from app.services.activity import WINDOW_S, day_key

router = APIRouter(prefix="/api/admin", tags=["admin"])

Level = Literal["high", "regular", "light", "inactive"]
Range = Query(30, ge=7, le=365, description="How many days back the series go")


class Day(Model):
    day: str
    signups: int
    active_users: int
    projects_created: int
    ai_calls: int
    ai_ok: int


class ModelUsage(Model):
    model: str
    calls: int
    ok: int


class ModelDay(Model):
    day: str
    model: str
    calls: int
    ok: int


class Overview(Model):
    users: int
    admins: int
    active_1d: int
    active_7d: int
    active_30d: int
    new_7d: int
    new_30d: int
    projects: int
    templates: int
    catalog_items: int
    suggested_items: int
    ai_calls_today: int
    # First day with per-user activity; days before it show no active users or per-person AI calls.
    tracking_since: str | None
    days: list[Day]
    ai_models: list[ModelUsage]
    ai_by_day: list[ModelDay]


class PersonUsage(Model):
    id: str
    name: str
    email: str
    role: UserRole
    created_at: datetime
    last_seen: datetime
    projects: int  # owned, not counting templates
    shared: int  # someone else's, shared with them
    ai_calls_7d: int
    ai_calls_30d: int
    active_days_7d: int
    active_days_30d: int
    active_minutes_30d: int
    level: Level


class PersonDay(Model):
    day: str
    active_minutes: int
    ai_calls: int
    ai_ok: int
    projects_created: int


class FeatureUse(Model):
    feature: str
    calls: int


class ArchivedProject(Model):
    """An archived project as admins see it: enough to restore the right one, nothing about what it is."""
    id: str
    created_at: datetime
    updated_at: datetime
    assemblies: int
    parts: int


class PersonDetail(Model):
    person: PersonUsage
    days: list[PersonDay]
    ai_features: list[FeatureUse]
    archived: list[ArchivedProject]


def _days(n: int) -> list[str]:
    today = datetime.now(UTC)
    return [day_key(today - timedelta(days=i)) for i in range(n - 1, -1, -1)]


def _start(days: list[str]) -> datetime:
    return datetime.strptime(days[0], "%Y-%m-%d").replace(tzinfo=UTC)


_BY_DAY = {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}}


async def _count_by_day(collection, match: dict) -> dict[str, int]:
    pipeline = [{"$match": match}, {"$group": {"_id": _BY_DAY, "n": {"$sum": 1}}}]
    return {d["_id"]: d["n"] async for d in await collection.aggregate(pipeline)}


def _level(active_days_30d: int, last_seen: datetime) -> Level:
    if active_days_30d >= 8:
        return "high"
    if active_days_30d >= 3:
        return "regular"
    if active_days_30d >= 1 or datetime.now(UTC) - last_seen < timedelta(days=30):
        return "light"
    return "inactive"


async def _people(match: dict) -> list[PersonUsage]:
    db = get_db()
    users = [d async for d in db.users.find(match, {"email": 1, "name": 1, "role": 1, "created_at": 1, "last_seen": 1})]
    ids = [u["_id"] for u in users]
    d30, d7 = _days(30)[0], _days(7)[0]
    usage: dict[str, dict] = {}
    async for d in await db.user_activity.aggregate([
        {"$match": {"user_id": {"$in": ids}, "day": {"$gte": d30}}},
        {"$group": {
            "_id": "$user_id",
            "ai_30": {"$sum": "$ai_calls"},
            "ai_7": {"$sum": {"$cond": [{"$gte": ["$day", d7]}, "$ai_calls", 0]}},
            "days_30": {"$sum": 1},
            "days_7": {"$sum": {"$cond": [{"$gte": ["$day", d7]}, 1, 0]}},
            "windows_30": {"$sum": "$windows"},
        }},
    ]):
        usage[d["_id"]] = d
    counts: dict[str, dict] = {}
    async for d in await db.projects.aggregate([
        {"$match": {"is_template": False, "members.user_id": {"$in": ids}}},
        {"$project": {"members.user_id": 1, "members.role": 1}},
        {"$unwind": "$members"},
        {"$group": {
            "_id": "$members.user_id",
            "owned": {"$sum": {"$cond": [{"$eq": ["$members.role", Role.owner.value]}, 1, 0]}},
            "shared": {"$sum": {"$cond": [{"$eq": ["$members.role", Role.owner.value]}, 0, 1]}},
        }},
    ]):
        counts[d["_id"]] = d
    out = []
    for u in users:
        a, c = usage.get(u["_id"], {}), counts.get(u["_id"], {})
        out.append(PersonUsage(
            id=u["_id"], name=u.get("name", ""), email=u["email"], role=u.get("role", UserRole.user),
            created_at=u["created_at"], last_seen=u["last_seen"], projects=c.get("owned", 0), shared=c.get("shared", 0),
            ai_calls_7d=a.get("ai_7", 0), ai_calls_30d=a.get("ai_30", 0), active_days_7d=a.get("days_7", 0),
            active_days_30d=a.get("days_30", 0), active_minutes_30d=a.get("windows_30", 0) * WINDOW_S // 60,
            level=_level(a.get("days_30", 0), u["last_seen"]),
        ))
    return out


@router.get("/overview", response_model=Overview)
async def overview(days: int = Range, user: User = Depends(admin_user)):
    db = get_db()
    now = datetime.now(UTC)
    keys = _days(days)
    start = _start(keys)
    signups = await _count_by_day(db.users, {"created_at": {"$gte": start}})
    created = await _count_by_day(db.projects, {"is_template": False, "created_at": {"$gte": start}})
    active = {d["_id"]: d["n"] async for d in await db.user_activity.aggregate([
        {"$match": {"day": {"$gte": keys[0]}}}, {"$group": {"_id": "$day", "n": {"$sum": 1}}}])}
    by_day = [ModelDay(day=d["day"], model=d["model"], calls=d.get("calls", 0), ok=d.get("ok", 0))
              async for d in db.ai_usage.find({"day": {"$gte": keys[0]}}, {"by": 0}).sort("day", 1)]
    models: dict[str, ModelUsage] = {}
    for u in by_day:
        m = models.setdefault(u.model, ModelUsage(model=u.model, calls=0, ok=0))
        m.calls += u.calls
        m.ok += u.ok
    first = await db.user_activity.find_one({}, {"day": 1}, sort=[("day", 1)])
    return Overview(
        users=await db.users.count_documents({}),
        admins=await db.users.count_documents({"role": UserRole.admin}),
        active_1d=await db.users.count_documents({"last_seen": {"$gte": now - timedelta(days=1)}}),
        active_7d=await db.users.count_documents({"last_seen": {"$gte": now - timedelta(days=7)}}),
        active_30d=await db.users.count_documents({"last_seen": {"$gte": now - timedelta(days=30)}}),
        new_7d=await db.users.count_documents({"created_at": {"$gte": now - timedelta(days=7)}}),
        new_30d=await db.users.count_documents({"created_at": {"$gte": now - timedelta(days=30)}}),
        projects=await db.projects.count_documents({"is_template": False}),
        templates=await db.projects.count_documents({"is_template": True}),
        catalog_items=await db.catalog_items.count_documents({"status": "active"}),
        suggested_items=await db.catalog_items.count_documents({"status": "suggested"}),
        ai_calls_today=sum(u.calls for u in by_day if u.day == keys[-1]),
        tracking_since=first["day"] if first else None,
        days=[Day(day=k, signups=signups.get(k, 0), active_users=active.get(k, 0), projects_created=created.get(k, 0),
                  ai_calls=sum(u.calls for u in by_day if u.day == k), ai_ok=sum(u.ok for u in by_day if u.day == k))
              for k in keys],
        ai_models=sorted(models.values(), key=lambda m: -m.calls),
        ai_by_day=by_day,
    )


@router.get("/users", response_model=list[PersonUsage])
async def users(user: User = Depends(admin_user)):
    people = await _people({})
    return sorted(people, key=lambda p: p.last_seen, reverse=True)


@router.get("/users/{user_id}", response_model=PersonDetail)
async def person(user_id: str, days: int = Range, user: User = Depends(admin_user)):
    found = await _people({"_id": user_id})
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    db = get_db()
    keys = _days(days)
    activity = {d["day"]: d async for d in db.user_activity.find({"user_id": user_id, "day": {"$gte": keys[0]}})}
    created = await _count_by_day(db.projects, {"owner_id": user_id, "is_template": False,
                                                "created_at": {"$gte": _start(keys)}})
    features: dict[str, int] = {}
    for a in activity.values():
        for k, n in (a.get("ai_features") or {}).items():
            features[k] = features.get(k, 0) + n
    archived = []
    cursor = db.projects.find({"owner_id": user_id, "archived": True, "is_template": False},
                              {"created_at": 1, "updated_at": 1, "assemblies.qty": 1, "assemblies.parts.qty": 1})
    async for d in cursor.sort("updated_at", -1):
        asms = d.get("assemblies", [])
        archived.append(ArchivedProject(
            id=d["_id"], created_at=d["created_at"], updated_at=d["updated_at"], assemblies=len(asms),
            parts=round(sum(p.get("qty", 0) * a.get("qty", 0) for a in asms for p in a.get("parts", [])))))
    return PersonDetail(
        person=found[0],
        days=[PersonDay(day=k, active_minutes=activity.get(k, {}).get("windows", 0) * WINDOW_S // 60,
                        ai_calls=activity.get(k, {}).get("ai_calls", 0), ai_ok=activity.get(k, {}).get("ai_ok", 0),
                        projects_created=created.get(k, 0)) for k in keys],
        ai_features=[FeatureUse(feature=k.replace("_", "."), calls=n)
                     for k, n in sorted(features.items(), key=lambda kv: -kv[1])],
        archived=archived,
    )


class RoleIn(Model):
    role: UserRole


@router.put("/users/{user_id}/role", response_model=User)
async def set_role(user_id: str, body: RoleIn, user: User = Depends(admin_user)):
    if user_id == user.id and body.role != UserRole.admin:
        raise HTTPException(status.HTTP_409_CONFLICT, "You can't remove your own admin role.")
    d = await get_db().users.find_one_and_update({"_id": user_id}, {"$set": {"role": body.role}}, return_document=True)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    return User.from_mongo(d)


@router.post("/projects/{project_id}/restore", status_code=204)
async def restore(project_id: str, user: User = Depends(admin_user)):
    r = await get_db().projects.update_one({"_id": project_id, "archived": True}, {"$set": {"archived": False}})
    if r.matched_count == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No archived project with that id.")
