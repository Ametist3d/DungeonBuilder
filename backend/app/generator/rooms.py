from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Optional

from .rng import make_rng

OPPOSITE = {"N": "S", "S": "N", "E": "W", "W": "E"}
PERPENDICULAR = {"N": ["E", "W"], "S": ["E", "W"], "E": ["N", "S"], "W": ["N", "S"]}
SIZE_TARGETS = {"small": (3, 6), "medium": (6, 12), "large": (12, 25)}

# Minimum length of shared wall between parent and child, so a door always
# has somewhere to go later.
MIN_OVERLAP = 2
ROOM_MIN_DIM = 3
ROOM_MAX_DIM = 6
GUARD_LIMIT = 500


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
    children: list[int] = field(default_factory=list)


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


def _try_spawn_child(
    parent: RoomNode,
    direction: str,
    rooms: list[RoomNode],
    rng: random.Random,
    next_id: int,
) -> Optional[RoomNode]:
    w = rng.randint(ROOM_MIN_DIM, ROOM_MAX_DIM)
    h = rng.randint(ROOM_MIN_DIM, ROOM_MAX_DIM)

    for _ in range(6):
        if direction in ("E", "W"):
            x = parent.x + parent.w if direction == "E" else parent.x - w
            lo, hi = parent.y - h + MIN_OVERLAP, parent.y + parent.h - MIN_OVERLAP
            if lo > hi:
                lo, hi = hi, lo
            y = rng.randint(lo, hi)
        else:
            y = parent.y + parent.h if direction == "S" else parent.y - h
            lo, hi = parent.x - w + MIN_OVERLAP, parent.x + parent.w - MIN_OVERLAP
            if lo > hi:
                lo, hi = hi, lo
            x = rng.randint(lo, hi)

        collides = any(
            r.id != parent.id and rects_overlap(x, y, w, h, r.x, r.y, r.w, r.h, margin=1)
            for r in rooms
        )
        if not collides:
            return RoomNode(
                id=next_id,
                x=x, y=y, w=w, h=h,
                entrance_dir=OPPOSITE[direction],
                parent_id=parent.id,
                depth=parent.depth + 1,
            )
    return None  # gave up after retries -- a visible gap, not a forced overlap


def _pick_pattern(rng: random.Random) -> list[str]:
    """sides-only / forward-only / both -- roughly watabou's described split."""
    roll = rng.random()
    if roll < 0.35:
        return ["sides"]
    if roll < 0.6:
        return ["forward"]
    return ["sides", "forward"]


def generate_dungeon(seed: str, target_count: int, symmetry_break_pct: int) -> list[RoomNode]:
    rng = make_rng(seed)
    next_id = 0

    root = RoomNode(
        id=next_id,
        x=0, y=0,
        w=rng.randint(4, 7), h=rng.randint(4, 7),
        entrance_dir=None, parent_id=None, depth=0,
    )
    next_id += 1

    rooms: list[RoomNode] = [root]
    frontier: list[RoomNode] = [root]
    guard = 0

    while len(rooms) < target_count and frontier and guard < GUARD_LIMIT:
        guard += 1
        idx = rng.randint(0, len(frontier) - 1)
        parent = frontier.pop(idx)

        if parent.entrance_dir is None:
            axis = "NS" if rng.random() < 0.5 else "EW"
            sides = ["E", "W"] if axis == "NS" else ["N", "S"]
            forward_options = ["N", "S"] if axis == "NS" else ["E", "W"]
            forward_dir = forward_options[0] if rng.random() < 0.5 else forward_options[1]
        else:
            sides = PERPENDICULAR[parent.entrance_dir]
            forward_dir = OPPOSITE[parent.entrance_dir]

        pattern = _pick_pattern(rng)
        candidate_dirs: list[str] = []
        if "sides" in pattern:
            candidate_dirs.extend(sides)
        if "forward" in pattern:
            candidate_dirs.append(forward_dir)

        kept = [
            d for d in candidate_dirs
            if rng.random() > symmetry_break_pct / 100 or len(candidate_dirs) <= 1
        ]
        if not kept:
            kept = [forward_dir]

        for direction in kept:
            if len(rooms) >= target_count:
                break
            child = _try_spawn_child(parent, direction, rooms, rng, next_id)
            if child:
                next_id += 1
                rooms.append(child)
                frontier.append(child)
                parent.children.append(child.id)

    return rooms
