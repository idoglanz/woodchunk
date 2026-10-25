"""Generate a drawn assembly's parts from its frame, on the server, whenever a project is saved.

The editor shows the same numbers live from its TypeScript copy of the kernel; this run is what
plans, shopping lists and exports use.
"""

from pymongo.asynchronous.database import AsyncDatabase

from app.models.catalog import CatalogItem
from app.models.project import Assembly, EndCutSpec, Part, ProjectContent
from app.services.frame.kernel import Profile, solve, stable_id


async def frame_profiles(db: AsyncDatabase, content: ProjectContent) -> tuple[dict[str, Profile], dict[str, CatalogItem]]:
    ids = {m.item_id for a in content.assemblies if a.frame for m in a.frame.members if m.item_id}
    items = {d["_id"]: CatalogItem.from_mongo(d) async for d in db.catalog_items.find({"_id": {"$in": list(ids)}})}
    profiles = {}
    for item_id, it in items.items():
        sec = it.section()
        if sec:
            profiles[item_id] = Profile(sec.shape, sec.w, sec.h, sec.t)
    return profiles, items


def derive_parts(a: Assembly, profiles: dict[str, Profile], items: dict[str, CatalogItem]) -> None:
    """Replace a drawn assembly's parts with the frame's cut list."""
    if a.frame is None:
        return
    res = solve(a.frame, profiles)
    names = {m.id: m.name for m in a.frame.members}
    parts = []
    for g in res.groups:
        if not g.item_id or g.item_id not in profiles:
            continue  # members without a material are reported in frame_warnings
        name = next((names[m] for m in g.members if names.get(m)), "")
        if not name:
            it = items.get(g.item_id)
            name = it.name.en if it else "Member"
        parts.append(Part(
            id="f" + stable_id(f"{a.id}|{g.key}"),
            name=name, item_id=g.item_id, qty=g.qty, length_mm=max(0.0, g.lp), short_mm=max(0.0, g.sp),
            cuts=[EndCutSpec(miter=e.miter, bevel=e.bevel) for e in g.ends], face_up=g.face_up, members=g.members,
        ))
    a.parts = parts
    a.frame_warnings = res.warnings


async def derive_all(db: AsyncDatabase, content: ProjectContent) -> ProjectContent:
    if not any(a.frame for a in content.assemblies):
        return content
    profiles, items = await frame_profiles(db, content)
    for a in content.assemblies:
        derive_parts(a, profiles, items)
    return content
