"""Project setup chat: free text (English or Hebrew) → a proposal of edits.

One model call per message (free-tier budget): the prompt carries the conversation so
far, the current project and a compact catalog, and the model answers with a reply plus
structured operations. Nothing is applied until the user presses Apply.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from app.models.catalog import CatalogItem, ItemKind
from app.models.project import Project, ProjectContent
from app.services.ai.client import get_ai
from app.services.proposals import AIOp

MAX_CATALOG = 250

SYSTEM = """You are Woodchunk's workshop assistant. You help people plan woodworking builds by
editing their project: assemblies (things being built, each with a quantity) made of parts
cut from catalog materials, plus hardware.

How a project works:
- A project holds assemblies. An assembly's qty multiplies its parts and its hardware.
- A part is cut from ONE catalog material (item_id). Lumber parts only need length_mm: their
  cross-section comes from the material. Sheet parts need length_mm (along the grain) and
  width_mm; set grain_locked true for visible panels where grain direction matters.
- Hardware (screws, hinges, glue…) belongs to an assembly (multiplied by its qty) or to
  "EXTRAS" for things used once for the whole project.
- All dimensions are millimetres. Convert cm/m/inches yourself.

Rules for your answer:
- Use ONLY item_id values from the catalog list, copied exactly. Choose sensible materials
  (e.g. 100×44 or 70×70 for legs and frames, 22 mm boards for slats, plywood for panels).
  If nothing suitable exists, leave item_id null and say so in the reply.
- Compute real cut lengths from the overall dimensions the user gives (account for
  material thickness where pieces butt together). Be practical, like an experienced
  carpenter. Prefer simple screwed butt joints unless asked otherwise.
- For a new build, add one assembly per distinct thing (use keys NEW1, NEW2…) and all
  its parts and the screws it needs. For edits, reference existing assemblies by letter
  and existing parts by label (e.g. "B2") in `target`.
- Name assemblies and parts in short English (e.g. "Leg", "Top slat").
- If a critical detail is missing and you cannot make a reasonable assumption, ask ONE
  short question and return no ops. Otherwise make assumptions and state them briefly.
- `reply` is written in the same language as the user's last message (Hebrew if they wrote
  Hebrew), 1-3 short sentences: what you did and any assumptions. No markdown.
- `summary` is a short English title for the change, e.g. "Add lower shelf to Table".
"""


class ChatAnswer(BaseModel):
    reply: str
    summary: str
    ops: list[AIOp] = Field(description="Edits to apply. Empty when asking a question.")


def item_line(it: CatalogItem) -> str:
    if it.kind == ItemKind.lumber:
        lengths = "/".join(f"{s.length_mm / 1000:g}" for s in sorted(it.lumber_stock, key=lambda s: s.length_mm))
        price = f", {it.price_per_m:g}/m" if it.price_per_m is not None else ""
        return f"{it.id} | lumber | {it.name.en} | {it.width_mm:g}×{it.thickness_mm:g} mm | lengths {lengths} m{price}"
    if it.kind == ItemKind.sheet:
        sizes = ", ".join(f"{s.width_mm:g}×{s.length_mm:g}" for s in it.sheet_stock)
        return (f"{it.id} | sheet | {it.name.en} | {it.thickness_mm or 0:g} mm | sizes {sizes}"
                f"{'' if it.has_grain else ' | no grain'}")
    pack = f" (pack of {it.pack_size})" if it.pack_size > 1 else ""
    return f"{it.id} | hardware | {it.name.en}{pack}"


def shortlist(items: list[CatalogItem], text: str, project: ProjectContent) -> list[CatalogItem]:
    active = [i for i in items if i.status != "retired"]
    if len(active) <= MAX_CATALOG:
        return active
    used = {p.item_id for a in project.assemblies for p in a.parts} | {
        h.item_id for a in project.assemblies for h in a.hardware}
    words = {w for w in re.findall(r"[\w֐-׿]+", text.lower()) if len(w) > 1}

    def score(it: CatalogItem) -> int:
        return (100 if it.id in used else 0) + sum(1 for w in words if w in it.search)

    return sorted(active, key=score, reverse=True)[:MAX_CATALOG]


def project_context(p: ProjectContent, items: dict[str, CatalogItem]) -> str:
    lines = [f'Project "{p.name}"' + (f" - {p.description}" if p.description else "")]
    if not p.assemblies and not p.extras:
        lines.append("(empty project)")
    for a in p.assemblies:
        lines.append(f'{a.letter} "{a.name}" ×{a.qty}')
        for i, pt in enumerate(a.parts):
            it = items.get(pt.item_id or "")
            dims = f"{pt.length_mm:g}" + (f"×{pt.width_mm:g}" if pt.width_mm else "")
            lines.append(f'  {a.letter}{i + 1} "{pt.name}" qty {pt.qty} {dims} mm item={pt.item_id} '
                         f"({it.name.en if it else 'none'})")
        for h in a.hardware:
            lines.append(f'  hardware "{h.name}" qty {h.qty:g} item={h.item_id}')
    for h in p.extras:
        lines.append(f'EXTRAS hardware "{h.name}" qty {h.qty:g} item={h.item_id}')
    return "\n".join(lines)


async def chat(
    project: Project, history: list[dict], message: str, catalog: list[CatalogItem]
) -> ChatAnswer:
    items = {i.id: i for i in catalog}
    cat = shortlist(catalog, message + " " + " ".join(h["text"] for h in history[-4:]), project)
    convo = "\n".join(f"{h['role'].upper()}: {h['text']}" for h in history[-12:])
    prompt = (
        "CATALOG (id | kind | name | dims | stock):\n" + "\n".join(item_line(i) for i in cat)
        + f"\n\nCURRENT PROJECT:\n{project_context(project, items)}"
        + (f"\n\nCONVERSATION SO FAR:\n{convo}" if convo else "")
        + f"\n\nUSER: {message}"
    )
    answer, _model = await get_ai().generate(ChatAnswer, SYSTEM, prompt, what="project.chat", temperature=0.3)
    return answer


SHEET_SYSTEM = SYSTEM + """

You are now converting a cut list the user uploaded (spreadsheet rows) into assemblies and
parts. Group rows into assemblies by any assembly/section column, otherwise one assembly
named after the file. Map each row's material description and dimensions to the closest
catalog item. Quantities in the sheet are per assembly unless stated otherwise. In `reply`
mention rows you could not map."""


async def import_rows(project: Project, rows_text: str, catalog: list[CatalogItem], filename: str) -> ChatAnswer:
    items = {i.id: i for i in catalog}
    cat = shortlist(catalog, rows_text[:4000], project)
    prompt = (
        "CATALOG (id | kind | name | dims | stock):\n" + "\n".join(item_line(i) for i in cat)
        + f"\n\nCURRENT PROJECT:\n{project_context(project, items)}"
        + f"\n\nUPLOADED FILE {filename!r} (first rows):\n{rows_text}"
        + "\n\nUSER: Add the parts from this cut list to my project."
    )
    answer, _model = await get_ai().generate(ChatAnswer, SHEET_SYSTEM, prompt, what="project.import",
                                             temperature=0.1)
    return answer
