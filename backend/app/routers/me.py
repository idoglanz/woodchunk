from fastapi import APIRouter, Depends

from app.auth import current_user
from app.db import get_db
from app.models.user import PrefsUpdate, User

router = APIRouter(prefix="/api", tags=["me"])


@router.get("/me", response_model=User)
async def me(user: User = Depends(current_user)):
    return user


@router.put("/me", response_model=User)
async def update_me(body: PrefsUpdate, user: User = Depends(current_user)):
    changes = {"prefs": body.prefs.model_dump(mode="python")}
    if body.name is not None:
        changes["name"] = body.name.strip()
    d = await get_db().users.find_one_and_update({"_id": user.id}, {"$set": changes}, return_document=True)
    return User.from_mongo(d)
