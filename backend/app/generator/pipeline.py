from __future__ import annotations

from .entities import Corridor, Opening, RoomNode, CorridorSeg, OPPOSITE, PERPENDICULAR, pick_dims, pick_shape
from .rng import make_rng
from .rooms import pick_pattern, try_spawn_child
from .corridors import add_corridor_branches, add_loop_corridors, segments_from_points
from .openings import pick_open_wall, used_directions

SIZE_TARGETS = {"small": (3, 6), "medium": (6, 12), "large": (12, 25)}
GUARD_LIMIT = 500


def generate_dungeon(
    seed: str, target_count: int, symmetry_break_pct: int,
    shape_weights: tuple[float, float, float] = (100.0, 0.0, 0.0), accent_pct: int = 15,
) -> tuple[list[RoomNode], list[Corridor], Opening, Opening]:
    rng = make_rng(seed)
    next_id = 0

    root_shape = pick_shape(rng, shape_weights)
    if root_shape == "rect":
        root_w, root_h = rng.randint(4, 7), rng.randint(4, 7)
    else:
        root_w, root_h = pick_dims(rng, root_shape)
    root = RoomNode(
        id=next_id,
        x=0, y=0,
        w=root_w, h=root_h,
        entrance_dir=None, parent_id=None, depth=0,
        shape=root_shape, accent=rng.random() < accent_pct / 100,
    )
    next_id += 1

    rooms: list[RoomNode] = [root]
    corridor_segs: list[CorridorSeg] = []
    corridors: list[Corridor] = []
    frontier: list[RoomNode] = [root]
    guard = 0

    while len(rooms) < target_count and guard < GUARD_LIMIT:
        guard += 1
        if frontier:
            idx = rng.randint(0, len(frontier) - 1)
            parent = frontier.pop(idx)
        else:
            parent = rng.choice(rooms)

        if parent.entrance_dir is None:
            axis = "NS" if rng.random() < 0.5 else "EW"
            sides = ["E", "W"] if axis == "NS" else ["N", "S"]
            forward_options = ["N", "S"] if axis == "NS" else ["E", "W"]
            forward_dir = forward_options[0] if rng.random() < 0.5 else forward_options[1]
        else:
            sides = PERPENDICULAR[parent.entrance_dir]
            forward_dir = OPPOSITE[parent.entrance_dir]

        pattern = pick_pattern(rng)
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

        spawned_any = False
        for direction in kept:
            if len(rooms) >= target_count:
                break
            spawned = try_spawn_child(parent, direction, rooms, corridor_segs, rng, next_id, shape_weights, accent_pct)
            if spawned:
                child, points = spawned
                next_id += 1
                rooms.append(child)
                frontier.append(child)
                parent.children.append(child.id)
                if points:
                    corridor_segs.extend(segments_from_points(points))
                    corridors.append(Corridor(parent_id=parent.id, child_id=child.id, points=points))
                spawned_any = True

        if not spawned_any and len(rooms) < target_count:
            for direction in sides + [forward_dir]:
                if direction in kept or len(rooms) >= target_count:
                    continue
                spawned = try_spawn_child(parent, direction, rooms, corridor_segs, rng, next_id, shape_weights, accent_pct)
                if spawned:
                    child, points = spawned
                    next_id += 1
                    rooms.append(child)
                    frontier.append(child)
                    parent.children.append(child.id)
                    if points:
                        corridor_segs.extend(segments_from_points(points))
                        corridors.append(Corridor(parent_id=parent.id, child_id=child.id, points=points))
                    break

    add_loop_corridors(rooms, corridor_segs, corridors, rng)
    add_corridor_branches(rooms, corridors, corridor_segs, rng)

    used = used_directions(rooms, corridors)
    root_room = rooms[0]
    root_cx, root_cy = root_room.x + root_room.w / 2, root_room.y + root_room.h / 2
    last_room = max(
        rooms,
        key=lambda r: (r.x + r.w / 2 - root_cx) ** 2 + (r.y + r.h / 2 - root_cy) ** 2,
    )

    entrance_dir = pick_open_wall(used[root_room.id], rng)
    used[root_room.id].add(entrance_dir)  # so a single-room dungeon doesn't reuse the same wall
    exit_dir = pick_open_wall(used[last_room.id], rng)

    entrance = Opening(room_id=root_room.id, direction=entrance_dir)
    exit_opening = Opening(room_id=last_room.id, direction=exit_dir)

    return rooms, corridors, entrance, exit_opening
