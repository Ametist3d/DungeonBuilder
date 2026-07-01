from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Optional

from .rng import make_rng

ROUND_MIN_DIM = 3  # circle/octagon diameter -- always even, so the box-center used
ROUND_MAX_DIM = 8  # for corridor attachment lands exactly on the shape's boundary

OPPOSITE = {"N": "S", "S": "N", "E": "W", "W": "E"}
PERPENDICULAR = {"N": ["E", "W"], "S": ["E", "W"], "E": ["N", "S"], "W": ["N", "S"]}
SIZE_TARGETS = {"small": (3, 6), "medium": (6, 12), "large": (12, 25)}

# Minimum length of shared wall between parent and child, so a door always
# has somewhere to go later.
MIN_OVERLAP = 2
ROOM_MIN_DIM = 3
ROOM_MAX_DIM = 6
GUARD_LIMIT = 500
PLACEMENT_RETRIES = 16


CORRIDOR_WIDTH = 1
CORRIDOR_CHANCE = 0.85
CORRIDOR_MIN_LEN = 2
CORRIDOR_MAX_LEN = 6
CORRIDOR_JOG_CHANCE = 0.7
CORRIDOR_JOG_MIN = 1
CORRIDOR_JOG_MAX = 3
CORRIDOR_ZIGZAG_CHANCE = 0.35
MIN_LEG = 1

LOOP_CONNECT_CHANCE = 0.55
LOOP_MIN_GAP = 1
LOOP_MAX_GAP = 6


@dataclass
class _CorridorSeg:
    """Internal collision-detection rect for one leg of a routed corridor."""
    x: int
    y: int
    w: int
    h: int


@dataclass
class Corridor:
    """A corridor connection, as centerline waypoints from the parent
    room's wall to the child room's wall."""
    parent_id: int
    child_id: int
    points: list[tuple[int, int]]

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

def _pick_dims(rng: random.Random, shape: str) -> tuple[int, int]:
    if shape == "rect":
        return rng.randint(ROOM_MIN_DIM, ROOM_MAX_DIM), rng.randint(ROOM_MIN_DIM, ROOM_MAX_DIM)
    d = rng.randint(ROUND_MIN_DIM // 2, ROUND_MAX_DIM // 2) * 2
    return d, d

def _pick_pattern(rng: random.Random) -> list[str]:
    """sides-only / forward-only / both -- roughly watabou's described split."""
    roll = rng.random()
    if roll < 0.25:
        return ["sides"]
    if roll < 0.45:
        return ["forward"]
    return ["sides", "forward"]

def _leaf_ids(rooms: list[RoomNode]) -> set[int]:
    has_children = {r.parent_id for r in rooms if r.parent_id is not None}
    return {r.id for r in rooms if r.id not in has_children}

def _pick_shape(rng: random.Random, weights: tuple[float, float, float]) -> str:
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

def _shared_anchor(parent: RoomNode, child: RoomNode, lo: int, hi: int, axis: str) -> Optional[int]:
    """The perpendicular coordinate a straight bridge between parent and
    child must use. Round/octagon rooms only touch their own box at its
    exact center on this axis; two rects can use any point in the overlap."""
    def center(room: RoomNode) -> int:
        return (room.y + room.h // 2) if axis == "y" else (room.x + room.w // 2)

    p_round, c_round = parent.shape != "rect", child.shape != "rect"
    if p_round and c_round:
        pc, cc = center(parent), center(child)
        return pc if pc == cc and lo <= pc <= hi else None
    if p_round:
        pc = center(parent)
        return pc if lo <= pc <= hi else None
    if c_round:
        cc = center(child)
        return cc if lo <= cc <= hi else None
    return lo + (hi - lo) // 2

def _make_corridor_points(parent: RoomNode, child: RoomNode, direction: str) -> Optional[list[tuple[int, int]]]:
    """Straight centerline bridging the gap left between parent and child."""
    if direction in ("E", "W"):
        lo = max(parent.y, child.y)
        hi = min(parent.y + parent.h, child.y + child.h)
        if hi - lo < MIN_OVERLAP:
            return None
        cy = _shared_anchor(parent, child, lo, hi, "y")
        if cy is None:
            return None
        x0, x1 = (parent.x + parent.w, child.x) if direction == "E" else (child.x + child.w, parent.x)
        if x1 <= x0:
            return None
        return [(x0, cy), (x1, cy)]

    lo = max(parent.x, child.x)
    hi = min(parent.x + parent.w, child.x + child.w)
    if hi - lo < MIN_OVERLAP:
        return None
    cx = _shared_anchor(parent, child, lo, hi, "x")
    if cx is None:
        return None
    y0, y1 = (parent.y + parent.h, child.y) if direction == "S" else (child.y + child.h, parent.y)
    if y1 <= y0:
        return None
    return [(cx, y0), (cx, y1)]


def _bridge(
    a: RoomNode, b: RoomNode, rooms: list[RoomNode], corridor_segs: list[_CorridorSeg], rng: random.Random,
) -> Optional[tuple[RoomNode, RoomNode, list[tuple[int, int]]]]:
    candidates: list[tuple[RoomNode, RoomNode, str]] = []

    lo, hi = max(a.y, b.y), min(a.y + a.h, b.y + b.h)
    if hi - lo >= MIN_OVERLAP:
        if a.x + a.w <= b.x:
            candidates.append((a, b, "E"))
        elif b.x + b.w <= a.x:
            candidates.append((b, a, "E"))

    lo, hi = max(a.x, b.x), min(a.x + a.w, b.x + b.w)
    if hi - lo >= MIN_OVERLAP:
        if a.y + a.h <= b.y:
            candidates.append((a, b, "S"))
        elif b.y + b.h <= a.y:
            candidates.append((b, a, "S"))

    rng.shuffle(candidates)
    for frm, to, direction in candidates:
        points = _make_corridor_points(frm, to, direction)
        if not points:
            continue
        gap = abs(points[1][0] - points[0][0]) + abs(points[1][1] - points[0][1])
        if not (LOOP_MIN_GAP <= gap <= LOOP_MAX_GAP):
            continue
        segs = _segments_from_points(points)
        blocked = any(
            r.id not in (frm.id, to.id) and any(
                rects_overlap(s.x, s.y, s.w, s.h, r.x, r.y, r.w, r.h, margin=1) for s in segs
            )
            for r in rooms
        ) or any(
            rects_overlap(s.x, s.y, s.w, s.h, c.x, c.y, c.w, c.h, margin=1) for s in segs for c in corridor_segs
        )
        if not blocked:
            return frm, to, points
    return None


def _add_loop_corridors(
    rooms: list[RoomNode], corridor_segs: list[_CorridorSeg], corridors: list[Corridor], rng: random.Random,
) -> None:
    leaves = _leaf_ids(rooms)
    by_depth: dict[int, list[RoomNode]] = {}
    for r in rooms:
        if r.id in leaves:
            by_depth.setdefault(r.depth, []).append(r)

    for level_rooms in by_depth.values():
        for i in range(len(level_rooms)):
            for j in range(i + 1, len(level_rooms)):
                if rng.random() > LOOP_CONNECT_CHANCE:
                    continue
                bridged = _bridge(level_rooms[i], level_rooms[j], rooms, corridor_segs, rng)
                if bridged:
                    frm, to, points = bridged
                    corridor_segs.extend(_segments_from_points(points))
                    corridors.append(Corridor(parent_id=frm.id, child_id=to.id, points=points))


def _route_points(a1, b1, a2, b2, rng, vertical_first=False):
    """Waypoints from (a1,b1) to (a2,b2) along the primary axis (x normally,
    y if vertical_first). Straight if the cross-axis already lines up,
    otherwise a single dogleg turn with at least MIN_LEG on each side."""
    if not vertical_first:
        if b1 == b2:
            return [(a1, b1), (a2, b2)]
        lo, hi = min(a1, a2), max(a1, a2)
        if hi - lo < 2 * MIN_LEG:
            return None
        turn = rng.randint(lo + MIN_LEG, hi - MIN_LEG)
        if hi - lo >= 3 * MIN_LEG and rng.random() < CORRIDOR_ZIGZAG_CHANCE:
            mid_b = b1 + (b2 - b1) // 2
            lo2, hi2 = turn + MIN_LEG, hi - MIN_LEG
            if lo2 <= hi2:
                turn2 = rng.randint(lo2, hi2)
                return [(a1, b1), (turn, b1), (turn, mid_b), (turn2, mid_b), (turn2, b2), (a2, b2)]        
        return [(a1, b1), (turn, b1), (turn, b2), (a2, b2)]
    if a1 == a2:
        return [(a1, b1), (a2, b2)]
    lo, hi = min(b1, b2), max(b1, b2)
    if hi - lo < 2 * MIN_LEG:
        return None
    turn = rng.randint(lo + MIN_LEG, hi - MIN_LEG)
    if hi - lo >= 3 * MIN_LEG and rng.random() < CORRIDOR_ZIGZAG_CHANCE:
        mid_a = a1 + (a2 - a1) // 2
        lo2, hi2 = turn + MIN_LEG, hi - MIN_LEG
        if lo2 <= hi2:
            turn2 = rng.randint(lo2, hi2)
            return [(a1, b1), (a1, turn), (mid_a, turn), (mid_a, turn2), (a2, turn2), (a2, b2)]    
    return [(a1, b1), (a1, turn), (a2, turn), (a2, b2)]


def _segments_from_points(points: list[tuple[int, int]]) -> list[_CorridorSeg]:
    """Collision rects for each leg, widened at interior joints by
    CORRIDOR_WIDTH so consecutive legs always overlap by a full cell."""
    segs = []
    last = len(points) - 2
    for i, ((x0, y0), (x1, y1)) in enumerate(zip(points, points[1:])):
        horizontal = y0 == y1
        if horizontal:
            sign = 1 if x1 >= x0 else -1
            sx0 = x0 - (CORRIDOR_WIDTH * sign if i > 0 else 0)
            sx1 = x1 + (CORRIDOR_WIDTH * sign if i < last else 0)
            x, w = min(sx0, sx1), abs(sx1 - sx0)
            y, h = y0, CORRIDOR_WIDTH
        else:
            sign = 1 if y1 >= y0 else -1
            sy0 = y0 - (CORRIDOR_WIDTH * sign if i > 0 else 0)
            sy1 = y1 + (CORRIDOR_WIDTH * sign if i < last else 0)
            y, h = min(sy0, sy1), abs(sy1 - sy0)
            x, w = x0, CORRIDOR_WIDTH
        segs.append(_CorridorSeg(x=x, y=y, w=w, h=h))
    return segs


def _route_corridor(
    parent: RoomNode, direction: str, w: int, h: int, rng: random.Random, child_shape: str = "rect",
) -> Optional[tuple[int, int, list[tuple[int, int]]]]:
    """Pick a reachable child position and the centerline waypoints
    connecting it to `parent`'s `direction` wall."""
    gap = rng.randint(CORRIDOR_MIN_LEN, CORRIDOR_MAX_LEN)
    jog = rng.randint(CORRIDOR_JOG_MIN, CORRIDOR_JOG_MAX) * rng.choice((1, -1)) \
        if rng.random() < CORRIDOR_JOG_CHANCE else 0

    if direction in ("E", "W"):
        if parent.h < 3 or h < 3:
            return None
        if parent.shape != "rect":
            ey = parent.y + parent.h // 2
        else:
            ey = rng.randint(parent.y + 1, parent.y + parent.h - 2)
        ey2 = ey + jog
        if child_shape != "rect":
            cy = ey2 - h // 2
        else:
            cy = ey2 - rng.randint(1, h - 2)
        ex = parent.x + parent.w if direction == "E" else parent.x
        cx_wall = ex + gap if direction == "E" else ex - gap
        cx = cx_wall if direction == "E" else cx_wall - w
        points = _route_points(ex, ey, cx_wall, ey2, rng)
        if not points:
            return None
        return cx, cy, points

    if parent.w < 3 or w < 3:
        return None
    if parent.shape != "rect":
        ex = parent.x + parent.w // 2
    else:
        ex = rng.randint(parent.x + 1, parent.x + parent.w - 2)
    ex2 = ex + jog
    if child_shape != "rect":
        cx = ex2 - w // 2
    else:
        cx = ex2 - rng.randint(1, w - 2)
    ey = parent.y + parent.h if direction == "S" else parent.y
    cy_wall = ey + gap if direction == "S" else ey - gap
    cy = cy_wall if direction == "S" else cy_wall - h
    points = _route_points(ex, ey, ex2, cy_wall, rng, vertical_first=True)
    if not points:
        return None
    return cx, cy, points


def _placement_clear(
    candidate: RoomNode, points: list[tuple[int, int]],
    others: list[RoomNode], corridor_segs: list[_CorridorSeg],
) -> bool:
    if any(rects_overlap(candidate.x, candidate.y, candidate.w, candidate.h, r.x, r.y, r.w, r.h, margin=1) for r in others):
        return False
    if any(rects_overlap(candidate.x, candidate.y, candidate.w, candidate.h, c.x, c.y, c.w, c.h, margin=1) for c in corridor_segs):
        return False
    for seg in _segments_from_points(points):
        if any(rects_overlap(seg.x, seg.y, seg.w, seg.h, r.x, r.y, r.w, r.h, margin=1) for r in others):
            return False
        if any(rects_overlap(seg.x, seg.y, seg.w, seg.h, c.x, c.y, c.w, c.h, margin=1) for c in corridor_segs):
            return False
    return True


def _place_flush(
    parent: RoomNode, direction: str, w: int, h: int, rng: random.Random, next_id: int, shape: str = "rect",
) -> RoomNode:
    """Direct wall-to-wall join, no corridor. A circle/octagon only reaches
    its bounding box at the exact center of that box's edge -- there's no
    valid offset range like a rect has, so either side being round forces
    the join onto that one point."""
    if direction in ("E", "W"):
        x = parent.x + parent.w if direction == "E" else parent.x - w
        if parent.shape != "rect":
            wall_y = parent.y + parent.h // 2
        elif parent.h >= 3:
            wall_y = rng.randint(parent.y + 1, parent.y + parent.h - 2)
        else:
            wall_y = parent.y + parent.h // 2
        y = wall_y - h // 2 if shape != "rect" else wall_y - rng.randint(1, max(1, h - 2))
    else:
        y = parent.y + parent.h if direction == "S" else parent.y - h
        if parent.shape != "rect":
            wall_x = parent.x + parent.w // 2
        elif parent.w >= 3:
            wall_x = rng.randint(parent.x + 1, parent.x + parent.w - 2)
        else:
            wall_x = parent.x + parent.w // 2
        x = wall_x - w // 2 if shape != "rect" else wall_x - rng.randint(1, max(1, w - 2))
    return RoomNode(
        id=next_id, x=x, y=y, w=w, h=h,
        entrance_dir=OPPOSITE[direction], parent_id=parent.id, depth=parent.depth + 1,
        shape=shape,
    )


def _try_spawn_child(
    parent: RoomNode,
    direction: str,
    rooms: list[RoomNode],
    corridor_segs: list[_CorridorSeg],
    rng: random.Random,
    next_id: int,
    shape_weights: tuple[float, float, float],
) -> Optional[tuple[RoomNode, list[tuple[int, int]]]]:
    shape = _pick_shape(rng, shape_weights)
    w, h = _pick_dims(rng, shape)
    others = [r for r in rooms if r.id != parent.id]

    if rng.random() < CORRIDOR_CHANCE:
        for _ in range(PLACEMENT_RETRIES):
            routed = _route_corridor(parent, direction, w, h, rng, child_shape=shape)
            if not routed:
                continue
            cx, cy, points = routed
            candidate = RoomNode(
                id=next_id, x=cx, y=cy, w=w, h=h,
                entrance_dir=OPPOSITE[direction], parent_id=parent.id, depth=parent.depth + 1,
                shape=shape,
            )
            if _placement_clear(candidate, points, others, corridor_segs):
                return candidate, points

    for _ in range(PLACEMENT_RETRIES):
        candidate = _place_flush(parent, direction, w, h, rng, next_id, shape)
        if _placement_clear(candidate, [], others, corridor_segs):
            return candidate, []

    return None

def generate_dungeon(
    seed: str, target_count: int, symmetry_break_pct: int,
    shape_weights: tuple[float, float, float] = (100.0, 0.0, 0.0),
) -> tuple[list[RoomNode], list[Corridor]]:
    rng = make_rng(seed)
    next_id = 0

    root_shape = _pick_shape(rng, shape_weights)
    if root_shape == "rect":
        root_w, root_h = rng.randint(4, 7), rng.randint(4, 7)
    else:
        root_w, root_h = _pick_dims(rng, root_shape)
    root = RoomNode(
        id=next_id,
        x=0, y=0,
        w=root_w, h=root_h,
        entrance_dir=None, parent_id=None, depth=0,
        shape=root_shape,
    )
    next_id += 1

    rooms: list[RoomNode] = [root]
    corridor_segs: list[_CorridorSeg] = []
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

        spawned_any = False
        for direction in kept:
            if len(rooms) >= target_count:
                break
            spawned = _try_spawn_child(parent, direction, rooms, corridor_segs, rng, next_id, shape_weights)
            if spawned:
                child, points = spawned
                next_id += 1
                rooms.append(child)
                frontier.append(child)
                parent.children.append(child.id)
                if points:
                    corridor_segs.extend(_segments_from_points(points))
                    corridors.append(Corridor(parent_id=parent.id, child_id=child.id, points=points))
                spawned_any = True

        if not spawned_any and len(rooms) < target_count:
            for direction in sides + [forward_dir]:
                if direction in kept or len(rooms) >= target_count:
                    continue
                spawned = _try_spawn_child(parent, direction, rooms, corridor_segs, rng, next_id, shape_weights)
                if spawned:
                    child, points = spawned
                    next_id += 1
                    rooms.append(child)
                    frontier.append(child)
                    parent.children.append(child.id)
                    if points:
                        corridor_segs.extend(_segments_from_points(points))
                        corridors.append(Corridor(parent_id=parent.id, child_id=child.id, points=points))
                    break

    _add_loop_corridors(rooms, corridor_segs, corridors, rng)
    return rooms, corridors