import secrets
from typing import Any

from fastapi import APIRouter

from ..generator.rng import make_rng
from ..generator.pipeline import SIZE_TARGETS, generate_dungeon
from ..generator.locks import build_doors
from ..models import Corridor, Door, GenerateRequest, GenerateResponse, Opening, Room
from ..narrative.context import build_narrative_context
from ..narrative.llm import generate_narrative

router = APIRouter(prefix="/api/dungeon", tags=["dungeon"])


@router.post("/generate", response_model=GenerateResponse, response_model_by_alias=True)
def generate(req: GenerateRequest) -> GenerateResponse:
    seed = req.seed or secrets.token_hex(4)

    lo, hi = SIZE_TARGETS[req.size]
    count_rng = make_rng(seed + "#count")
    target = count_rng.randint(lo, hi)

    rooms, corridors, entrance, exit_opening = generate_dungeon(
        seed, target, req.symmetry_break,
        shape_weights=(req.rect_pct, req.circle_pct, req.octagon_pct),
        accent_pct=req.accent_pct,
    )

    max_depth = max((r.depth for r in rooms), default=0)

    doors = build_doors(rooms, corridors, entrance, exit_opening, seed, req.closed_door_pct)
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
            Corridor(
                parent_id=c.parent_id, child_id=c.child_id, points=[list(p) for p in c.points],
                branches_from_corridor=c.branches_from_corridor,
            )
            for c in corridors
        ],
        entrance=Opening(room_id=entrance.room_id, direction=entrance.direction),
        exit=Opening(room_id=exit_opening.room_id, direction=exit_opening.direction),
        doors=[
            Door(
                id=door.id,
                parent_id=door.parent_id,
                child_id=door.child_id,
                room_id=door.room_id,
                other_room_id=door.other_room_id,
                state=door.state,
                material=door.material,
                lock=door.lock,
                reason=door.reason,
                key_room_id=door.key_room_id,
                key_name=door.key_name,
                gate=door.gate,
                checksum=door.checksum,
            )
            for door in doors
        ],
    )

@router.post("/narrate")
def narrate(req: GenerateRequest) -> Any:
    '''Generate a dungeon and return a narrative description of it.'''

    seed = req.seed or secrets.token_hex(4)

    lo, hi = SIZE_TARGETS[req.size]
    count_rng = make_rng(seed + "#count")
    target = count_rng.randint(lo, hi)

    rooms, corridors, entrance, exit_opening = generate_dungeon(
        seed,
        target,
        req.symmetry_break,
        shape_weights=(req.rect_pct, req.circle_pct, req.octagon_pct),
        accent_pct=req.accent_pct,
    )
    doors = build_doors(rooms, corridors, entrance, exit_opening, seed, req.closed_door_pct)

    context = build_narrative_context(rooms, corridors, entrance, exit_opening, doors)
    return generate_narrative(context, req.llm_provider)