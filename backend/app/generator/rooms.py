from __future__ import annotations

import random
from typing import Optional

from .entities import CorridorSeg, RoomNode, OPPOSITE, pick_dims, pick_shape
from .corridors import CORRIDOR_CHANCE, placement_clear, route_corridor, center_on_cells

PLACEMENT_RETRIES = 16
MIN_GAP = 1  # cells -- the floor for any connection; no room ever shares a bare wall


def pick_pattern(rng: random.Random) -> list[str]:
    """sides-only / forward-only / both"""
    roll = rng.random()
    if roll < 0.25:
        return ["sides"]
    if roll < 0.45:
        return ["forward"]
    return ["sides", "forward"]


def place_flush(
    parent: RoomNode, direction: str, w: int, h: int, rng: random.Random, next_id: int, shape: str = "rect",
) -> tuple[RoomNode, list[tuple[float, float]]]:
    """Fallback when a routed corridor doesn't fit -- still leaves MIN_GAP
    cells of corridor between the rooms, never a bare shared wall. A
    circle/octagon only reaches its bounding box at the exact center of
    that box's edge -- there's no valid offset range like a rect has, so
    either side being round forces the join onto that one point. Round
    child positions are solved as integers first, then the corridor's
    arrival row/col is snapped to match -- the room's own grid must never
    end up on a half-cell.
    """
    if direction in ("E", "W"):
        if parent.shape != "rect":
            wall_y = parent.y + parent.h / 2
        elif parent.h >= 3:
            wall_y = rng.randint(parent.y + 1, parent.y + parent.h - 2)
        else:
            wall_y = parent.y + parent.h // 2
        if shape != "rect":
            y = round(wall_y - h / 2)
            wall_y = y + h / 2
        else:
            y = round(wall_y) - rng.randint(1, max(1, h - 2))
        x0 = parent.x + parent.w if direction == "E" else parent.x
        x1 = x0 + MIN_GAP if direction == "E" else x0 - MIN_GAP
        x = x1 if direction == "E" else x1 - w
        points = center_on_cells([(x0, wall_y), (x1, wall_y)])
    else:
        if parent.shape != "rect":
            wall_x = parent.x + parent.w / 2
        elif parent.w >= 3:
            wall_x = rng.randint(parent.x + 1, parent.x + parent.w - 2)
        else:
            wall_x = parent.x + parent.w // 2
        if shape != "rect":
            x = round(wall_x - w / 2)
            wall_x = x + w / 2
        else:
            x = round(wall_x) - rng.randint(1, max(1, w - 2))
        y0 = parent.y + parent.h if direction == "S" else parent.y
        y1 = y0 + MIN_GAP if direction == "S" else y0 - MIN_GAP
        y = y1 if direction == "S" else y1 - h
        points = center_on_cells([(wall_x, y0), (wall_x, y1)])
    room = RoomNode(
        id=next_id, x=x, y=y, w=w, h=h,
        entrance_dir=OPPOSITE[direction], parent_id=parent.id, depth=parent.depth + 1,
        shape=shape,
    )
    return room, points


def try_spawn_child(
    parent: RoomNode,
    direction: str,
    rooms: list[RoomNode],
    corridor_segs: list[CorridorSeg],
    rng: random.Random,
    next_id: int,
    shape_weights: tuple[float, float, float],
    accent_pct: int,
) -> Optional[tuple[RoomNode, list[tuple[int, int]]]]:
    shape = pick_shape(rng, shape_weights)
    accent = rng.random() < accent_pct / 100
    w, h = pick_dims(rng, shape)
    others = [r for r in rooms if r.id != parent.id]

    if rng.random() < CORRIDOR_CHANCE:
        for _ in range(PLACEMENT_RETRIES):
            routed = route_corridor(parent, direction, w, h, rng, child_shape=shape)
            if not routed:
                continue
            cx, cy, points = routed
            candidate = RoomNode(
                id=next_id, x=cx, y=cy, w=w, h=h,
                entrance_dir=OPPOSITE[direction], parent_id=parent.id, depth=parent.depth + 1,
                shape=shape, accent=accent,
            )
            if placement_clear(candidate, points, others, corridor_segs):
                return candidate, points

    for _ in range(PLACEMENT_RETRIES):
        candidate, points = place_flush(parent, direction, w, h, rng, next_id, shape)
        candidate.accent = accent
        if placement_clear(candidate, points, others, corridor_segs):
            return candidate, points

    return None
