import os

import pytest
from httpx import ASGITransport, AsyncClient

os.environ.setdefault("AUTH_MODE", "dev")
os.environ["ADMIN_EMAILS"] = "admin@test.dev"
os.environ["GOOGLE_API_KEY"] = ""

from app import db  # noqa: E402
from app.catalog_sync import sync_noyman, sync_steel  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed_if_empty  # noqa: E402
from app.services import planner  # noqa: E402

TEST_DB = "woodchunk_test"


@pytest.fixture(scope="session")
async def database():
    database = await db.connect(name=TEST_DB)
    await db.state.client.drop_database(TEST_DB)
    database = await db.connect(name=TEST_DB)
    await seed_if_empty(database)
    await sync_steel(database)
    await sync_noyman(database)
    yield database
    await db.state.client.drop_database(TEST_DB)
    await db.close()


@pytest.fixture
async def client(database):
    planner.clear_cache()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def auth(email: str = "admin@test.dev") -> dict:
    return {"Authorization": f"Bearer dev:{email}"}
