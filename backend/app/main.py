import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.dungeon import router as dungeon_router


def cors_origins() -> list[str]:
    raw = os.getenv("BACKEND_CORS_ORIGINS", "")
    configured = [item.strip() for item in raw.split(",") if item.strip()]

    return configured or [
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "http://46.225.185.220",
    ]


app = FastAPI(title="Dungeon Generator API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dungeon_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
