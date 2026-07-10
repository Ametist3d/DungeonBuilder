from __future__ import annotations

import hashlib
from collections import deque
from dataclasses import replace

from .entities import Corridor, Door, DoorLock, DoorMaterial, Opening, RoomNode
from .rng import make_rng

Edge = tuple[int, int]

DOOR_MATERIALS: tuple[DoorMaterial, ...] = ("wood", "iron", "stone", "bone", "arcane")
LOCK_KINDS: tuple[tuple[DoorLock, str, str], ...] = (
    ("locked", "key", "locked"),
    ("puzzleSealed", "mechanism", "puzzle-sealed"),
    ("magicSealed", "scroll", "magic-sealed"),
)


def _edge(a: int, b: int) -> Edge:
    return (a, b) if a < b else (b, a)


def _door_id(parent_id: int, child_id: int, room_id: int) -> str:
    return f"{parent_id}-{child_id}-{room_id}"


def _adjacency(rooms: list[RoomNode], corridors: list[Corridor]) -> dict[int, set[int]]:
    graph: dict[int, set[int]] = {room.id: set() for room in rooms}

    for corridor in corridors:
        graph[corridor.parent_id].add(corridor.child_id)
        graph[corridor.child_id].add(corridor.parent_id)

    return graph


def _bridges(graph: dict[int, set[int]]) -> set[Edge]:
    bridges: set[Edge] = set()
    tin: dict[int, int] = {}
    low: dict[int, int] = {}
    timer = 0

    def dfs(node: int, parent: int | None) -> None:
        nonlocal timer

        tin[node] = low[node] = timer
        timer += 1

        for nxt in graph[node]:
            if nxt == parent:
                continue

            if nxt in tin:
                low[node] = min(low[node], tin[nxt])
                continue

            dfs(nxt, node)
            low[node] = min(low[node], low[nxt])

            if low[nxt] > tin[node]:
                bridges.add(_edge(node, nxt))

    for node in graph:
        if node not in tin:
            dfs(node, None)

    return bridges


def _reachable_without_edge(graph: dict[int, set[int]], start: int, cut: Edge) -> set[int]:
    seen = {start}
    queue = deque([start])

    while queue:
        node = queue.popleft()

        for nxt in graph[node]:
            if _edge(node, nxt) == cut or nxt in seen:
                continue

            seen.add(nxt)
            queue.append(nxt)

    return seen

def _reachable_with_blocked_edges(graph: dict[int, set[int]], start: int, blocked: set[Edge]) -> set[int]:
    seen = {start}
    queue = deque([start])

    while queue:
        node = queue.popleft()

        for nxt in graph[node]:
            if _edge(node, nxt) in blocked or nxt in seen:
                continue

            seen.add(nxt)
            queue.append(nxt)

    return seen

def _key_room_capacity(room: RoomNode) -> int:
    area = room.w * room.h

    if room.shape != "rect":
        area = round(area * 0.65)

    if area <= 8:
        return 1

    if area <= 16:
        return 2

    if area <= 28:
        return 3

    return 4

def _distance_order(graph: dict[int, set[int]], start: int) -> dict[int, int]:
    dist = {start: 0}
    queue = deque([start])

    while queue:
        node = queue.popleft()

        for nxt in graph[node]:
            if nxt in dist:
                continue

            dist[nxt] = dist[node] + 1
            queue.append(nxt)

    return dist


def _path_edges(graph: dict[int, set[int]], start: int, goal: int) -> set[Edge]:
    parent: dict[int, int] = {start: start}
    queue = deque([start])

    while queue:
        node = queue.popleft()

        if node == goal:
            break

        for nxt in graph[node]:
            if nxt in parent:
                continue

            parent[nxt] = node
            queue.append(nxt)

    if goal not in parent:
        return set()

    result: set[Edge] = set()
    cur = goal

    while cur != start:
        prev = parent[cur]
        result.add(_edge(prev, cur))
        cur = prev

    return result


def _make_open_doors(rooms: list[RoomNode], corridors: list[Corridor]) -> list[Door]:
    by_id = {room.id: room for room in rooms}
    doors: list[Door] = []

    for corridor in corridors:
        if corridor.parent_id not in by_id or corridor.child_id not in by_id:
            continue

        if not corridor.branches_from_corridor:
            doors.append(
                Door(
                    id=_door_id(corridor.parent_id, corridor.child_id, corridor.parent_id),
                    parent_id=corridor.parent_id,
                    child_id=corridor.child_id,
                    room_id=corridor.parent_id,
                    other_room_id=corridor.child_id,
                )
            )

        doors.append(
            Door(
                id=_door_id(corridor.parent_id, corridor.child_id, corridor.child_id),
                parent_id=corridor.parent_id,
                child_id=corridor.child_id,
                room_id=corridor.child_id,
                other_room_id=corridor.parent_id,
            )
        )

    return doors


def _style_for(
    seed: str,
    attempt: int,
    edge: Edge,
    locked_room_id: int,
) -> tuple[DoorMaterial, DoorLock, str, str]:
    rng = make_rng(f"{seed}#lock-style#{attempt}#{edge[0]}-{edge[1]}")
    material = rng.choice(DOOR_MATERIALS)
    lock, item, label = rng.choice(LOCK_KINDS)
    key_name = f"Room {locked_room_id} door {edge[0]}-{edge[1]} {material} {item}"
    reason = f"{label} {material} door"

    return material, lock, key_name, reason


def _door_for_edge(
    doors: list[Door],
    edge: Edge,
    graph: dict[int, set[int]],
    entrance_room_id: int,
) -> Door | None:
    near_region = _reachable_without_edge(graph, entrance_room_id, edge)
    far_rooms = [room_id for room_id in edge if room_id not in near_region]
    preferred_room = far_rooms[0] if far_rooms else edge[1]

    for door in doors:
        if _edge(door.parent_id, door.child_id) == edge and door.room_id == preferred_room:
            return door

    for door in doors:
        if _edge(door.parent_id, door.child_id) == edge:
            return door

    return None


def _tokens_for(door: Door) -> set[str]:
    return {f"door:{door.id}"}


def _progressive_reached(graph: dict[int, set[int]], entrance_room_id: int, doors: list[Door]) -> set[int]:
    closed_by_edge = {
        _edge(door.parent_id, door.child_id): door
        for door in doors
        if door.state == "closed"
    }

    keys_by_room: dict[int, set[str]] = {}

    for door in closed_by_edge.values():
        if door.key_room_id is None:
            return set()

        keys_by_room.setdefault(door.key_room_id, set()).update(_tokens_for(door))

    inventory: set[str] = set()
    reached: set[int] = set()

    changed = True

    while changed:
        changed = False
        queue = deque([entrance_room_id])
        seen = {entrance_room_id}

        while queue:
            node = queue.popleft()

            for nxt in graph[node]:
                locked = closed_by_edge.get(_edge(node, nxt))

                if locked and not (_tokens_for(locked) <= inventory):
                    continue

                if nxt in seen:
                    continue

                seen.add(nxt)
                queue.append(nxt)

        if not seen.issubset(reached):
            reached |= seen
            changed = True

        before = len(inventory)

        for room_id in reached:
            inventory |= keys_by_room.get(room_id, set())

        if len(inventory) != before:
            changed = True

    return reached


def _progressively_reaches_all(graph: dict[int, set[int]], entrance_room_id: int, doors: list[Door]) -> bool:
    return len(_progressive_reached(graph, entrance_room_id, doors)) == len(graph)


def _checksum(doors: list[Door]) -> str:
    payload = "|".join(
        f"{door.id}:{door.state}:{door.material}:{door.lock}:{door.key_room_id}:{door.key_name}:{door.gate}"
        for door in sorted(doors, key=lambda item: item.id)
    )

    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12]


def _place_once(
    rooms: list[RoomNode],
    corridors: list[Corridor],
    entrance: Opening,
    exit_opening: Opening,
    seed: str,
    closed_door_pct: int,
    attempt: int,
) -> list[Door]:
    pct = max(0, min(100, int(closed_door_pct)))
    doors = _make_open_doors(rooms, corridors)

    if pct <= 0 or not doors:
        return doors

    graph = _adjacency(rooms, corridors)
    bridges = _bridges(graph)
    critical = _path_edges(graph, entrance.room_id, exit_opening.room_id)
    dist = _distance_order(graph, entrance.room_id)
    rng = make_rng(f"{seed}#lock-plan#{attempt}")

    all_edges = sorted({_edge(c.parent_id, c.child_id) for c in corridors})
    bridge_edges = [edge for edge in all_edges if edge in bridges]
    soft_edges = [edge for edge in all_edges if edge not in bridges]

    bridge_edges.sort(
        key=lambda edge: (
            edge not in critical,
            max(dist.get(edge[0], 0), dist.get(edge[1], 0)),
            edge,
        )
    )
    rng.shuffle(soft_edges)

    wanted = min(len(all_edges), max(1, round(len(all_edges) * pct / 100)))
    selected = (bridge_edges + soft_edges)[:wanted]
    selected.sort(key=lambda edge: (max(dist.get(edge[0], 0), dist.get(edge[1], 0)), edge))

    locked: dict[str, Door] = {}
    
    rooms_by_id = {room.id: room for room in rooms}
    key_counts: dict[int, int] = {}

    for index, edge in enumerate(selected):
        door = _door_for_edge(doors, edge, graph, entrance.room_id)
        if not door:
            continue

        gate = "hard" if edge in bridges else "soft"
        pending_edges = set(selected[index:])
        reachable_now = _reachable_with_blocked_edges(graph, entrance.room_id, pending_edges)

        candidates = [
            room_id
            for room_id in sorted(reachable_now - {door.room_id}, key=lambda rid: (dist.get(rid, 0), rid))
            if key_counts.get(room_id, 0) < _key_room_capacity(rooms_by_id[room_id])
        ]

        if not candidates:
            candidates = sorted(reachable_now - {door.room_id}, key=lambda rid: (key_counts.get(rid, 0), dist.get(rid, 0), rid))
            
        if not candidates:
            candidates = [room_id for room_id in reachable_now if room_id != door.room_id]

        if not candidates:
            candidates = [entrance.room_id]

        rng_key = make_rng(f"{seed}#key-room#{attempt}#{edge[0]}-{edge[1]}")
        key_room_id = candidates[rng_key.randrange(len(candidates))]
        key_counts[key_room_id] = key_counts.get(key_room_id, 0) + 1
        material, lock, key_name, reason = _style_for(seed, attempt, edge, door.room_id)

        locked[door.id] = replace(
            door,
            state="closed",
            material=material,
            lock=lock,
            reason=reason,
            key_room_id=key_room_id,
            key_name=key_name,
            gate=gate,
        )

    result = [locked.get(door.id, door) for door in doors]
    checksum = _checksum(result)

    return [replace(door, checksum=checksum) for door in result]


def build_doors(
    rooms: list[RoomNode],
    corridors: list[Corridor],
    entrance: Opening,
    exit_opening: Opening,
    seed: str,
    closed_door_pct: int,
) -> list[Door]:
    graph = _adjacency(rooms, corridors)

    for attempt in range(5):
        doors = _place_once(rooms, corridors, entrance, exit_opening, seed, closed_door_pct, attempt)

        if _progressively_reaches_all(graph, entrance.room_id, doors):
            return doors

    return _place_once(rooms, corridors, entrance, exit_opening, seed, closed_door_pct, 5)
