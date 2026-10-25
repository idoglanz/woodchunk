SHELL := /bin/bash

# Local development (Mongo in Docker, API and web app on your machine)
mongo:            ## Start MongoDB on :27018
	docker start woodchunk-mongo 2>/dev/null || docker run -d --name woodchunk-mongo -p 27018:27017 -v woodchunk_mongo:/data/db mongo:8

api:              ## Run the API with reload on :8000
	cd backend && uv run uvicorn app.main:app --reload --port 8000

web:              ## Run the web app on :3000
	cd frontend && npm run dev

install:          ## Install backend and frontend dependencies
	cd backend && uv sync
	cd frontend && npm install

test:             ## Backend tests (needs Mongo running) and frontend unit tests
	cd backend && uv run pytest -q
	cd frontend && npm test

lint:             ## Lint and type-check everything
	cd backend && uv run ruff check app tests
	cd frontend && npx tsc --noEmit && npx eslint src

types:            ## Regenerate frontend API types from the backend schema
	cd backend && uv run python -m scripts.export_openapi ../frontend/openapi.json
	cd frontend && npx openapi-typescript openapi.json -o src/lib/api/schema.d.ts

e2e:              ## Browser smoke test (needs api + web running)
	cd frontend && npx playwright test

up:               ## Whole stack in Docker
	docker compose up --build

.PHONY: mongo api web install test lint types e2e up
