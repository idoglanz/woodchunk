"""Per-user, per-day usage counters for the admin panel: how much people use the app, never what they build.

One small document per user per day in `user_activity`:
`{user_id, day, windows, ai_calls, ai_ok, ai_features: {feature: n}}`. `windows` counts the 5-minute windows
in which the user made any request, a cheap stand-in for time spent in the app. Nothing about projects is kept.

Writes are fire-and-forget increments: they never hold up a request, and a failed write only loses a count.
The window check is in memory, so a page load's burst of requests costs one write, not one per request.
"""

from __future__ import annotations

import asyncio
import logging
from contextvars import ContextVar
from datetime import UTC, datetime

from app.db import get_db

logger = logging.getLogger(__name__)

WINDOW_S = 300

# Who the current request is for, so the AI client can count a call without every caller passing the user.
current_user_id: ContextVar[str | None] = ContextVar("current_user_id", default=None)

_last_window: dict[str, int] = {}
_pending: set[asyncio.Task] = set()


def day_key(at: datetime | None = None) -> str:
    return (at or datetime.now(UTC)).strftime("%Y-%m-%d")


def seen(user_id: str) -> None:
    """Called on every authenticated request; writes at most once per user per 5-minute window."""
    current_user_id.set(user_id)
    window = int(datetime.now(UTC).timestamp()) // WINDOW_S
    if _last_window.get(user_id) == window:
        return
    _last_window[user_id] = window
    _bump(user_id, {"windows": 1})


def ai_call(what: str, ok: bool) -> None:
    """One AI request made for the current user (fallback attempts across models count once)."""
    user_id = current_user_id.get()
    if user_id:
        _bump(user_id, {"ai_calls": 1, "ai_ok": 1 if ok else 0, f"ai_features.{what.replace('.', '_')}": 1})


def _bump(user_id: str, inc: dict[str, int]) -> None:
    try:
        task = asyncio.get_running_loop().create_task(_write(user_id, day_key(), inc))
    except RuntimeError:  # no event loop (a sync caller): skip rather than block
        return
    _pending.add(task)
    task.add_done_callback(_pending.discard)


async def _write(user_id: str, day: str, inc: dict[str, int]) -> None:
    try:
        await get_db().user_activity.update_one({"user_id": user_id, "day": day}, {"$inc": inc}, upsert=True)
    except Exception:  # noqa: BLE001 - usage stats must never break anything
        logger.debug("could not record activity", exc_info=True)


async def flush() -> None:
    """Wait for pending writes (tests, shutdown)."""
    while _pending:
        await asyncio.gather(*list(_pending), return_exceptions=True)
