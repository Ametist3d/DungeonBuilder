from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.dungeon import router as dungeon_router

app = FastAPI(title="Dungeon Generator API", version="0.1.0")

# Vite dev server origin. Loosen/replace this once there's a real deployment target.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dungeon_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
