"""End-to-end API flows against a real MongoDB test database, with a fake AI client."""

import asyncio
import json

import pytest

from app.services.ai import client as ai_client
from app.services.ai.catalog_ai import ExtractedItem, Extraction, Translation, Translations
from app.services.ai.project_chat import ChatAnswer
from app.services.proposals import AIOp
from tests.conftest import auth

USER = "maker@test.dev"


async def find_item(client, q: str, kind: str) -> dict:
    r = await client.get("/api/catalog", params={"q": q, "kind": kind}, headers=auth())
    assert r.status_code == 200, r.text
    items = r.json()
    assert items, f"no catalog item for {q!r}"
    return items[0]


def op(**kw) -> AIOp:
    base = dict(name=None, qty=None, target=None, item_id=None, length_mm=None, width_mm=None, grain_locked=None,
                unit_price=None)
    return AIOp(**{**base, **kw})


async def new_project(client, email=USER, **content) -> dict:
    r = await client.post("/api/projects", json={"name": content.pop("name", "Test bench")}, headers=auth(email))
    assert r.status_code == 201, r.text
    p = r.json()
    if content:
        body = {**{k: p[k] for k in ("name", "description", "settings", "assemblies", "extras")}, **content,
                "version": p["version"]}
        r = await client.put(f"/api/projects/{p['id']}", json=body, headers=auth(email))
        assert r.status_code == 200, r.text
        p = r.json()
    return p


async def test_me_and_catalog(client):
    r = await client.get("/api/me", headers=auth())
    assert r.json()["role"] == "admin"
    r = await client.get("/api/me", headers=auth(USER))
    assert r.json()["role"] == "user"
    r = await client.get("/api/catalog", params={"q": "44 × 100"}, headers=auth(USER))
    assert any("44 × 100" in i["name"]["en"] for i in r.json())
    assert (await client.get("/api/catalog", headers={})).status_code == 401


async def test_plan_shop_buy_cut_cycle(client):
    beam = await find_item(client, "44 × 100 whitewood rough", "lumber")
    ply = await find_item(client, "18 mm birch", "sheet")
    p = await new_project(client, assemblies=[
        {"name": "Sawhorse", "qty": 2, "parts": [
            {"name": "Leg", "item_id": beam["id"], "qty": 4, "length_mm": 760},
            {"name": "Beam", "item_id": beam["id"], "qty": 1, "length_mm": 900}]},
        {"name": "Top", "qty": 1, "parts": [
            {"name": "Panel", "item_id": ply["id"], "qty": 1, "length_mm": 1800, "width_mm": 800, "grain_locked": True},
            {"name": "Missing width", "item_id": ply["id"], "qty": 1, "length_mm": 300}]},
    ])
    assert [a["letter"] for a in p["assemblies"]] == ["A", "B"]

    plan = (await client.get(f"/api/projects/{p['id']}/plan", headers=auth(USER))).json()
    assert plan["totals"]["parts"] == 2 * 5 + 2
    assert [u["label"] for u in plan["unplaced"]] == ["B2"]
    assert "width" in plan["unplaced"][0]["reason"]
    lumber = plan["lumber"][0]
    placed = sum(1 for pat in lumber["patterns"] for s in pat["segments"] if s["kind"] == "part" for _ in range(pat["count"]))
    assert placed == 10
    sheet = plan["sheets"][0]
    assert len(sheet["layouts"]) == 1 and sheet["layouts"][0]["cuts"]
    assert sheet["cost"] == 283.2  # one 2440 × 1220 sheet of 18 mm birch at Noyman

    # Can't buy while something doesn't fit.
    r = await client.post(f"/api/projects/{p['id']}/status", json={"status": "bought"}, headers=auth(USER))
    assert r.status_code == 409
    p["assemblies"][1]["parts"].pop()
    body = {**{k: p[k] for k in ("name", "description", "settings", "assemblies", "extras")}, "version": p["version"]}
    p = (await client.put(f"/api/projects/{p['id']}", json=body, headers=auth(USER))).json()

    # Stale version is rejected.
    body["version"] = 1
    assert (await client.put(f"/api/projects/{p['id']}", json=body, headers=auth(USER))).status_code == 409

    shop = (await client.get(f"/api/projects/{p['id']}/shopping", headers=auth(USER))).json()
    assert shop["count"] >= 2
    key = shop["groups"][0]["lines"][0]["key"]
    r = await client.put(f"/api/projects/{p['id']}/shopping/checked", json={"key": key, "checked": True},
                         headers=auth(USER))
    assert r.status_code == 204
    shop = (await client.get(f"/api/projects/{p['id']}/shopping", headers=auth(USER))).json()
    assert shop["checked"] == 1

    p = (await client.post(f"/api/projects/{p['id']}/status", json={"status": "bought"}, headers=auth(USER))).json()
    assert p["status"] == "bought" and p["purchase"]["lines"]
    # After buying, nothing left to buy until the design changes.
    shop = (await client.get(f"/api/projects/{p['id']}/shopping", headers=auth(USER))).json()
    assert not any(ln["kind"] in ("lumber", "sheet") for g in shop["groups"] for ln in g["lines"])

    # Add a part after buying: only the extra stock appears.
    p["assemblies"][0]["parts"].append({"name": "Shelf rail", "item_id": beam["id"], "qty": 4, "length_mm": 2000})
    body = {**{k: p[k] for k in ("name", "description", "settings", "assemblies", "extras")}, "version": p["version"]}
    p = (await client.put(f"/api/projects/{p['id']}", json=body, headers=auth(USER))).json()
    shop = (await client.get(f"/api/projects/{p['id']}/shopping", headers=auth(USER))).json()
    extra = [ln for g in shop["groups"] for ln in g["lines"] if ln["kind"] == "lumber"]
    assert extra, "extra boards should be on the list"

    p = (await client.post(f"/api/projects/{p['id']}/status", json={"status": "bought"}, headers=auth(USER))).json()
    p = (await client.post(f"/api/projects/{p['id']}/status", json={"status": "cut"}, headers=auth(USER))).json()
    assert p["status"] == "cut"
    inv = (await client.get("/api/workshop/inventory", headers=auth(USER))).json()
    assert any(e["kind"] == "offcut" and e["source_project_id"] == p["id"] for e in inv)
    # Done projects are read-only.
    p = (await client.post(f"/api/projects/{p['id']}/status", json={"status": "done"}, headers=auth(USER))).json()
    body = {**{k: p[k] for k in ("name", "description", "settings", "assemblies", "extras")}, "version": p["version"]}
    assert (await client.put(f"/api/projects/{p['id']}", json=body, headers=auth(USER))).status_code == 409


async def test_inventory_is_used_first(client):
    beam = await find_item(client, "44 × 100 whitewood rough", "lumber")
    email = "stock@test.dev"
    r = await client.post("/api/workshop/inventory", json={"item_id": beam["id"], "kind": "full", "length_mm": 2400,
                                                            "qty": 2}, headers=auth(email))
    assert r.status_code == 201, r.text
    p = await new_project(client, email, assemblies=[
        {"name": "Frame", "qty": 1, "parts": [{"name": "Rail", "item_id": beam["id"], "qty": 2, "length_mm": 1100}]}])
    plan = (await client.get(f"/api/projects/{p['id']}/plan", headers=auth(email))).json()
    assert plan["totals"]["from_inventory"] == 1
    assert plan["totals"]["lumber_cost"] == 0


async def test_carry_limit_reports_parts(client):
    beam = await find_item(client, "44 × 100 whitewood rough", "lumber")
    p = await new_project(client, assemblies=[
        {"name": "Beam", "qty": 1, "parts": [{"name": "Long", "item_id": beam["id"], "qty": 1, "length_mm": 3200}]}],
        settings={"max_stock_length_mm": 3000})
    plan = (await client.get(f"/api/projects/{p['id']}/plan", headers=auth(USER))).json()
    assert plan["unplaced"] and "carry limit" in plan["unplaced"][0]["reason"]


class FakeAI:
    enabled = True

    def __init__(self, answers: dict):
        self.answers = answers
        self.calls: list[str] = []

    async def generate(self, schema, system, contents, *, what, temperature=0.2):
        self.calls.append(what)
        ans = self.answers[what]
        return (ans(contents) if callable(ans) else ans), "fake-model"


async def test_ai_chat_proposal_apply(client):
    beam = await find_item(client, "44 × 100 whitewood rough", "lumber")
    screws = await find_item(client, "Wood screw 5×80", "hardware")
    p = await new_project(client, name="Chat build")
    fake = FakeAI({"project.chat": ChatAnswer(reply="הוספתי סוס עבודה", summary="Add a sawhorse", ops=[
        op(action="add_assembly", assembly="NEW1", name="Sawhorse", qty=2),
        op(action="add_part", assembly="NEW1", name="Leg", item_id=beam["id"], qty=4, length_mm=760),
        op(action="add_part", assembly="NEW1", name="Ghost", item_id="does-not-exist", qty=1, length_mm=500),
        op(action="add_hardware", assembly="NEW1", name="Screw", item_id=screws["id"], qty=16),
    ])})
    ai_client.set_ai(fake)
    try:
        r = await client.post(f"/api/ai/projects/{p['id']}/chat", json={"message": "תוסיף סוס עבודה"},
                              headers=auth(USER))
        assert r.status_code == 200, r.text
        convo = r.json()
        assert [m["role"] for m in convo["messages"]] == ["user", "assistant"]
        prop = convo["proposals"][0]
        assert prop["cost_after"] > prop["cost_before"] == 0
        assert any("pick a material" in d["text"] for d in prop["diff"])
        p2 = (await client.post(f"/api/ai/proposals/{prop['id']}/apply", headers=auth(USER))).json()
        a = p2["assemblies"][0]
        assert a["letter"] == "A" and a["qty"] == 2
        assert a["parts"][1]["item_id"] is None  # invented id was not trusted
        # Applying twice is refused.
        assert (await client.post(f"/api/ai/proposals/{prop['id']}/apply", headers=auth(USER))).status_code == 409

        # An edit referring to a part label.
        fake.answers["project.chat"] = ChatAnswer(reply="Done", summary="Longer legs", ops=[
            op(action="update_part", assembly="A", target="A1", length_mm=800)])
        convo = (await client.post(f"/api/ai/projects/{p['id']}/chat", json={"message": "legs 80cm"},
                                   headers=auth(USER))).json()
        prop = [x for x in convo["proposals"] if x["status"] == "pending"][0]
        # Someone edits first: the suggestion becomes stale.
        body = {**{k: p2[k] for k in ("name", "description", "settings", "assemblies", "extras")},
                "version": p2["version"]}
        await client.put(f"/api/projects/{p['id']}", json=body, headers=auth(USER))
        assert (await client.post(f"/api/ai/proposals/{prop['id']}/apply", headers=auth(USER))).status_code == 409
    finally:
        ai_client.set_ai(None)


async def test_ai_catalog_import_and_translation(client):
    extraction = Extraction(supplier_name="Test Timber", currency="ILS", items=[
        ExtractedItem(kind="lumber", name_en="44 × 70 pine, treated", name_he="אורן 44/70 שימור", material="pine",
                      treatment="treated", category="beams", sku="T-1", url=None, thickness_mm=44, width_mm=70,
                      price_per_m=11.0, stock_lengths_mm=[3000, 4000], stock_length_prices=None,
                      sheet_lengths_mm=None, sheet_widths_mm=None, sheet_prices=None, has_grain=None, pack_size=None,
                      unit=None, price=None),
        ExtractedItem(kind="sheet", name_en="18 mm MDF", name_he="MDF 18 מ״מ", material="mdf", treatment=None,
                      category="mdf", sku=None, url=None, thickness_mm=18, width_mm=None, price_per_m=None,
                      stock_lengths_mm=None, stock_length_prices=None, sheet_lengths_mm=[2440],
                      sheet_widths_mm=[1220], sheet_prices=[210], has_grain=None, pack_size=None, unit=None,
                      price=None),
    ])
    fake = FakeAI({"catalog.import": extraction,
                   "translate": lambda contents: Translations(items=[
                       Translation(source=s[2:], text=f"עב:{s[2:]}") for s in contents.split("\n")[1:]])})
    ai_client.set_ai(fake)
    try:
        r = await client.post("/api/ai/catalog/import", data={"text": "44/70 pine treated 11/m; MDF 18mm 210"},
                              headers=auth())
        assert r.status_code == 200, r.text
        imp = r.json()
        assert imp["supplier_name"] == "Test Timber"
        assert [i["action"] for i in imp["items"]] == ["new", "new"]
        assert imp["items"][1]["item"]["has_grain"] is False
        r = await client.post(f"/api/ai/catalog/imports/{imp['id']}/apply", json={"selected": [0, 1]}, headers=auth())
        assert r.json()["created"] == 2
        mdf = await find_item(client, "18 mm mdf", "sheet")
        assert mdf["supplier_name"] == "Test Timber"

        p = await new_project(client, name="Translate me", assemblies=[{"name": "Frame", "qty": 1, "parts": [
            {"name": "Leg", "item_id": mdf["id"], "qty": 1, "length_mm": 500, "width_mm": 300}]}])
        tr = (await client.post(f"/api/projects/{p['id']}/translations", params={"lang": "he"},
                                headers=auth(USER))).json()
        assert tr["Leg"] == "עב:Leg"
        csv = (await client.get(f"/api/projects/{p['id']}/export/cutlist.csv", params={"lang": "he"},
                                headers=auth(USER))).text
        assert "עב:Leg" in csv and "תווית" in csv
        # Cached: a second request does not call the model again.
        n = fake.calls.count("translate")
        await client.post(f"/api/projects/{p['id']}/translations", params={"lang": "he"}, headers=auth(USER))
        assert fake.calls.count("translate") == n
    finally:
        ai_client.set_ai(None)


async def test_ai_not_configured_is_a_clear_error(client):
    p = await new_project(client, name="No AI")
    r = await client.post(f"/api/ai/projects/{p['id']}/chat", json={"message": "hi"}, headers=auth(USER))
    assert r.status_code == 503 and "GOOGLE_API_KEY" in r.json()["detail"]


async def test_sharing_and_permissions(client):
    p = await new_project(client, name="Shared")
    other = "friend@test.dev"
    assert (await client.get(f"/api/projects/{p['id']}", headers=auth(other))).status_code == 404
    inv = (await client.post(f"/api/projects/{p['id']}/invites", json={"role": "viewer"}, headers=auth(USER))).json()
    assert (await client.get(f"/api/invites/{inv['token']}", headers=auth(other))).json()["project_name"] == "Shared"
    r = await client.post(f"/api/invites/{inv['token']}/accept", headers=auth(other))
    assert r.status_code == 200
    assert (await client.get(f"/api/projects/{p['id']}", headers=auth(other))).status_code == 200
    body = {**{k: p[k] for k in ("name", "description", "settings", "assemblies", "extras")}, "version": p["version"]}
    assert (await client.put(f"/api/projects/{p['id']}", json=body, headers=auth(other))).status_code == 403


async def test_collaboration(client):
    """Who saved, a cheap sync check, viewers ticking the list, and the owner managing links and people."""
    p = await new_project(client, name="Together")
    pid, editor, viewer = p["id"], "editor@test.dev", "viewer@test.dev"
    links = {}
    for who, role in ((editor, "editor"), (viewer, "viewer")):
        inv = (await client.post(f"/api/projects/{pid}/invites", json={"role": role}, headers=auth(USER))).json()
        assert (await client.post(f"/api/invites/{inv['token']}/accept", headers=auth(who))).status_code == 200
        links[role] = inv["token"]

    # An editor's save is attributed to them, and the sync check says so.
    body = {**{k: p[k] for k in ("name", "description", "settings", "assemblies", "extras")}, "version": p["version"]}
    saved = (await client.put(f"/api/projects/{pid}", json={**body, "name": "Together v2"}, headers=auth(editor))).json()
    sync = (await client.get(f"/api/projects/{pid}/sync", headers=auth(USER))).json()
    assert sync["version"] == saved["version"] and sync["updated_by_name"] == "Editor"

    # Viewers can tick the shopping list (not edit); a tick moves the sync counter, not the version.
    r = await client.put(f"/api/projects/{pid}/shopping/checked", json={"key": "x", "checked": True}, headers=auth(viewer))
    assert r.status_code == 204
    after = (await client.get(f"/api/projects/{pid}/sync", headers=auth(viewer))).json()
    assert after["checks_rev"] == sync["checks_rev"] + 1 and after["version"] == sync["version"]
    outsider = await client.put(f"/api/projects/{pid}/shopping/checked", json={"key": "x", "checked": False}, headers=auth("stranger@test.dev"))
    assert outsider.status_code == 404

    # The owner sees the links that still work, with who joined, and can revoke one.
    listed = (await client.get(f"/api/projects/{pid}/invites", headers=auth(USER))).json()
    assert {(i["role"], i["joined"]) for i in listed} == {("editor", 1), ("viewer", 1)}
    assert (await client.get(f"/api/projects/{pid}/invites", headers=auth(editor))).status_code == 403
    viewer_link = next(i for i in listed if i["role"] == "viewer")
    assert (await client.delete(f"/api/projects/{pid}/invites/{viewer_link['id']}", headers=auth(USER))).status_code == 204
    assert (await client.get(f"/api/invites/{links['viewer']}", headers=auth("late@test.dev"))).status_code == 404

    # Changing someone's access: the viewer becomes an editor; the owner can't be changed.
    me = (await client.get("/api/me", headers=auth(viewer))).json()
    r = await client.put(f"/api/projects/{pid}/members/{me['id']}", json={"role": "editor"}, headers=auth(USER))
    assert next(m for m in r.json()["members"] if m["user_id"] == me["id"])["role"] == "editor"
    owner = (await client.get("/api/me", headers=auth(USER))).json()
    assert (await client.put(f"/api/projects/{pid}/members/{owner['id']}", json={"role": "viewer"}, headers=auth(USER))).status_code == 409
    # A member can leave.
    r = await client.delete(f"/api/projects/{pid}/members/{me['id']}", headers=auth(viewer))
    assert r.status_code == 200 and all(m["user_id"] != me["id"] for m in r.json()["members"])


async def test_templates(client):
    tpls = (await client.get("/api/templates", headers=auth(USER))).json()
    bench = next(t for t in tpls if t["title"].startswith("Workbench"))
    r = await client.post("/api/projects", json={"template_id": bench["id"]}, headers=auth(USER))
    assert r.status_code == 201
    p = r.json()
    assert p["name"].startswith("Workbench") and not p["is_template"]
    plan = (await client.get(f"/api/projects/{p['id']}/plan", headers=auth(USER))).json()
    assert not plan["unplaced"], plan["unplaced"]
    assert plan["sheets"] and plan["lumber"]
    for t in tpls:
        q = await client.post("/api/projects", json={"template_id": t["id"]}, headers=auth(USER))
        plan = (await client.get(f"/api/projects/{q.json()['id']}/plan", headers=auth(USER))).json()
        assert not plan["unplaced"], (t["title"], plan["unplaced"])


async def test_drawn_assembly_parts_come_from_its_frame(client):
    tube = await find_item(client, "40 40 2 square tube", "lumber")
    assert tube["profile"]["shape"] == "rect_tube" and tube["kg_per_m"] > 2
    frame = {
        "params": [{"name": "W", "mm": 900}, {"name": "D", "mm": 500}, {"name": "H", "mm": 800}],
        "defaults": {"corner": "butt", "lines": "outside"},
        "nodes": [{"id": f"{z}{i}", "x": x, "y": y, "z": "H" if z == "t" else 0}
                  for z in "bt" for i, (x, y) in enumerate([(0, 0), ("W", 0), ("W", "D"), (0, "D")])],
        "members": [
            *[{"id": f"leg{i}", "a": f"b{i}", "b": f"t{i}", "item_id": tube["id"], "name": "Leg"} for i in range(4)],
            *[{"id": f"rail{i}", "a": f"t{i}", "b": f"t{(i + 1) % 4}", "item_id": tube["id"], "name": "Rail"}
              for i in range(4)],
        ],
    }
    asm = {"name": "Cart frame", "qty": 1, "frame": frame,
           "parts": [{"name": "stale", "item_id": tube["id"], "qty": 9, "length_mm": 1}]}
    p = await new_project(client, assemblies=[asm])
    parts = sorted((pt["name"], pt["qty"], pt["length_mm"]) for pt in p["assemblies"][0]["parts"])
    assert parts == [("Leg", 4, 800), ("Rail", 2, 420), ("Rail", 2, 820)]  # 500 - 2 x 40, 900 - 2 x 40
    leg = next(pt for pt in p["assemblies"][0]["parts"] if pt["name"] == "Leg")
    assert len(leg["members"]) == 4 and leg["cuts"] == [{"miter": 0, "bevel": 0}] * 2
    assert p["assemblies"][0]["frame_warnings"] == []

    # The plan buys 6 m bars for 4 x 800 + 2 x 820 + 2 x 420 = 5680 mm (+ kerf).
    plan = (await client.get(f"/api/projects/{p['id']}/plan", headers=auth(USER))).json()
    lp = next(x for x in plan["lumber"] if x["item_id"] == tube["id"])
    assert sum(b["qty"] for b in lp["buy"]) >= 1

    # Change a parameter: the parts follow on save.
    body = {**{k: p[k] for k in ("name", "description", "settings", "assemblies", "extras")}, "version": p["version"]}
    body["assemblies"][0]["frame"]["params"][0]["mm"] = 1200
    p = (await client.put(f"/api/projects/{p['id']}", json=body, headers=auth(USER))).json()
    assert sorted(pt["length_mm"] for pt in p["assemblies"][0]["parts"])[-1] == 1120


async def test_mitered_frame_through_plan_and_exports(client):
    tube = await find_item(client, "30 30 2 square tube", "lumber")
    frame = {
        "defaults": {"corner": "miter", "lines": "outside"},
        "nodes": [{"id": "a", "x": 0, "y": 0}, {"id": "b", "x": 800, "y": 0},
                  {"id": "c", "x": 800, "y": 500}, {"id": "d", "x": 0, "y": 500}],
        "members": [{"id": f"m{i}", "a": a, "b": b, "item_id": tube["id"], "name": "Side"}
                    for i, (a, b) in enumerate([("a", "b"), ("b", "c"), ("c", "d"), ("d", "a")])],
    }
    p = await new_project(client, assemblies=[{"name": "Frame", "qty": 1, "frame": frame}])
    parts = {pt["length_mm"]: pt for pt in p["assemblies"][0]["parts"]}
    assert set(parts) == {800, 500}
    assert parts[800]["cuts"] == [{"miter": 45, "bevel": 0}] * 2 and parts[800]["short_mm"] == 740

    plan = (await client.get(f"/api/projects/{p['id']}/plan", headers=auth(USER))).json()
    segs = [s for lp in plan["lumber"] for pat in lp["patterns"] for s in pat["segments"] if s["kind"] == "part"]
    assert sorted({s["length"] for s in segs}) == [500, 800]  # the part itself, not its footprint
    assert all(s["cuts"] == [{"miter": 45, "bevel": 0}] * 2 for s in segs)
    assert not any("miter" in w for w in plan["warnings"])

    # A saw that only turns to 40° can't make these cuts.
    body = {**{k: p[k] for k in ("name", "description", "settings", "assemblies", "extras")}, "version": p["version"]}
    body["settings"]["max_miter_deg"] = 40
    p = (await client.put(f"/api/projects/{p['id']}", json=body, headers=auth(USER))).json()
    plan = (await client.get(f"/api/projects/{p['id']}/plan", headers=auth(USER))).json()
    assert any("45° miter (your saw: 40°)" in w for w in plan["warnings"])

    csv = (await client.get(f"/api/projects/{p['id']}/export/cutlist.csv", headers=auth(USER))).text
    assert "Ends" in csv.splitlines()[0] and "45° / 45° · long point" in csv


def test_angle_allowance():
    from app.models.project import EndCutSpec
    from app.services.planner import angle_allowance
    assert angle_allowance([], 3) == (0, 0)
    a, b = angle_allowance([EndCutSpec(miter=45), EndCutSpec()], 3)
    assert b == 0 and a == pytest.approx(3 * (2**0.5 - 1), abs=0.01)  # kerf / cos 45° - kerf


def _body(p: dict) -> dict:
    return {**{k: p[k] for k in ("name", "description", "settings", "assemblies", "extras")}, "version": p["version"]}


async def test_bad_input_is_rejected_or_contained(client):
    tube = await find_item(client, "40 40 2 square tube", "lumber")
    p = await new_project(client)
    # NaN/Infinity are refused (422), never stored.
    body = _body(p)
    body["assemblies"] = [{"name": "A", "parts": [{"name": "x", "item_id": tube["id"], "length_mm": 1}]}]
    raw = json.dumps(body).replace('"length_mm": 1', '"length_mm": Infinity')
    r = await client.put(f"/api/projects/{p['id']}", content=raw, headers={**auth(USER), "content-type": "application/json"})
    assert r.status_code == 422
    # Typed parts can't carry frame data; angles are bounded.
    body["assemblies"][0]["parts"][0]["cuts"] = [{"miter": 120, "bevel": 0}]
    assert (await client.put(f"/api/projects/{p['id']}", json=body, headers=auth(USER))).status_code == 422
    body["assemblies"][0]["parts"][0]["cuts"] = [{"miter": 45, "bevel": 0}]
    p = (await client.put(f"/api/projects/{p['id']}", json=body, headers=auth(USER))).json()
    assert p["assemblies"][0]["parts"][0]["cuts"] == []
    # A frame with a hostile expression still saves; the bar on that joint is left out with a warning.
    body = _body(p)
    body["assemblies"] = [{"name": "F", "frame": {
        "nodes": [{"id": "a", "x": 0}, {"id": "b", "x": "9" * 150}, {"id": "c", "x": 500}],
        "members": [{"id": "ab", "a": "a", "b": "b", "item_id": tube["id"]},
                    {"id": "ac", "a": "a", "b": "c", "item_id": tube["id"]}]}}]
    r = await client.put(f"/api/projects/{p['id']}", json=body, headers=auth(USER))
    assert r.status_code == 200, r.text
    asm = r.json()["assemblies"][0]
    assert [pt["length_mm"] for pt in asm["parts"]] == [500] and any("left out" in w for w in asm["frame_warnings"])


async def test_status_change_is_claimed_once(client):
    beam = await find_item(client, "44 × 100 whitewood rough", "lumber")
    p = await new_project(client, assemblies=[{"name": "A", "parts": [{"name": "Leg", "item_id": beam["id"], "length_mm": 700}]}],
                          extras=[{"name": "wood glue", "qty": 1, "unit_price": 20}])
    r = await client.post(f"/api/projects/{p['id']}/status", json={"status": "bought"}, headers=auth(USER))
    assert r.status_code == 200
    shop = (await client.get(f"/api/projects/{p['id']}/shopping", headers=auth(USER))).json()
    assert not any(ln["name"] == "wood glue" for g in shop["groups"] for ln in g["lines"])  # typed hardware counts as bought
    results = await asyncio.gather(*[client.post(f"/api/projects/{p['id']}/status", json={"status": "cut"},
                                                 headers=auth(USER)) for _ in range(3)])
    assert sorted(r.status_code for r in results) == [200, 409, 409]
    inv = (await client.get("/api/workshop/inventory", headers=auth(USER))).json()
    assert len([e for e in inv if e.get("source_project_id") == p["id"]]) <= 1


async def test_ai_cannot_edit_drawn_parts():
    from app.models.project import Assembly, ProjectContent
    from app.services.proposals import apply_ops
    content = ProjectContent(assemblies=[Assembly(name="Frame", frame={"nodes": [], "members": []})])
    new, diff = apply_ops(content, [op(action="add_part", assembly="A", name="Leg", qty=99999, length_mm=1e12)], {})
    assert new.assemblies[0].parts == [] and diff[0].kind == "note"
