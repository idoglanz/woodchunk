"""Copy the original Woodchunk projects into a user's account.

    uv run python -m scripts.import_legacy you@example.com
"""

import asyncio
import sys

from app import db
from app.seed import import_legacy_for


async def main(email: str) -> None:
    database = await db.connect()
    n = await import_legacy_for(database, email)
    print(f"Imported {n} projects for {email}")
    await db.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
