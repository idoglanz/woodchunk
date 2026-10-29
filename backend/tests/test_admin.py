"""The admin panel: usage counts per person and over time, and that no project content leaks into it."""

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from app.services import activity
from app.services.ai import client as ai_client
from app.services.ai.project_chat import ChatAnswer
from tests.conftest import auth
from tests.test_api import new_project

SECRET = "Secret walnut credenza"


def day(n: int = 0) -> str:
    return (datetime.now(UTC) - timedelta(days=n)).strftime("%Y-%m-%d")


class FakeGenai:
    """Stands in for the Gemini SDK under the real AIClient, so the usage recording runs for real."""

    def __init__(self):
        self.result: object = None
        self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=self._generate))

    async def _generate(self, model, contents, config):
        if isinstance(self.result, Exception):
            raise self.result
        return SimpleNamespace(parsed=self.result, text="")


def real_ai(fake: FakeGenai) -> ai_client.AIClient:
    ai = ai_client.AIClient()
    ai._client = fake
    return ai


async def person(client, email: str) -> dict:
    rows = (await client.get("/api/admin/users", headers=auth())).json()
    return next(r for r in rows if r["email"] == email)


async def test_admin_endpoints_are_admin_only(client):
    who = auth("nosy@test.dev")
    assert (await client.get("/api/admin/overview", headers=who)).status_code == 403
    assert (await client.get("/api/admin/users", headers=who)).status_code == 403
    assert (await client.get("/api/admin/users/x", headers=who)).status_code == 403
    assert (await client.post("/api/admin/projects/x/restore", headers=who)).status_code == 403
    assert (await client.get("/api/admin/users/nobody", headers=auth())).status_code == 404


async def test_activity_is_one_write_per_window(client, database):
    email = "busy@test.dev"
    for _ in range(5):
        await client.get("/api/me", headers=auth(email))
    await activity.flush()
    me = (await client.get("/api/me", headers=auth(email))).json()
    await activity.flush()
    docs = [d async for d in database.user_activity.find({"user_id": me["id"]})]
    assert len(docs) == 1 and docs[0]["day"] == day()
    assert docs[0]["windows"] in (1, 2)  # 2 only if the test straddles a 5-minute boundary
    assert set(docs[0]) == {"_id", "user_id", "day", "windows"}


async def test_ai_calls_are_counted_per_person(client):
    email = "ai-user@test.dev"
    p = await new_project(client, email, name=SECRET)
    fake = FakeGenai()
    ai_client.set_ai(real_ai(fake))
    try:
        fake.result = ChatAnswer(reply="ok", summary="", ops=[])
        r = await client.post(f"/api/ai/projects/{p['id']}/chat", json={"message": "hi"}, headers=auth(email))
        assert r.status_code == 200, r.text
        fake.result = ValueError("400 bad request")  # not a quota error: fails at once, counted as not ok
        r = await client.post(f"/api/ai/projects/{p['id']}/chat", json={"message": "again"}, headers=auth(email))
        assert r.status_code >= 400
    finally:
        ai_client.set_ai(None)
    await activity.flush()

    row = await person(client, email)
    assert row["ai_calls_7d"] == row["ai_calls_30d"] == 2
    assert row["projects"] == 1 and row["shared"] == 0
    assert row["active_days_30d"] == 1 and row["level"] == "light"

    detail = (await client.get(f"/api/admin/users/{row['id']}", headers=auth())).json()
    today = detail["days"][-1]
    assert today["day"] == day() and today["ai_calls"] == 2 and today["ai_ok"] == 1
    assert today["projects_created"] == 1 and today["active_minutes"] >= 5
    assert detail["ai_features"] == [{"feature": "project.chat", "calls": 2}]


async def test_overview_series(client, database):
    await client.get("/api/me", headers=auth("fresh-signup@test.dev"))
    await new_project(client, "fresh-signup@test.dev", name=SECRET)
    # An older day: three users active, AI calls on two models.
    await database.user_activity.insert_many(
        [{"user_id": f"old-{i}", "day": day(3), "windows": 2, "ai_calls": 0, "ai_ok": 0} for i in range(3)])
    await database.ai_usage.insert_many([
        {"day": day(3), "model": "model-a", "calls": 4, "ok": 3},
        {"day": day(3), "model": "model-b", "calls": 1, "ok": 1},
    ])
    await activity.flush()

    r = await client.get("/api/admin/overview", params={"days": 14}, headers=auth())
    assert r.status_code == 200, r.text
    o = r.json()
    assert len(o["days"]) == 14 and o["days"][-1]["day"] == day() and o["days"][0]["day"] == day(13)
    today, old = o["days"][-1], o["days"][-4]
    assert today["signups"] >= 1 and today["projects_created"] >= 1 and today["active_users"] >= 1
    assert old["active_users"] == 3 and old["ai_calls"] == 5 and old["ai_ok"] == 4
    assert {"model": "model-a", "calls": 4, "ok": 3} in o["ai_models"]
    assert o["tracking_since"] <= day(3)
    assert o["users"] >= o["active_30d"] >= o["active_7d"] >= o["active_1d"] >= 1
    assert o["new_7d"] >= 1 and o["admins"] >= 1
    assert (await client.get("/api/admin/overview", params={"days": 3000}, headers=auth())).status_code == 422


async def test_levels_from_active_days(client, database):
    email = "regular@test.dev"
    me = (await client.get("/api/me", headers=auth(email))).json()
    await activity.flush()
    await database.user_activity.insert_many(
        [{"user_id": me["id"], "day": day(n), "windows": 3, "ai_calls": 1, "ai_ok": 1} for n in (2, 9, 20)])
    row = await person(client, email)
    assert row["active_days_30d"] == 4 and row["active_days_7d"] == 2
    assert row["level"] == "regular"
    assert row["ai_calls_30d"] == 3 and row["ai_calls_7d"] == 1


async def test_no_project_content_and_restore(client):
    email = "private@test.dev"
    p = await new_project(client, email, name=SECRET, description="for the hallway, in walnut",
                          assemblies=[{"name": "Carcass", "qty": 2, "parts": [{"name": "Side", "qty": 2, "length_mm": 700}]}])
    r = await client.post(f"/api/projects/{p['id']}/archive", json={"archived": True}, headers=auth(email))
    assert r.status_code == 200, r.text
    await activity.flush()

    row = await person(client, email)
    detail = (await client.get(f"/api/admin/users/{row['id']}", headers=auth())).json()
    assert detail["archived"] == [{"id": p["id"], "created_at": detail["archived"][0]["created_at"],
                                   "updated_at": detail["archived"][0]["updated_at"], "assemblies": 1, "parts": 4}]
    everything = json.dumps([
        (await client.get("/api/admin/overview", headers=auth())).json(),
        (await client.get("/api/admin/users", headers=auth())).json(),
        detail,
    ])
    for secret in (SECRET, "walnut", "Carcass", "Side"):
        assert secret not in everything

    assert (await client.post(f"/api/admin/projects/{p['id']}/restore", headers=auth())).status_code == 204
    assert (await client.post(f"/api/admin/projects/{p['id']}/restore", headers=auth())).status_code == 404
    mine = (await client.get("/api/projects", headers=auth(email))).json()
    assert any(x["id"] == p["id"] for x in mine)


async def test_role_change(client):
    email = "promote@test.dev"
    await client.get("/api/me", headers=auth(email))
    row = await person(client, email)
    r = await client.put(f"/api/admin/users/{row['id']}/role", json={"role": "admin"}, headers=auth())
    assert r.status_code == 200 and r.json()["role"] == "admin"
    assert (await person(client, email))["role"] == "admin"
    me = (await client.get("/api/me", headers=auth())).json()
    r = await client.put(f"/api/admin/users/{me['id']}/role", json={"role": "user"}, headers=auth())
    assert r.status_code == 409
