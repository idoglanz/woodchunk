from datetime import UTC, datetime
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


def new_id() -> str:
    return uuid4().hex


def now() -> datetime:
    return datetime.now(UTC)


class Model(BaseModel):
    """Base for API models: fields with defaults are still required in *response* schemas,
    so generated client types don't mark always-present fields (like `id`) optional."""

    # No NaN/Infinity anywhere: they'd be stored, then break plans, exports and the editor.
    model_config = ConfigDict(json_schema_serialization_defaults_required=True, allow_inf_nan=False)


class Doc(Model):
    """Base for documents stored in Mongo with a string `_id` (exposed as `id` in the API)."""

    model_config = ConfigDict(populate_by_name=True, json_schema_serialization_defaults_required=True, allow_inf_nan=False)

    id: str = Field(default_factory=new_id)

    def to_mongo(self) -> dict:
        data = self.model_dump(mode="python")
        data["_id"] = data.pop("id")
        return data

    @classmethod
    def from_mongo(cls, data: dict | None):
        if data is None:
            return None
        data = dict(data)
        if "_id" in data:
            data["id"] = data.pop("_id")
        return cls.model_validate(data)


class Localized(Model):
    en: str = ""
    he: str = ""

    def get(self, lang: str) -> str:
        if lang == "he" and self.he:
            return self.he
        return self.en or self.he
