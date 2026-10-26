# Woodchunk: notes for Claude

Woodworking planner: projects → assemblies (×qty) → parts cut from catalog materials; the backend optimizes cutting and builds shopping lists. Product decisions: `docs/REBUILD_PLAN.md` (section 3 is the project concept). UI rules: `docs/DESIGN.md`. Follow both.

## Layout
- `backend/app/services/optimizer/`: `linear.py` (CP-SAT 1D cutting stock) and `sheet.py` (guillotine packer + `replay_cuts` validator). Pure and synchronous; change them only with tests in `backend/tests/test_linear.py` / `test_sheet.py`.
- `backend/app/catalog_sync.py`: applies the catalog sources at startup, once per version: Noyman's lumber and sheets (`seed_data/noyman.json`, refreshed with `make noyman`) and the steel sizes. Items keep their ids; ones a source drops are retired, not deleted.
- `backend/app/services/planner.py`: project + catalog + inventory → `PlanOut`, cached by input hash. `shopping.py` builds lists and purchase snapshots.
- `backend/app/services/ai/`: Gemini client with a fallback chain (`client.py`), project chat/spreadsheet import (`project_chat.py`), catalog import/organize/translate (`catalog_ai.py`). AI output is always a *proposal* (`services/proposals.py`) validated against the real catalog and applied only on user action.
- `backend/app/routers/`: REST API under `/api`. `deps.py` has access checks (`load_project(..., need)`).
- `frontend/src/lib/`: API client (`api/client.ts`, generated `schema.d.ts`), query hooks (`queries.ts`), project editor store with autosave/undo (`editor.ts`).
- `frontend/src/components/project/`: workspace, design/plan/buy/shop-sheet views, AI panel. `components/ui/`: primitives; reuse them.

## Rules
- Lengths are millimetres everywhere in data; convert only for display (`lib/units.ts`).
- Free-tier AI budget: one model call per user action, no tool loops. Never swallow AI errors into fake content.
- Colors only through CSS tokens in `globals.css`; logical CSS properties (`ms-`, `pe-`, `start`) so RTL keeps working.
- After changing backend models: `make types`. Response models extend `app.models.common.Model` so fields with defaults are required in response schemas.
- Next.js 16 here differs from older versions: read `frontend/node_modules/next/dist/docs/` before using new APIs. `cacheComponents` is off on purpose (client-rendered SPA).
- Before finishing: `make test`, `make lint`, and `make e2e` with the servers running.
- Git: work on feature branches; never push to main/master/staging.
