from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import admin_user
from app.db import get_db
from app.models.common import Model
from app.models.project import Project, ProjectSummary, Role
from app.models.user import User, UserRole

router = APIRouter(prefix="/api/admin", tags=["admin"])


class UsageDay(Model):
    day: str
    model: str
    calls: int
    ok: int


class Stats(Model):
    users: int
    active_users_7d: int
    projects: int
    templates: int
    catalog_items: int
    suggested_items: int
    ai_calls_today: int
    ai_usage: list[UsageDay]


@router.get("/stats", response_model=Stats)
async def stats(user: User = Depends(admin_user)):
    db = get_db()
    week = datetime.now(UTC) - timedelta(days=7)
    days = [(datetime.now(UTC) - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(14)]
    usage = [UsageDay(day=d["day"], model=d["model"], calls=d.get("calls", 0), ok=d.get("ok", 0))
             async for d in db.ai_usage.find({"day": {"$in": days}}).sort("day", -1)]
    return Stats(
        users=await db.users.count_documents({}),
        active_users_7d=await db.users.count_documents({"last_seen": {"$gte": week}}),
        projects=await db.projects.count_documents({"is_template": False}),
        templates=await db.projects.count_documents({"is_template": True}),
        catalog_items=await db.catalog_items.count_documents({"status": "active"}),
        suggested_items=await db.catalog_items.count_documents({"status": "suggested"}),
        ai_calls_today=sum(u.calls for u in usage if u.day == days[0]),
        ai_usage=usage,
    )


@router.get("/users", response_model=list[User])
async def users(user: User = Depends(admin_user)):
    return [User.from_mongo(d) async for d in get_db().users.find({}).sort("last_seen", -1)]


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


@router.get("/archived", response_model=list[ProjectSummary])
async def archived(user: User = Depends(admin_user)):
    out = []
    async for d in get_db().projects.find({"archived": True}).sort("updated_at", -1):
        p = Project.from_mongo(d)
        owner = next((m for m in p.members if m.role == Role.owner), None)
        out.append(ProjectSummary(id=p.id, name=p.name, description=p.description, status=p.status, archived=True,
                                  role=Role.viewer, updated_at=p.updated_at, assemblies=len(p.assemblies),
                                  parts=sum(pt.qty * a.qty for a in p.assemblies for pt in a.parts),
                                  total_cost=p.last_total, owner_name=(owner.name or owner.email) if owner else ""))
    return out


@router.post("/projects/{project_id}/restore", status_code=204)
async def restore(project_id: str, user: User = Depends(admin_user)):
    await get_db().projects.update_one({"_id": project_id}, {"$set": {"archived": False}})
