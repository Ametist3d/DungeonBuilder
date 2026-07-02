# Dungeon generator

Procedural dungeon generator, split into a Python backend (generation logic)
and a TypeScript frontend (rendering + controls).

## Project layout

```
backend/
  requirements.txt
  app/
    main.py              FastAPI app, CORS, route registration
    models.py             Pydantic request/response schemas
    generator/
      rng.py               deterministic seeded RNG (string seed -> Random)
      rooms.py             room-tree generation algorithm (stage 1)
    api/
      dungeon.py           POST /api/dungeon/generate

frontend/
  index.html
  src/
    main.ts                wires up controls, calls the API, triggers render
    api.ts                  typed fetch wrapper
    types.ts                shared types matching the backend's JSON contract
    render.ts               SVG rendering (rooms + door gaps)
    style.css
```

## Running it

**Backend** (from `backend/`):
```
python3 -m venv .venv
source .venv/bin/activate          # .venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
API docs at http://localhost:8000/docs once it's running.

**Frontend** (from `frontend/`, in a separate terminal):
```
npm install
npm run dev
```
Open http://localhost:5175 — the Vite dev server proxies `/api/*` to the
backend on port 8000 (see `vite.config.ts`), so both need to be running.

`npm run typecheck` runs strict TypeScript checking without building.
`npm run build` produces a static `dist/` you can serve from anywhere —
at that point you'd either point it at a deployed backend URL or serve
both from the same origin.

## Status

Stage 1 only: seeded symmetric room-tree generation, no loops/corridors yet,
no doors beyond a placeholder gap in the shared wall, no hand-drawn rendering.
See the `app/generator/rooms.py` docstring-level comments for where stage 2
(loops & corridors) will plug in.
