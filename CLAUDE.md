# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**DungeonBuilder** — a procedural dungeon map generator with a FastAPI backend and Vite/TypeScript frontend. Generates seeded dungeon layouts with rooms, corridors, doors, and optional AI-generated narrative content via Groq or Ollama.

## Development Commands

### Backend (FastAPI)
```bash
cd backend
source .venv/Scripts/activate        # Windows
# source .venv/bin/activate           # Linux/macOS
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8088 --reload
```

### Frontend (Vite + TypeScript)
```bash
cd frontend
npm install
npm run dev          # http://localhost:5174
npm run build        # Production build
npm run preview      # Preview production build
```

### Docker (full stack)
```bash
docker compose up -d --build
curl http://127.0.0.1/health
docker compose logs -f backend     # View backend logs
docker compose logs -f frontend    # View nginx/frontend logs
```

### Environment
Copy `.env.example` to `.env` and set:
- `GROQ_API_KEY` — for cloud LLM narrative generation
- `GROQ_MODEL` — defaults to `llama-3.3-70b-versatile`
- `OLLAMA_BASE_URL` / `OLLAMA_MODEL` — for local LLM (e.g. `gemma4:12b`)
- `BACKEND_CORS_ORIGINS` — comma-separated allowed origins

## Architecture

### Backend (`backend/app/`)

**Entry:** `main.py` → mounts `api/dungeon.py` router under `/api/dungeon`

**Two endpoints:**
- `POST /api/dungeon/generate` — runs the procedural pipeline, returns dungeon JSON
- `POST /api/dungeon/narrate` — builds context, calls LLM, returns narrative JSON

**Procedural generation pipeline** (`generator/`):
1. `pipeline.py` — `generate_dungeon()` orchestrates the full flow
2. `rooms.py` — frontier-based BFS room spawning (`try_spawn_child()`)
3. `corridors.py` — corridor routing with collision avoidance and loop-closing
4. `locks.py` — `build_doors()` — door mechanics (locked/sealed with key placement)
5. `openings.py` — entrance/exit placement on the dungeon boundary
6. `entities.py` — data classes: `RoomNode`, `Corridor`, `Door`, `Opening`, `CorridorSeg`
7. `rng.py` — `make_rng()` seeded RNG; all generation uses this for reproducibility

**Narrative system** (`narrative/`):
- `context.py` — builds a compact JSON context graph of the dungeon
- `llm.py` — `generate_narrative()` dispatches to Groq API or Ollama; validates/coerces the JSON response; falls back to plain text if strict JSON fails

**Models** (`models.py`) — Pydantic models for all request/response shapes; TypeScript types in `frontend/src/types.ts` must mirror these.

### Frontend (`frontend/src/`)

**Entry:** `main.ts` — manages UI state, wires controls, calls `api.ts`, triggers render pipeline

**Render pipeline** (`render/`):
- `index.ts` — main render entry; orchestrates all sub-renderers
- `floors.ts` — draws rooms and corridors as SVG shapes
- `doors.ts` — places door icons/markers
- `narrative-labels.ts` — places room labels on the SVG canvas (falls back to side panel if text overflows)
- `narrative-content.ts` — renders loot/enemies/NPCs/traps in side panel

**Other modules:**
- `api.ts` — `generateDungeon()` / `narrateDungeon()` HTTP helpers
- `types.ts` — TypeScript interfaces (must stay in sync with backend Pydantic models)
- `pan-zoom.ts` — SVG pan/zoom via mouse drag and wheel
- `map-overlay.ts` — terrain effects overlay rendering

**Dev proxy:** `vite.config.ts` proxies `/api/*` to `http://localhost:8088` in dev mode, so no CORS issues locally.

### Key Design Decisions

- **Seeded RNG everywhere** — all `random` calls go through `make_rng(seed)` so the same seed always produces the same dungeon.
- **Symmetry break** — a 0–80% parameter controls how much the BFS branches vs. stays linear.
- **Lazy narrative labels** — frontend measures text fit in SVG; overflowing labels go to the side panel automatically.
- **LLM JSON coercion** — `llm.py` tries strict JSON parse, then regex extraction, then plain-text fallback so broken LLM outputs degrade gracefully.
- **TypeScript ↔ Pydantic sync** — `types.ts` and `models.py` must be kept in sync manually; no codegen is in place.

## API Contract (quick reference)

`POST /api/dungeon/generate` and `/api/dungeon/narrate` share the same request body:
```json
{
  "seed": "string (optional)",
  "size": "small|medium|large",
  "symmetryBreak": 30,
  "rectPct": 60,
  "circlePct": 20,
  "octagonPct": 20,
  "accentPct": 15,
  "closedDoorPct": 45,
  "llmProvider": "local|api"
}
```

Room content item types: `loot | enemy | trap | npc | hazard`  
Enemy types: `melee | ranged | mage`  
Enemy difficulty: `normal | elite | boss`
