# Woodchunk 2 — Rebuild Plan

> Status: **built** (2026-10-22). Design direction Tape (see `docs/DESIGN.md`). Implementation notes in `CLAUDE.md`.

## 1. Product in one sentence

Describe what you're building (in English or Hebrew, by typing or by chatting), and Woodchunk tells you exactly what to buy, from whom, for how much, and how to cut every board and sheet with the least waste.

### Principles ("really simple, but powerful")

1. **Three verbs per project: Design → Plan → Buy.** That is the whole mental model. Everything else is secondary.
2. **No save buttons.** Everything autosaves; there is undo/redo.
3. **The plan is always live.** Edit a part and the cut plan, cost and shopping list update within a second. No "Run planner" step.
4. **AI speeds things up but is never required.** Everything AI can do, you can also do by hand. Every AI result is a *proposal* you review and apply, never a silent change.
5. **Sensible defaults, advanced settings tucked away.** Saw kerf 3 mm, end trim, guillotine cuts, grain lock and the like sit in a collapsed "Cutting settings" panel.
6. **Works well on a phone where it counts.** The shopping list (in the store) and the shop sheet (at the saw) are designed for mobile first. Design is desktop first, but works on mobile too.
7. **One unit system internally.** Everything is stored in **mm**. Display and input follow user preference (mm/cm/m). Input is forgiving: `80`, `80cm`, `0.8m`, `2x 80cm`.

---

## 2. What changes from the old app

| Old (Streamlit) | New |
|---|---|
| Lumber pieces and the sheet planner are two separate worlds | **One parts list.** A part's material decides whether it is *linear* (lumber: length only) or *panel* (sheet: width × length). The Plan view handles both. |
| Parts reference the catalog **by row index** | Stable catalog item IDs. Catalog edits never corrupt projects. |
| "Cut list" = total metres × price/m | **Real 1D cutting-stock optimization** against the stock lengths actually sold, with prices, kerf and offcut reuse. |
| Sheet nesting: board size hardcoded to 120×240, pieces silently dropped, no kerf | Sheet sizes from the catalog, kerf, edge trim, grain lock, guillotine cut sequences, and an explicit "doesn't fit" warning. |
| Mixed mm / cm / m | mm everywhere internally |
| Local JSON files, single user | MongoDB, Descope auth, shared projects |
| Per-machine catalog file | **One shared catalog**, curated with AI scraping/organizing |
| Hardware not in cost; stats wrong | Full cost rollup (lumber + sheets + hardware), correct stats |
| No AI | AI project setup chat (EN/HE), AI catalog import, AI translation of exports |

The old Streamlit code has been deleted (branch `rebuild`; uncommitted legacy WIP saved in `git stash`). Its data is kept in `docs/legacy-data/`: the catalog seed and four old projects, which will be migration and template candidates.

---

## 3. Project concept (confirmed 2026-10-22)

A **project is one job**: one shopping trip and one cutting session. It usually holds several things being built. (Evidence: the legacy *Carpenter Table* project was SawHorse ×6 + Table + Window Net.)

```
Project: "Carpenter Table"          ← one job: one shopping trip, one cutting session
│  settings: kerf 3mm, max carry length 3m, …
├─ Assembly: SawHorse ×6            ← a thing being built, with a quantity
│   ├─ A1 Leg      100×44 pine   ×2   800 mm
│   ├─ A2 Beam     100×44 pine   ×2   560 mm
│   └─ hardware: 150mm screw ×10     → ×6 = 60 on the shopping list
├─ Assembly: Table ×1
│   ├─ B1 Top slat  50×22 pine   ×4   2440 mm
│   ├─ B3 Panel    18mm birch ply ×1   600×500   ← sheet part: width × length
│   └─ hardware: 50mm screw ×200
└─ Extras (project-level hardware/supplies): glue, sandpaper, chain 2m
        ▼ derived, never edited directly
   Plan (cut diagrams) · Shopping list · Shop sheet
```

Rules:
1. **One level only:** Project → Assemblies → Parts. No nested assemblies.
2. **Assembly quantity multiplies** both its parts and its hardware.
3. **A part points to a specific catalog product** (supplier-specific). The shopping list suggests "same spec is cheaper at X". Supplier choice is not automated.
4. **A part's cross-section or thickness comes from the material.** Lumber parts have a length only; sheet parts have width × length (length runs along the grain). Ripping lumber narrower is out of scope for v1.
5. **Auto labels** per assembly letter and part index (A1, A2, B1…), used on diagrams and the shop sheet.
6. **Hardware can belong to an assembly or to the project (Extras).** The shopping list merges identical items.
7. **Stock options are symmetric.** A lumber item has stock *lengths*; a sheet item has stock *sizes*. Each option has a price, and the optimizer picks the cheapest combination.
8. **Lifecycle: Planning → Bought → Cut → Done.**
   - *Bought:* checking off the shopping list snapshots purchased stock and prices. Edits after that re-plan against the purchased stock first and show only the *additional* stock to buy.
   - *Cut:* leftovers above the minimum-keep size go to the Workshop inventory.
   - *Done:* read-only, can be reopened.
9. **Workshop inventory = everything you own:** full boards and sheets as well as offcuts. With "use my stock" on, the optimizer consumes it first at cost 0.
10. **Catalog prices are live while Planning** and frozen at Bought.

## 4. Feature spec

### 4.1 Projects
- Home: a grid of project cards (name, status, thumbnail of the cut plan, total cost, last edited), plus a **New project** button with three paths:
  - **Describe it** (AI chat) — the default, highlighted path.
  - **From a template.**
  - **Blank.**
- Duplicate, archive (soft delete, restorable, like zizi), delete.
- **Sharing (cloned from zizi):** invite link with view/edit role and expiry. Members can see and edit the project.

### 4.2 Design (parts editor)
- Assemblies shown as cards, each with a name, a ×qty stepper, a parts table and a hardware list. Plus an **Extras** card.
- Spreadsheet-like editing: keyboard navigation, paste rows, tab-to-next. Material picker with search and recent materials. The part row shape adapts to the material (length only vs W × L + grain lock).
- Optional part fields: notes, grain lock (sheets).
- Live summary bar: total cost · boards/sheets to buy · waste % · part count (correctly multiplied).

### 4.3 Plan (optimizer output)
- **Lumber plan**, per material: which stock lengths to buy and how many, then one bar diagram per stock piece showing the cuts, labels, offcuts and kerf.
- **Sheet plan**, per sheet material: a diagram per sheet showing placed parts, labels, grain direction and offcuts, plus an optional numbered **cut sequence** (rip/crosscut order).
- Cost/waste comparison when there are alternatives, e.g. "3× 3.6 m (₪108, 4% waste) vs 4× 2.4 m (₪96, 11% waste)". The optimizer picks the cheapest; ties are broken by least waste.
- "Doesn't fit" alerts for parts larger than any available stock, with a suggestion ("split the part" / "choose another material").
- Cutting settings (a popover on the cutting plan panel; defaults live in Settings):
  - **Saw blade width (kerf), set separately for sheets and lumber.** Sheets are cut with a track/table saw, where kerf adds up across many rips. Lumber is cut with a miter/circular saw. Presets: thin 2.2, standard 3.0, full 3.2 mm.
  - End trim and sheet edge trim.
  - Guillotine only (default on), allow rotation.
  - Minimum offcut size worth keeping.
  - **Maximum stock length I can transport** (e.g. ≤ 3 m).

### 4.4 Buy (shopping list)
- Grouped **by supplier**, then by kind (lumber / sheets / hardware). Each line shows the quantity, stock size, unit price and line total.
- Check-off mode on mobile, with state synced across devices and project members.
- Share as text (WhatsApp-friendly), print, CSV/XLSX.
- Language toggle: EN / HE (see 4.8).

### 4.5 Shop sheet (printable)
- A print-optimized page: project summary, then for each board/sheet a cut diagram and a numbered cut list, part labels you can write onto the wood, and assembly membership.
- Generated with a print stylesheet; "Download PDF" uses the browser's print to PDF. Server-side PDF is a later option.
- Language toggle: EN / HE (RTL layout when HE).

### 4.6 Catalog (one, shared)
- Item kinds: **lumber** (thickness × width cross-section, species/treatment, stock lengths with a price per length or price/m), **sheet** (material, thickness, width × length, price per sheet), **hardware** (name, unit, price).
- Every item has a supplier, SKU/URL, image, category/tags, **name in EN + HE**, `price_updated_at`, and price history.
- Browse/search/filter UI (by kind, material, thickness, supplier), plus item details with a price history sparkline.
- **Permissions:** admins edit the catalog directly. Regular users can *suggest* items (manually or via AI import); suggestions go to a review queue.
- Migration: seed from the old `sample_catalog.json` (49 lumber items + boards).

### 4.7 AI features
All AI goes through one backend `AIService`, ported from zizi: Gemini with a model fallback chain, a time budget, and errors surfaced rather than swallowed. Every result is a proposal.

**Free-tier budget rule:** the free tier is about 20 requests/day *per model*; the fallback chain multiplies that. So every feature is designed as **one structured-output call per user action**. There is no multi-step tool loop. Instead, the backend pre-selects a compact catalog shortlist and puts it in the prompt. Scraping uses one call per page, and translation uses one batched call per export (cached). An AI usage counter is shown in admin.

**A. Project setup chat** (the zizi flow, upgraded to a conversation)
- Side panel in a project, or the "Describe it" entry point. Works in Hebrew or English. Replies come back in the user's language.
- Example: "Workbench 180×80, 90 high, 2×4 pine frame, 18 mm plywood top, a lower shelf."
- Each turn is one call. The input is the conversation, the current project and a catalog shortlist; the output is either a clarifying question or a structured proposal. It asks at most a few clarifying questions, then proposes assemblies, parts mapped to real catalog items, and hardware.
- The proposal shows as a diff (added/changed/removed parts) with a live cost preview. **Apply** or **Discard**. It can also handle follow-up edits: "make it 20 cm longer", "swap the top for birch".

**B. Catalog import & organize** (admin/suggester)
- Input: supplier URL(s), an uploaded price list (PDF/image/XLSX), or pasted text.
- The backend fetches the page (httpx, with a headless-browser fallback later), and an LLM extracts structured items. Each item is matched against the existing catalog by supplier + dimensions + material.
- **Review screen:** new / price changed / unchanged / possible duplicate. Bulk approve.
- "Organize" action: normalize names, assign categories/species, fill in missing EN/HE names, and flag duplicates. Each also goes through review.
- Optional later: scheduled price refresh per supplier.
- Respect robots.txt / site terms; store the source URL on each item.

**C. Translation**
- Catalog items carry EN/HE names (from B).
- User-written strings (part names, assembly names, notes) are translated by AI on demand when an export is switched to HE. Translations are cached per project and language, and invalidated when the source text changes.

**D. Spreadsheet import** (also AI-assisted)
- Paste or upload a cut list in CSV/XLSX. AI maps the columns and matches materials to the catalog, and the result goes to the same proposal/diff UI as A.

### 4.8 Language strategy
- **UI: English** for v1, but built i18n-ready from day one: every string goes through `next-intl`, and Tailwind *logical* properties (`ms-`/`me-`/`ps-`/`pe-`/`start`/`end`) are used everywhere. That makes a Hebrew UI later a translation file plus `dir="rtl"`, not a refactor.
- **Content: bilingual now.** Catalog names are EN/HE, the AI chat accepts either, and exports (shopping list, shop sheet, CSV) have an EN/HE toggle with proper RTL rendering.

### 4.9 Templates
- A curated gallery: sawhorse, workbench, bookshelf, raised garden bed, simple table, storage crate, …
- A template is a project plus template metadata. "Use template" duplicates it into a new project.
- The AI chat can adapt a template: "workbench template but 150 cm wide".
- Any user can save their project as a private template. Admins publish public ones.
- Later: parametric templates (dimensions as variables, part lengths as formulas).

### 4.10 Workshop (stock inventory)
- A per-user inventory of everything you own: **full boards/sheets and offcuts**. Each entry has a material, length (or W × L), quantity, source project, and status (available/reserved/used).
- Marking a project **Cut** adds its leftovers above the minimum-keep size automatically (and they can be edited).
- With "use my stock" on (the default), the optimizer consumes inventory first at cost 0. The plan shows which owned piece each part comes from, and those pieces are reserved for the project.
- Manual add/remove, e.g. "I have 3× 2.4 m 100×44 in the shed".

### 4.11 Admin
- Users, projects, AI usage/cost, catalog review queue, restoring archived projects. (Extends zizi's admin page.)

---

## 5. Architecture

```
woodchunk/
├── frontend/          Next.js (App Router) · React 19 · TS · Tailwind v4
├── backend/           FastAPI · Pydantic v2 · PyMongo async
│   └── app/
│       ├── routers/   projects, catalog, plans, ai, templates, workshop, invite, admin
│       ├── services/  ai/, optimizer/ (linear.py, sheet.py), scraping/, translation/
│       ├── models/
│       └── auth.py    (cloned from zizi)
├── tests/e2e/         Playwright (cloned zizi setup)
├── docs/
└── docker-compose*.yml, Makefile, railway config
```

### 5.1 Stack: cloned from zizi, with updates

| Area | zizi today | Woodchunk 2 | Why |
|---|---|---|---|
| Frontend framework | Next 14, pages router | **Current Next.js, App Router**, React 19 | Server components, layouts, future-proof |
| Styling | Tailwind 3 | **Tailwind v4** + Radix primitives (shadcn-style owned components) | Accessible, themeable, modern |
| Data fetching | axios + custom hooks | **TanStack Query** + typed fetch client **generated from FastAPI's OpenAPI** | Caching, optimistic autosave, no hand-written types |
| i18n | Hardcoded RTL Hebrew | **next-intl**, logical CSS | EN now, HE-ready |
| PWA | @ducanh2912/next-pwa | **Serwist** | Maintained successor |
| Auth | Descope | Descope (same flow, OTP) | Proven, already in use |
| Backend | FastAPI + Pydantic 2 | same, Python 3.13, **uv**, **ruff** | Faster tooling |
| Mongo driver | Motor | **PyMongo async API** | Motor is deprecated in favor of PyMongo's native async |
| AI | LangChain + Gemini chain | **Gemini free tier with zizi's fallback chain** behind a thin provider interface (Claude/OpenRouter can be added later) | Free; reuses proven zizi code |
| Optimizer | rectpack | **OR-Tools (CP-SAT)** for linear + custom guillotine packer for sheets | Truly optimal/near-optimal, cut sequences |
| Diagrams | Plotly | **Hand-rendered SVG** components | Crisp, themeable, printable, interactive |
| Deploy | Railway (3 services) | same | Already set up |
| Tests | Playwright E2E | Playwright E2E + **pytest** for optimizers (property-based with Hypothesis) + Vitest for frontend utils | Optimizer correctness is critical |

### 5.2 Data model (MongoDB)

```
users            { _id (descope id), email, name, prefs: { units, export_lang, cutting_defaults } , role }
suppliers        { _id, name, url, currency, logo, scrape_hints }
catalog_items    { _id, kind: lumber|sheet|hardware, supplier_id, sku, url, image,
                   name: { en, he }, category, tags[], material, species, treatment,
                   # lumber
                   thickness_mm, width_mm, stock: [{ length_mm, price }]   # price may derive from price_per_m
                   # sheet
                   thickness_mm, grain: bool, stock: [{ width_mm, length_mm, price }],
                   # hardware
                   unit, price,
                   price_updated_at, price_history: [{ date, price }], status: active|suggested|retired }
catalog_imports  { _id, created_by, source: { type, url|file }, status, proposals: [...], created_at }
projects         { _id, owner_id, members: [{ user_id, role }], name, description,
                   status: planning|bought|cut|done, archived: bool,
                   settings: { kerf_lumber_mm, kerf_sheet_mm, end_trim_mm, edge_trim_mm, guillotine, allow_rotation,
                               min_offcut_mm, max_stock_length_mm, use_inventory },
                   assemblies: [{ id, letter, name, qty,
                                  parts: [{ id, name, item_id, qty, length_mm, width_mm?, grain_locked, notes }],
                                  hardware: [{ id, item_id?, name, qty, unit_price? }] }],
                   extras: [{ id, item_id?, name, qty, unit_price? }],          # project-level hardware/supplies
                   purchase: { at, lines: [{ item_id, stock_option, qty, unit_price }] }?,  # snapshot at Bought
                   shopping_checked: { line_key: bool }, template_meta?, updated_at, version }
plans            { _id, project_id, input_hash, linear: [...], sheets: [...], unplaced: [...],
                   totals: { cost, waste_pct, stock_count }, computed_at }       # cache, keyed by hash
inventory        { _id, owner_id, item_id, kind: full|offcut, length_mm, width_mm?, qty,
                   source_project_id?, status: available|reserved|used }   # Workshop
translations     { _id, project_id, lang, source_hash, strings: { key: text } }
ai_conversations { _id, project_id, user_id, messages[], proposals[] }
invite_tokens    (as zizi)
```

Projects embed assemblies and parts (one document, atomic autosave with an optimistic `version`). The catalog is referenced by `item_id`. A project that references a retired item still renders, with a warning.

### 5.3 Optimizer design

**Linear (1D cutting stock, multiple stock lengths)**
- Inputs: parts (length, qty), the stock options for that material (length, price; offcuts count as price 0), kerf, end trim, and the maximum transportable length.
- Method: generate patterns by column generation, then solve the integer program with CP-SAT within a time limit (~2 s). Objective: minimize cost, then waste, then number of distinct stock lengths. Tie-break: concentrate leftover into **one usable offcut** rather than many slivers.
- Fallback: first-fit-decreasing plus local improvement, if the solver hits the time limit or the problem is huge.
- Output: per stock piece, an ordered cut list with positions, the remaining offcut, and waste.

**Sheet (2D, guillotine by default)**
- Inputs: panels (w, l, qty, grain-locked), the sheet options (size, price, grain direction; offcut rectangles), kerf, edge trim.
- Method: guillotine packer with several heuristics (best-area-fit, best-short-side, several sort orders) plus randomized restarts within the time budget. Keep the best by cost, then the largest remaining rectangle. A non-guillotine mode (MaxRects) is available as an option.
- Output: placements and a **cut tree**, which becomes the numbered rip/crosscut sequence. Unplaced parts are always reported, never dropped.

**Correctness tests (property-based):** no overlaps, everything within the sheet minus trim, kerf respected, every part placed exactly once or reported as unplaced, totals consistent, deterministic for the same input.

**Performance:** a plan is computed on the backend and cached by input hash. The frontend debounces edits by 600 ms and shows the previous plan dimmed while the new one computes.

### 5.4 API sketch

```
/projects                CRUD, duplicate, archive, share
/projects/{id}/plan      GET (cached or compute)
/projects/{id}/shopping  GET grouped list (lang param)  · PATCH checked state
/projects/{id}/export    shop-sheet / csv / xlsx (lang param)
/projects/{id}/status    → bought (snapshot purchase) · cut (offcuts → inventory) · done
/catalog                 search/filter · CRUD (admin) · suggest
/catalog/imports         POST (url | file | text) → proposals · POST approve
/catalog/organize        POST → proposals
/ai/project-chat         POST (streaming) → messages + proposal
/ai/proposals/{id}/apply
/ai/import-spreadsheet   POST → proposal
/templates               list · use · publish
/workshop/inventory      CRUD
/invite, /admin          (as zizi)
```

---

## 6. Screens

1. **Home**: project cards, New project (Describe / Template / Blank), recent activity.
2. **Project workspace**: header (name, live totals), tabs **Build · Buy · Shop sheet** (Build = parts with the live cutting plan beside them; Design and Plan were merged after the first build), and an AI chat panel that can be toggled (right side; a sheet on mobile).
3. **Catalog**: search + filters, item drawer, **Import** wizard, **Review queue** (admin).
4. **Templates** gallery.
5. **Workshop** (offcuts).
6. **Settings**: units, export language, cutting defaults.
7. **Admin**.
8. **Join** (invite) and **Sign-in**.

---

## 7. Milestones

| # | Milestone | Done when |
|---|---|---|
| **M0** | **Design mock + design guide** | Theme chosen from 2–3 directions; palette, typography, spacing and core components documented in `docs/DESIGN.md`; mocks of Project/Plan screens approved |
| M1 | Scaffold (clone zizi, upgraded) | Monorepo, Docker dev env, Descope sign-in, Mongo, OpenAPI client generation, CI (lint/test), Railway skeleton deploy |
| M2 | Catalog core | Item model, browse/search/filter UI, admin CRUD, seed from old catalog |
| M3 | Projects + Design editor | Projects CRUD, assemblies/parts/hardware editor, unit parsing, autosave + undo, live totals |
| M4 | Optimizers + Plan view | Linear + sheet optimizers with property tests; SVG diagrams; cutting settings; unplaced warnings |
| M5 | Buy + Shop sheet + exports | Supplier-grouped shopping list with check-off; printable shop sheet; CSV/XLSX |
| M6 | AI project chat | EN/HE chat → proposals → diff → apply; follow-up edits |
| M7 | AI catalog import/organize | URL/file/text import, review queue, organize, price history |
| M8 | Translation + i18n plumbing | HE exports (RTL), translation cache, next-intl everywhere |
| M9 | Templates, spreadsheet import, Workshop | Template gallery, AI spreadsheet import, offcut inventory feeding the optimizer |
| M10 | Sharing, PWA, polish, E2E, prod deploy | Invites, installable PWA, Playwright suite, production on Railway; README and docs |

M2–M5 give a fully usable app without AI. M6–M9 add the AI features and remaining ideas.

---

## 8. Decisions

- **Repo/name:** keep `idoglanz/woodchunk` and the name Woodchunk. Old code deleted.
- **AI:** Gemini free tier (zizi chain) to start.
- **Catalog permissions:** admins edit; users suggest via the review queue (default, not yet confirmed).
- **Currency/region:** ₪ and Israeli suppliers first; currency stored per supplier (default, not yet confirmed).
- **Design:** direction *Tape*, refined to be calmer and more Apple-like (system font, one yellow accent, hairlines), with full light and dark themes. See `docs/DESIGN.md`.
- **Saw width:** separate kerf settings for sheets and lumber, per project, with defaults in user settings.
- **Project concept:** confirmed (section 3). The term is **Assemblies**; parts point to specific products; one nesting level.
