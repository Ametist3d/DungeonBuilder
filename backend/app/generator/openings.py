from __future__ import annotations

import random

from .entities import Corridor, RoomNode, OPPOSITE


def used_directions(rooms: list[RoomNode], corridors: list[Corridor]) -> dict[int, set[str]]:
    """Which compass sides of each room already have a door -- from a tree
    edge (via entrance_dir) or a loop-bridge corridor (derived from its
    endpoint travel direction)."""
    directions: dict[int, set[str]] = {r.id: set() for r in rooms}
    tree_edges: set[tuple[int, int]] = set()
    for r in rooms:
        if r.parent_id is not None and r.entrance_dir is not None:
            directions[r.id].add(r.entrance_dir)
            directions[r.parent_id].add(OPPOSITE[r.entrance_dir])
            tree_edges.add((r.parent_id, r.id))

    for c in corridors:
        if (c.parent_id, c.child_id) in tree_edges:
            continue  # already counted above
        (x0, y0), (x1, y1) = c.points[0], c.points[1]
        d_parent = ("E" if x1 > x0 else "W") if y0 == y1 else ("S" if y1 > y0 else "N")
        directions[c.parent_id].add(d_parent)
        (x0, y0), (x1, y1) = c.points[-1], c.points[-2]
        d_child = ("E" if x1 > x0 else "W") if y0 == y1 else ("S" if y1 > y0 else "N")
        directions[c.child_id].add(d_child)
    return directions


def pick_open_wall(used: set[str], rng: random.Random) -> str:
    free = [d for d in ("N", "E", "S", "W") if d not in used]
    return rng.choice(free) if free else rng.choice(("N", "E", "S", "W"))
