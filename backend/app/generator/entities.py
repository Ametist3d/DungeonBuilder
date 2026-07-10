from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Optional, Literal
from .rng import make_rng

# --- door classes ---

DoorState = Literal["open", "closed"]
DoorMaterial = Literal["wood", "iron", "stone", "bone", "arcane"]
DoorLock = Literal["none", "locked", "magicSealed", "puzzleSealed"]
DoorGate = Literal["none", "hard", "soft"]

# --- directions ---

OPPOSITE = {"N": "S", "S": "N", "E": "W", "W": "E"}
PERPENDICULAR = {"N": ["E", "W"], "S": ["E", "W"], "E": ["N", "S"], "W": ["N", "S"]}

# --- dataclasses ---

@dataclass(frozen=True)
class Door:
    id: str
    parent_id: int
    child_id: int
    room_id: int
    other_room_id: int
    state: DoorState = "open"
    material: DoorMaterial = "wood"
    lock: DoorLock = "none"
    reason: str = ""
    key_room_id: Optional[int] = None
    key_name: str = ""
    gate: DoorGate = "none"
    checksum: str = ""

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

def _door_id(parent_id: int, child_id: int, room_id: int) -> str:
    return f"{parent_id}-{child_id}-{room_id}"


def _closed_style(seed: str, door_key: str) -> tuple[DoorMaterial, DoorLock, str]:
    rng = make_rng(f"{seed}#door-style#{door_key}")

    styles: list[tuple[DoorMaterial, DoorLock, str]] = [
        ("wood", "locked", "locked wooden door"),
        ("iron", "locked", "locked iron-banded door"),
        ("stone", "sealed", "sealed stone door"),
        ("stone", "magicSealed", "magic-sealed stone door"),
        ("puzzle", "puzzleSealed", "puzzle-sealed mechanism door"),
        ("bone", "sealed", "sealed bone-inlaid door"),
    ]

    return rng.choice(styles)


def build_doors(
    rooms: list[RoomNode],
    corridors: list[Corridor],
    entrance: Opening,
    seed: str,
    closed_door_pct: int,
) -> list[Door]:
    pct = max(0, min(100, int(closed_door_pct)))
    by_id = {room.id: room for room in rooms}

    doors: list[Door] = []
    incoming_by_room: dict[int, list[str]] = {}

    for corridor in corridors:
        parent = by_id.get(corridor.parent_id)
        child = by_id.get(corridor.child_id)

        if not parent or not child:
            continue

        if not corridor.branches_from_corridor:
            parent_door = Door(
                id=_door_id(corridor.parent_id, corridor.child_id, corridor.parent_id),
                parent_id=corridor.parent_id,
                child_id=corridor.child_id,
                room_id=corridor.parent_id,
                other_room_id=corridor.child_id,
            )
            doors.append(parent_door)

        child_door = Door(
            id=_door_id(corridor.parent_id, corridor.child_id, corridor.child_id),
            parent_id=corridor.parent_id,
            child_id=corridor.child_id,
            room_id=corridor.child_id,
            other_room_id=corridor.parent_id,
        )
        doors.append(child_door)

        if parent.depth < child.depth and child.id != entrance.room_id:
            incoming_by_room.setdefault(child.id, []).append(child_door.id)

        if child.depth < parent.depth and parent.id != entrance.room_id:
            incoming_by_room.setdefault(parent.id, []).append(
                _door_id(corridor.parent_id, corridor.child_id, corridor.parent_id)
            )

    if pct <= 0 or not doors:
        return doors

    preferred_closed_ids = {
        door_id
        for door_ids in incoming_by_room.values()
        if len(door_ids) > 1
        for door_id in door_ids
    }

    rng = make_rng(f"{seed}#closed-doors")

    def corridor_key(door: Door) -> tuple[int, int]:
            return door.parent_id, door.child_id

    preferred = [door for door in doors if door.id in preferred_closed_ids]
    normal = [door for door in doors if door.id not in preferred_closed_ids]

    rng.shuffle(preferred)
    rng.shuffle(normal)

    corridor_count = len({corridor_key(door) for door in doors})
    closed_count = max(1, round(corridor_count * pct / 100))

    closed_ids: set[str] = set()
    closed_corridors: set[tuple[int, int]] = set()

    for door in preferred + normal:
        key = corridor_key(door)

        if key in closed_corridors:
            continue

        closed_ids.add(door.id)
        closed_corridors.add(key)

        if len(closed_ids) >= closed_count:
            break

    result: list[Door] = []

    for door in doors:
        if door.id not in closed_ids:
            result.append(door)
            continue

        material, lock, reason = _closed_style(seed, door.id)

        result.append(
            Door(
                id=door.id,
                parent_id=door.parent_id,
                child_id=door.child_id,
                room_id=door.room_id,
                other_room_id=door.other_room_id,
                state="closed",
                material=material,
                lock=lock,
                reason=reason,
            )
        )

    return result
