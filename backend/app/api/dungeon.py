import secrets

from fastapi import APIRouter

from ..generator.rng import make_rng
from ..generator.rooms import SIZE_TARGETS, generate_dungeon
from ..models import Corridor, GenerateRequest, GenerateResponse, Opening, Room

router = APIRouter(prefix="/api/dungeon", tags=["dungeon"])


@router.post("/generate", response_model=GenerateResponse, response_model_by_alias=True)
def generate(req: GenerateRequest) -> GenerateResponse:
    seed = req.seed or secrets.token_hex(4)

    lo, hi = SIZE_TARGETS[req.size]
    count_rng = make_rng(seed + "#count")
    target = count_rng.randint(lo, hi)

    rooms, corridors, entrance, exit_opening  = generate_dungeon(
        seed, target, req.symmetry_break,
        shape_weights=(req.rect_pct, req.circle_pct, req.octagon_pct),
        accent_pct=req.accent_pct,
    )
    max_depth = max((r.depth for r in rooms), default=0)

    return GenerateResponse(
        seed=seed,
        target=target,
        max_depth=max_depth,
        rooms=[
            Room(
                id=r.id, x=r.x, y=r.y, w=r.w, h=r.h,
                parent_id=r.parent_id, entrance_dir=r.entrance_dir, depth=r.depth,
                shape=r.shape, accent=r.accent,
            )
            for r in rooms
        ],
        corridors=[
            Corridor(parent_id=c.parent_id, child_id=c.child_id, points=[list(p) for p in c.points])
            for c in corridors
        ],
        entrance=Opening(room_id=entrance.room_id, direction=entrance.direction),
        exit=Opening(room_id=exit_opening.room_id, direction=exit_opening.direction),
    )
