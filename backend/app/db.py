"""MongoDB connection (PyMongo's native async API)."""

import logging

from pymongo import ASCENDING, DESCENDING, AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.config import get_settings

logger = logging.getLogger(__name__)


class _State:
    client: AsyncMongoClient | None = None
    db: AsyncDatabase | None = None


state = _State()


async def connect(uri: str | None = None, name: str | None = None) -> AsyncDatabase:
    s = get_settings()
    state.client = AsyncMongoClient(uri or s.mongodb_uri, tz_aware=True)
    state.db = state.client[name or s.database_name]
    await create_indexes(state.db)
    logger.info("Connected to MongoDB database %s", state.db.name)
    return state.db


async def close() -> None:
    if state.client is not None:
        await state.client.close()
        state.client = None
        state.db = None


def get_db() -> AsyncDatabase:
    if state.db is None:
        raise RuntimeError("Database not connected")
    return state.db


async def create_indexes(db: AsyncDatabase) -> None:
    await db.users.create_index("email", unique=True)
    await db.catalog_items.create_index([("kind", ASCENDING), ("status", ASCENDING)])
    await db.catalog_items.create_index("supplier_id")
    await db.catalog_items.create_index([("search", ASCENDING)])
    await db.projects.create_index([("members.user_id", ASCENDING), ("updated_at", DESCENDING)])
    await db.projects.create_index([("is_template", ASCENDING), ("template.public", ASCENDING)])
    await db.inventory.create_index([("owner_id", ASCENDING), ("item_id", ASCENDING), ("status", ASCENDING)])
    await db.invites.create_index("token", unique=True)
    await db.ai_conversations.create_index([("project_id", ASCENDING), ("user_id", ASCENDING)])
    await db.ai_usage.create_index([("day", ASCENDING), ("model", ASCENDING)], unique=True)
    await db.user_activity.create_index([("user_id", ASCENDING), ("day", ASCENDING)], unique=True)
    await db.user_activity.create_index("day")
    await db.translations.create_index([("project_id", ASCENDING), ("lang", ASCENDING)], unique=True)
