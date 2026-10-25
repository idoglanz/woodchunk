"""A small per-user limit on AI calls, so one account can't drain the shared free-tier quota.

In memory, per process: fine for one API instance; it resets on restart.
"""

import time
from collections import defaultdict, deque

from fastapi import HTTPException, status

from app.models.user import User

WINDOW_S = 600
LIMIT = 30  # AI calls per user per window (admins are not limited)

_calls: dict[str, deque[float]] = defaultdict(deque)


def check_ai_quota(user: User) -> None:
    if user.is_admin:
        return
    now = time.monotonic()
    q = _calls[user.id]
    while q and now - q[0] > WINDOW_S:
        q.popleft()
    if len(q) >= LIMIT:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "That's a lot of AI requests in a short time. Try again in a few minutes.")
    q.append(now)
