"""Gemini client with a model fallback chain (ported from zizi-tripo).

Gemini's free tier is quota'd per model per day, so when one model is out of budget
(or overloaded, or slow) the next one in the chain is tried. Only quota/capacity/timeout
failures advance the chain; anything else (a bad request, a safety block) fails at once,
because retrying elsewhere would just burn another model's budget for the same result.

Every call is a single structured-output request validated against a Pydantic model.
Errors are raised, never replaced by placeholder content.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import UTC, datetime
from typing import TypeVar

from google import genai
from google.genai import types
from pydantic import BaseModel

from app.config import get_settings
from app.db import get_db
from app.services import activity

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

_ADVANCE_MARKERS = (
    "resource_exhausted", "resourceexhausted", "quota", "rate limit", "ratelimit", "429",
    "too many requests", "503", "unavailable", "overloaded", "504", "deadline", "timeout",
    "timed out", "404", "not found", "is not supported",
)


class AIServiceError(RuntimeError):
    """An AI call failed; callers surface the message to the user."""


class AINotConfigured(AIServiceError):
    pass


def _should_advance(exc: Exception) -> bool:
    text = f"{type(exc).__name__} {exc}".lower()
    return any(m in text for m in _ADVANCE_MARKERS)


class AIClient:
    def __init__(self) -> None:
        s = get_settings()
        self.chain = s.model_chain
        self.timeout = s.ai_model_timeout_seconds
        self.budget = s.ai_total_budget_seconds
        self._client = genai.Client(api_key=s.google_api_key) if s.google_api_key else None

    @property
    def enabled(self) -> bool:
        return self._client is not None

    async def generate(
        self,
        schema: type[T],
        system: str,
        contents: str | list,
        *,
        what: str,
        temperature: float = 0.2,
    ) -> tuple[T, str]:
        if self._client is None:
            raise AINotConfigured("AI is not set up on this server (GOOGLE_API_KEY is missing).")
        ok = False
        try:
            out = await self._generate(schema, system, contents, what=what, temperature=temperature)
            ok = True
            return out
        finally:
            activity.ai_call(what, ok)

    async def _generate(
        self, schema: type[T], system: str, contents: str | list, *, what: str, temperature: float
    ) -> tuple[T, str]:
        assert self._client is not None
        attempts: list[str] = []
        started = time.monotonic()
        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            response_mime_type="application/json",
            response_schema=schema,
        )
        for index, model in enumerate(self.chain):
            remaining = self.budget - (time.monotonic() - started)
            if remaining <= 1.0 and index > 0:
                break
            try:
                resp = await asyncio.wait_for(
                    self._client.aio.models.generate_content(model=model, contents=contents, config=config),
                    timeout=min(self.timeout, max(remaining, 1.0)),
                )
                parsed = resp.parsed
                if parsed is None:
                    if not resp.text:
                        raise AIServiceError(f"{what}: the model returned an empty answer")
                    parsed = schema.model_validate_json(resp.text)
                elif not isinstance(parsed, schema):
                    parsed = schema.model_validate(parsed)
                await _record_usage(model, what, ok=True)
                if index > 0:
                    logger.warning("%s served by fallback model %s", what, model)
                return parsed, model
            except TimeoutError:
                attempts.append(f"{model}: timeout")
                await _record_usage(model, what, ok=False)
                continue
            except AIServiceError:
                raise
            except Exception as e:  # noqa: BLE001 - provider errors vary by SDK version
                await _record_usage(model, what, ok=False)
                if not _should_advance(e):
                    logger.exception("%s failed on %s", what, model)
                    raise AIServiceError(f"{what} failed: {e}") from e
                attempts.append(f"{model}: {type(e).__name__}")
                logger.warning("%s: %s unavailable (%s), trying next model", what, model, type(e).__name__)
        raise AIServiceError(
            f"{what} failed: every AI model is out of quota or unavailable right now. Try again later. "
            f"({'; '.join(attempts)})"
        )


async def _record_usage(model: str, what: str, ok: bool) -> None:
    try:
        day = datetime.now(UTC).strftime("%Y-%m-%d")
        await get_db().ai_usage.update_one(
            {"day": day, "model": model},
            {"$inc": {"calls": 1, "ok": 1 if ok else 0, f"by.{what.replace('.', '_')}": 1}},
            upsert=True,
        )
    except Exception:  # noqa: BLE001 - usage stats must never break a request
        logger.debug("could not record AI usage", exc_info=True)


_instance: AIClient | None = None


def get_ai() -> AIClient:
    global _instance
    if _instance is None:
        _instance = AIClient()
    return _instance


def set_ai(client) -> None:
    """Tests swap in a fake client."""
    global _instance
    _instance = client
