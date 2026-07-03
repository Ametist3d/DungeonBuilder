from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Optional

# --- directions ---

OPPOSITE = {"N": "S", "S": "N", "E": "W", "W": "E"}
PERPENDICULAR = {"N": ["E", "W"], "S": ["E", "W"], "E": ["N", "S"], "W": ["N", "S"]}


# --- dataclasses ---

@dataclass
class RoomNode:
    id: int
    x: int
    y: int
    w: int
    h: int
    entrance_dir: Optional[str]
    parent_id: Optional[int]
    depth: int
    shape: str = "rect"
    accent: bool = False
    children: list[int] = field(default_factory=list)


@dataclass
class Corridor:
    """A corridor connection, as centerline waypoints from the parent
    room's wall to the child room's wall."""
    parent_id: int
    child_id: int
    points: list[tuple[float, float]]
    branches_from_corridor: bool = False


@dataclass
class Opening:
    """A wall opening to the outside world -- the dungeon's entrance or exit."""
    room_id: int
    direction: str


@dataclass
class CorridorSeg:
    """Internal collision-detection rect for one leg of a routed corridor."""
    x: float
    y: float
    w: float
    h: float


def leaf_ids(rooms: list[RoomNode]) -> set[int]:
    """Room ids with no children in the tree -- only the loop-closing pass
    (in corridors.py) needs this, but it's a query over RoomNode so it lives
    here rather than forcing corridors.py to import rooms.py."""
    has_children = {r.parent_id for r in rooms if r.parent_id is not None}
    return {r.id for r in rooms if r.id not in has_children}


# --- geometry ---

def rects_overlap(
    ax: int, ay: int, aw: int, ah: int,
    bx: int, by: int, bw: int, bh: int,
    margin: int = 0,
) -> bool:
    return not (
        ax + aw + margin <= bx
        or bx + bw + margin <= ax
        or ay + ah + margin <= by
        or by + bh + margin <= ay
    )


# --- shape / dimension picking -- where a future room shape gets added ---

# circle/octagon diameter -- always even, so the box-center used for corridor
# attachment lands exactly on the shape's boundary
ROUND_MIN_DIM = 3
ROUND_MAX_DIM = 8

ROOM_MIN_DIM = 3
ROOM_MAX_DIM = 6


def pick_dims(rng: random.Random, shape: str) -> tuple[int, int]:
    if shape == "rect":
        return rng.randint(ROOM_MIN_DIM, ROOM_MAX_DIM), rng.randint(ROOM_MIN_DIM, ROOM_MAX_DIM)
    d = rng.randint(ROUND_MIN_DIM // 2, ROUND_MAX_DIM // 2) * 2 + 1
    return d, d


def pick_shape(rng: random.Random, weights: tuple[float, float, float]) -> str:
    """weights = (rect, circle, octagon), any non-negative numbers -- normalized internally."""
    total = sum(weights)
    if total <= 0:
        return "rect"
    roll = rng.random() * total
    upto = 0.0
    for shape, w in zip(("rect", "circle", "octagon"), weights):
        upto += w
        if roll <= upto:
            return shape
    return "rect"
