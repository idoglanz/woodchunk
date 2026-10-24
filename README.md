# Woodchunk

Describe what you're building and Woodchunk tells you exactly what to buy, from whom, for how much, and how to cut every board and sheet with the least waste.

- **Design**: projects hold assemblies (a table, two sawhorses ×2…) made of parts cut from catalog materials, plus hardware.
- **Plan**: optimal lumber cutting (CP-SAT, proven cheapest when it says *Optimal*), guillotine sheet layouts with a numbered cut order, saw-width (kerf) settings for sheets and lumber, carry limit, trims, grain lock, and reuse of your workshop offcuts.
- **Buy**: a shopping list grouped by supplier that you tick off on your phone, in English or Hebrew, plus CSV and copy-as-text.
- **Shop sheet**: a printable cut list and diagrams (English or Hebrew, RTL).
- **AI (Gemini)**: describe a build or a change in English or Hebrew and apply the suggested edits; import supplier price lists from a URL, PDF, photo, CSV/XLSX or pasted text; tidy the catalog; translate exports.
- **Also**: one shared catalog with price history and a review queue, templates, a workshop inventory, sharing by invite link, light and dark themes.

Design guide: [`docs/DESIGN.md`](docs/DESIGN.md) · Product plan: [`docs/REBUILD_PLAN.md`](docs/REBUILD_PLAN.md)

## Stack

| | |
|---|---|
| Frontend | Next.js 16 (App Router, client-rendered), React 19, Tailwind 4, TanStack Query, Radix primitives, types generated from the API's OpenAPI schema |
| Backend | FastAPI, Pydantic 2, PyMongo async, OR-Tools (CP-SAT), google-genai |
| Data | MongoDB |
| Auth | Descope (production) or a local dev sign-in |
| AI | Gemini free tier with a model fallback chain (one model call per user action) |

## Run it locally

Prerequisites: Docker, [uv](https://docs.astral.sh/uv/), Node 22.

```bash
make install
make mongo                      # MongoDB on :27018
cp backend/.env.example backend/.env   # add GOOGLE_API_KEY for AI features
cp frontend/.env.example frontend/.env.local
make api                        # http://localhost:8000/docs
make web                        # http://localhost:3000
```

With `AUTH_MODE=dev` any email signs you in. On first start the API seeds the original Woodchunk catalog (49 lumber items, sheets, hardware) and six public templates. Emails in `ADMIN_EMAILS` become admins and, in dev, get the original projects.

## Tests

```bash
make test   # optimizer property tests (vs. brute force) + API flows on a real Mongo
make e2e    # Playwright smoke test, desktop and phone (needs api + web running)
make lint
```

After changing backend models, run `make types` to regenerate the frontend API types.

## Deploy (Railway)

Three services, as in zizi-tripo:

1. **MongoDB**: add Railway's MongoDB service.
2. **backend** (root `backend/`, Dockerfile): set `MONGODB_URI`, `ENVIRONMENT=production`, `AUTH_MODE=descope`, `DESCOPE_PROJECT_ID`, `ADMIN_EMAILS`, `FRONTEND_URL`, `GOOGLE_API_KEY`.
3. **frontend** (root `frontend/`, Dockerfile): build args `NEXT_PUBLIC_API_URL` (the backend URL) and `NEXT_PUBLIC_DESCOPE_PROJECT_ID`.

Each service's settings live in `backend/railway.json` and `frontend/railway.json` (Dockerfile build, health check, restart on failure). Railway reads that path from the repo root, so set each service's config file to `/backend/railway.json` or `/frontend/railway.json`. The API refuses to start with `ENVIRONMENT=production` unless `AUTH_MODE=descope` is set, so dev sign-in can't reach a public server. Add the frontend's domain to the Descope project's approved domains.

For Descope, use a `sign-up-or-in` flow and add `email` to the session token claims. To copy the original projects to your real account after your first sign-in, run `uv run python -m scripts.import_legacy you@example.com` against the production database.
