"""Authentication: Descope sessions in production, `dev:<email>` tokens locally."""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import timedelta

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import get_settings
from app.db import get_db
from app.models.common import now
from app.models.user import User, UserRole
from app.services import activity

logger = logging.getLogger(__name__)
bearer = HTTPBearer(auto_error=False)

_descope = None
_token_cache: dict[str, tuple[float, dict]] = {}
_TOKEN_TTL = 60.0


def _descope_client():
    global _descope
    if _descope is None:
        from descope import DescopeClient

        s = get_settings()
        if not s.descope_project_id:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Sign-in is not configured on this server.")
        _descope = DescopeClient(project_id=s.descope_project_id, jwt_validation_leeway=30)
    return _descope


async def _claims(token: str) -> dict:
    s = get_settings()
    if s.auth_mode == "dev":
        if not token.startswith("dev:") or "@" not in token:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in again.")
        email = token[4:].strip().lower()
        return {"sub": f"dev-{email}", "email": email, "name": email.split("@")[0].replace(".", " ").title()}
    hit = _token_cache.get(token)
    if hit and time.monotonic() - hit[0] < _TOKEN_TTL:
        return hit[1]
    try:
        info = await asyncio.to_thread(_descope_client().validate_session, token)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 - descope raises AuthException and friends
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session expired. Sign in again.") from e
    email = (info.get("email") or "").lower()
    if not email:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your sign-in token has no email. Sign out and in again.")
    claims = {"sub": info.get("sub") or info.get("userId") or email, "email": email, "name": info.get("name", "")}
    _token_cache[token] = (time.monotonic(), claims)
    if len(_token_cache) > 5000:
        _token_cache.clear()
    return claims


async def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue.")
    c = await _claims(creds.credentials)
    db = get_db()
    admin = c["email"] in get_settings().admin_email_set
    doc = await db.users.find_one({"email": c["email"]})
    if doc is None:
        # A new user's first page load sends several requests at once: create atomically, then read.
        fresh = User(id=c["sub"], email=c["email"], name=c["name"], role=UserRole.admin if admin else UserRole.user)
        await db.users.update_one({"_id": fresh.id}, {"$setOnInsert": fresh.to_mongo()}, upsert=True)
        doc = await db.users.find_one({"_id": fresh.id})
        assert doc is not None
    user = User.from_mongo(doc)
    updates = {}
    if admin and user.role != UserRole.admin:
        updates["role"] = UserRole.admin
        user.role = UserRole.admin
    if not user.name and c["name"]:
        updates["name"] = c["name"]
        user.name = c["name"]
    if now() - user.last_seen > timedelta(minutes=5):
        updates["last_seen"] = now()
    if updates:
        await db.users.update_one({"_id": user.id}, {"$set": updates})
    activity.seen(user.id)
    return user


async def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can do that.")
    return user
