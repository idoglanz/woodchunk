import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import db
from app.config import get_settings
from app.routers import admin, ai, catalog, inventory, me, projects
from app.seed import seed_if_empty, seed_steel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    database = await db.connect()
    await seed_if_empty(database)
    await seed_steel(database)
    yield
    await db.close()


app = FastAPI(
    title="Woodchunk API",
    description="Projects, catalog, cut optimization and AI assistance for woodworking builds.",
    version="2.0.0",
    lifespan=lifespan,
)

s = get_settings()
origins = {"http://localhost:3000", "http://127.0.0.1:3000"} | s.frontend_origins
app.add_middleware(CORSMiddleware, allow_origins=sorted(origins), allow_credentials=True, allow_methods=["*"],
                   allow_headers=["*"], expose_headers=["Content-Disposition"])

@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    # Don't echo the rejected input back: it may not even be valid JSON (Infinity, NaN).
    detail = [{"loc": list(e.get("loc", ())), "msg": e.get("msg", ""), "type": e.get("type", "")} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": detail})


for r in (me.router, catalog.router, projects.router, inventory.router, ai.router, admin.router):
    app.include_router(r)


@app.get("/health", tags=["meta"])
async def health():
    return {"ok": True}
