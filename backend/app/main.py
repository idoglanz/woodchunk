import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import db
from app.config import get_settings
from app.routers import admin, ai, catalog, inventory, me, projects
from app.seed import seed_if_empty

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    database = await db.connect()
    await seed_if_empty(database)
    yield
    await db.close()


app = FastAPI(
    title="Woodchunk API",
    description="Projects, catalog, cut optimization and AI assistance for woodworking builds.",
    version="2.0.0",
    lifespan=lifespan,
)

s = get_settings()
origins = {"http://localhost:3000", "http://127.0.0.1:3000", s.frontend_url, s.frontend_url.replace("http://", "https://")}
app.add_middleware(CORSMiddleware, allow_origins=sorted(origins), allow_credentials=True, allow_methods=["*"],
                   allow_headers=["*"], expose_headers=["Content-Disposition"])

for r in (me.router, catalog.router, projects.router, inventory.router, ai.router, admin.router):
    app.include_router(r)


@app.get("/health", tags=["meta"])
async def health():
    return {"ok": True}
