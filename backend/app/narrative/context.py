# app/narrative/context.py
from __future__ import annotations

from collections import deque

from ..generator.entities import Corridor, Opening, RoomNode, Door

def _room_size(r: RoomNode) -> str:
    area = r.w * r.h
    if area <= 12:
        return "small"
    if area <= 25:
        return "medium"
    return "large"


def _shortest_path(start: int, goal: int, adjacency: dict[int, set[int]]) -> set[int]:
    if start == goal:
        return {start}
    parent: dict[int, int] = {start: start}
    queue = deque([start])
    while queue:
        node = queue.popleft()
        if node == goal:
            break
        for nxt in adjacency.get(node, ()):
            if nxt not in parent:
                parent[nxt] = node
                queue.append(nxt)
    if goal not in parent:
        return set()
    path = {goal}
    cur = goal
    while cur != start:
        cur = parent[cur]
        path.add(cur)
    return path


def build_narrative_context(
    rooms: list[RoomNode],
    corridors: list[Corridor],
    entrance: Opening,
    exit_opening: Opening,
    doors: list[Door] | None = None,
) -> dict:
    """Compact graph description for a text LLM -- topology, size, and depth
    are already known exactly from generation, so there's nothing a vision
    model reading the rendered map would add."""
    adjacency: dict[int, set[int]] = {r.id: set() for r in rooms}
    edges: dict[int, list[tuple[int, str]]] = {r.id: [] for r in rooms}
    for c in corridors:
        kind = "branch" if c.branches_from_corridor else "corridor"
        adjacency[c.parent_id].add(c.child_id)
        adjacency[c.child_id].add(c.parent_id)
        edges[c.parent_id].append((c.child_id, kind))
        edges[c.child_id].append((c.parent_id, kind))

    critical_path = _shortest_path(entrance.room_id, exit_opening.room_id, adjacency)
    
    doors = doors or []

    doors_by_room: dict[int, list[Door]] = {r.id: [] for r in rooms}
    for door in doors:
        doors_by_room.setdefault(door.room_id, []).append(door)

    return {
        "roomCount": len(rooms),
        "entrance": {"roomId": entrance.room_id, "dir": entrance.direction},
        "exit": {"roomId": exit_opening.room_id, "dir": exit_opening.direction},
        "legend": {
            "sh": "shape",
            "sz": "size",
            "d": "depth",
            "a": "accent",
            "c": "connections",
            "k": "corridor kind: c=corridor, b=branch",
            "main": "on main entrance-exit path",
            "closedDoors": "closed doors from this room side",
        },
        "rooms": [
            {
                "id": r.id,
                "sh": r.shape,
                "sz": _room_size(r),
                "d": r.depth,
                "a": r.accent,
                "c": [{"to": to, "k": kind[0]} for to, kind in edges[r.id]],
                "dead": len(edges[r.id]) == 1,
                "hub": len(edges[r.id]) >= 3,
                "main": r.id in critical_path,
                "closedDoors": [
                    {
                        "to": door.other_room_id,
                        "m": door.material,
                        "lock": door.lock,
                    }
                    for door in doors_by_room.get(r.id, [])
                    if door.state == "closed"
                ],
            }
            for r in rooms
        ],
    }
