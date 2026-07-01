import secrets

from fastapi import APIRouter

from ..generator.rng import make_rng
from ..generator.rooms import SIZE_TARGETS, generate_dungeon
from ..models import GenerateRequest, GenerateResponse, Room

router = APIRouter(prefix="/api/dungeon", tags=["dungeon"])


@router.post("/generate", response_model=GenerateResponse, response_model_by_alias=True)
def generate(req: GenerateRequest) -> GenerateResponse:
    seed = req.seed or secrets.token_hex(4)

    lo, hi = SIZE_TARGETS[req.size]
    count_rng = make_rng(seed + "#count")
    target = count_rng.randint(lo, hi)

    rooms = generate_dungeon(seed, target, req.symmetry_break)
    max_depth = max((r.depth for r in rooms), default=0)

    return GenerateResponse(
        seed=seed,
        target=target,
        max_depth=max_depth,
        rooms=[
            Room(
                id=r.id, x=r.x, y=r.y, w=r.w, h=r.h,
                parent_id=r.parent_id, entrance_dir=r.entrance_dir, depth=r.depth,
            )
            for r in rooms
        ],
    )
