from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import Field

from app.models.common import Doc, Model, now
from app.models.project import CuttingSettings


class UserRole(StrEnum):
    user = "user"
    admin = "admin"


class Prefs(Model):
    units: Literal["mm", "cm"] = "mm"
    export_lang: Literal["en", "he"] = "en"
    theme: Literal["system", "light", "dark"] = "system"
    cutting: CuttingSettings = CuttingSettings()


class User(Doc):
    email: str
    name: str = ""
    role: UserRole = UserRole.user
    prefs: Prefs = Prefs()
    created_at: datetime = Field(default_factory=now)
    last_seen: datetime = Field(default_factory=now)

    @property
    def is_admin(self) -> bool:
        return self.role == UserRole.admin


class PrefsUpdate(Model):
    name: str | None = None
    prefs: Prefs
