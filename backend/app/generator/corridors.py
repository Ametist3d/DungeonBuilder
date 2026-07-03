from __future__ import annotations

import random
from typing import Optional

from .entities import Corridor, CorridorSeg, RoomNode, rects_overlap

# Minimum length of shared wall between parent and child, so a door always
# has somewhere to go later.
MIN_OVERLAP = 2

CORRIDOR_WIDTH = 1
CORRIDOR_CHANCE = 0.55
CORRIDOR_MIN_LEN = 4
CORRIDOR_MAX_LEN = 8
CORRIDOR_JOG_CHANCE = 0.7
CORRIDOR_JOG_MIN = 2
CORRIDOR_JOG_MAX = 3
CORRIDOR_ZIGZAG_CHANCE = 0.8
MIN_LEG = 2

LOOP_CONNECT_CHANCE = 0.75
LOOP_MIN_GAP = 1
LOOP_MAX_GAP = 10

BRANCH_CHANCE = 0.3


def _bridge_to_corridor(
    room: RoomNode, trunk: Corridor, rooms: list[RoomNode], corridor_segs: list[CorridorSeg], rng: random.Random,
) -> Optional[list[tuple[float, float]]]:
    """Short connector from `room`'s wall to a usable point along an
    existing corridor's path -- a T-junction/fork off the trunk, instead
    of another independent room-to-room corridor."""
    candidates: list[tuple[float, float, str]] = []
    pts = trunk.points
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if y0 == y1:  # horizontal leg -- room reaches it vertically
            if room.shape != "rect":
                jx = room.x + room.w / 2
                if not (min(x0, x1) + MIN_LEG <= jx <= max(x0, x1) - MIN_LEG):
                    jx = None
            else:
                # -1 on the room side: jx will be shifted up to +0.5 by
                # center_on_cells (this connector's own width needs grid
                # alignment too), so the pick range must anticipate that or
                # the anchor can land past the room's actual wall
                lo, hi = max(min(x0, x1) + MIN_LEG, room.x), min(max(x0, x1) - MIN_LEG, room.x + room.w - 1)
                jx = None if lo > hi else (int(lo) if lo == hi else rng.randint(int(lo), int(hi)))
            if jx is None:
                continue
            if room.y + room.h <= y0:
                candidates.append((jx, y0, "S"))
            elif room.y >= y0:
                candidates.append((jx, y0, "N"))
        else:  # vertical leg -- room reaches it horizontally
            if room.shape != "rect":
                jy = room.y + room.h / 2
                if not (min(y0, y1) + MIN_LEG <= jy <= max(y0, y1) - MIN_LEG):
                    jy = None
            else:
                lo, hi = max(min(y0, y1) + MIN_LEG, room.y), min(max(y0, y1) - MIN_LEG, room.y + room.h - 1)
                jy = None if lo > hi else (int(lo) if lo == hi else rng.randint(int(lo), int(hi)))
            if jy is None:
                continue
            if room.x + room.w <= x0:
                candidates.append((x0, jy, "E"))
            elif room.x >= x0:
                candidates.append((x0, jy, "W"))

    rng.shuffle(candidates)
    trunk_segs = segments_from_points(trunk.points)
    other_segs = [s for s in corridor_segs if s not in trunk_segs]
    for jx, jy, direction in candidates:
        wall = {
            "S": (jx, room.y + room.h), "N": (jx, room.y),
            "E": (room.x + room.w, jy), "W": (room.x, jy),
        }[direction]
        gap = abs(wall[0] - jx) + abs(wall[1] - jy)
        if not (LOOP_MIN_GAP <= gap <= LOOP_MAX_GAP):
            continue
        points = [(jx, jy), wall]
        segs = segments_from_points(points)
        blocked = any(
            rects_overlap(s.x, s.y, s.w, s.h, r.x, r.y, r.w, r.h, margin=1)
            for s in segs for r in rooms if r.id != room.id
        ) or any(
            rects_overlap(s.x, s.y, s.w, s.h, c.x, c.y, c.w, c.h, margin=1)
            for s in segs for c in other_segs
        )
        if not blocked:
            return center_on_cells(points)
    return None


def add_corridor_branches(
    rooms: list[RoomNode], corridors: list[Corridor], corridor_segs: list[CorridorSeg], rng: random.Random,
) -> None:
    """Lets a room fork off an existing corridor's path instead of always
    needing its own independent route back to a room -- one trunk feeding
    multiple spurs, same as a real branching passage."""
    trunks = list(corridors)  # snapshot -- branches don't themselves grow further branches
    for room in rooms:
        for trunk in trunks:
            if trunk.parent_id == room.id or trunk.child_id == room.id:
                continue
            if rng.random() > BRANCH_CHANCE:
                continue
            points = _bridge_to_corridor(room, trunk, rooms, corridor_segs, rng)
            if points:
                corridor_segs.extend(segments_from_points(points))
                corridors.append(Corridor(
                    parent_id=trunk.parent_id, child_id=room.id,
                    points=points, branches_from_corridor=True,
                ))
                break  # one branch per room is plenty

def _shared_anchor(parent: RoomNode, child: RoomNode, lo: int, hi: int, axis: str) -> Optional[int]:
    """The perpendicular coordinate a straight bridge between parent and
    child must use. Round/octagon rooms only touch their own box at its
    exact center on this axis; two rects can use any point in the overlap."""
    def center(room: RoomNode) -> float:
        return (room.y + room.h / 2) if axis == "y" else (room.x + room.w / 2)

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
        return center_on_cells([(x0, cy), (x1, cy)])

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
    return center_on_cells([(cx, y0), (cx, y1)])

def center_on_cells(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    def snap(v: float) -> float:
        return v if v % 1 else v + 0.5
    pts = [[float(x), float(y)] for x, y in points]
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        if y0 == y1:
            pts[i][1] = pts[i + 1][1] = snap(y0)
        else:
            pts[i][0] = pts[i + 1][0] = snap(x0)
    return [(x, y) for x, y in pts]

def _bridge(
    a: RoomNode, b: RoomNode, rooms: list[RoomNode], corridor_segs: list[CorridorSeg], rng: random.Random,
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
        segs = segments_from_points(points)
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


# def add_loop_corridors(
#     rooms: list[RoomNode], corridor_segs: list[CorridorSeg], corridors: list[Corridor], rng: random.Random,
# ) -> None:
#     """Bridges same-depth leaf rooms where a short, unobstructed connection
#     exists, so the map isn't purely a tree."""
#     leaves = leaf_ids(rooms)
#     by_depth: dict[int, list[RoomNode]] = {}
#     for r in rooms:
#         if r.id in leaves:
#             by_depth.setdefault(r.depth, []).append(r)

#     for level_rooms in by_depth.values():
#         for i in range(len(level_rooms)):
#             for j in range(i + 1, len(level_rooms)):
#                 if rng.random() > LOOP_CONNECT_CHANCE:
#                     continue
#                 bridged = _bridge(level_rooms[i], level_rooms[j], rooms, corridor_segs, rng)
#                 if bridged:
#                     frm, to, points = bridged
#                     corridor_segs.extend(segments_from_points(points))
#                     corridors.append(Corridor(parent_id=frm.id, child_id=to.id, points=points))


def add_loop_corridors(
    rooms: list[RoomNode], corridor_segs: list[CorridorSeg], corridors: list[Corridor], rng: random.Random,
) -> None:
    """Bridges nearby room pairs where a short, unobstructed connection
    exists, so a room isn't limited to a single way in or out. Any pair is
    eligible, not just same-depth leaves -- _bridge's own geometry checks
    (alignment, gap range, collision) already do the real filtering, so
    restricting the candidate pool first was mostly just leaving
    connections on the table."""
    for i in range(len(rooms)):
        for j in range(i + 1, len(rooms)):
            a, b = rooms[i], rooms[j]
            if a.parent_id == b.id or b.parent_id == a.id:
                continue  # already directly joined by the tree
            if rng.random() > LOOP_CONNECT_CHANCE:
                continue
            bridged = _bridge(a, b, rooms, corridor_segs, rng)
            if bridged:
                frm, to, points = bridged
                corridor_segs.extend(segments_from_points(points))
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


def segments_from_points(points: list[tuple[int, int]]) -> list[CorridorSeg]:
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
        segs.append(CorridorSeg(x=x, y=y, w=w, h=h))
    return segs


def route_corridor(
    parent: RoomNode, direction: str, w: int, h: int, rng: random.Random, child_shape: str = "rect",
) -> Optional[tuple[int, int, list[tuple[float, float]]]]:
    """Pick a reachable child position and the centerline waypoints
    connecting it to `parent`'s `direction` wall."""
    gap = rng.randint(CORRIDOR_MIN_LEN, CORRIDOR_MAX_LEN)
    jog = rng.randint(CORRIDOR_JOG_MIN, CORRIDOR_JOG_MAX) * rng.choice((1, -1)) \
        if rng.random() < CORRIDOR_JOG_CHANCE else 0

    if direction in ("E", "W"):
        if parent.h < 3 or h < 3:
            return None
        if parent.shape != "rect":
            ey = parent.y + parent.h / 2
        else:
            ey = rng.randint(parent.y + 1, parent.y + parent.h - 2)
        ey2 = ey + jog
        if child_shape != "rect":
            cy = round(ey2 - h / 2)  # room position must stay an integer
            ey2 = cy + h / 2         # snap arrival row to the child's true center
        else:
            cy = round(ey2) - rng.randint(1, h - 2)  # ey2 may be half-integer if parent is round
        ex = parent.x + parent.w if direction == "E" else parent.x
        cx_wall = ex + gap if direction == "E" else ex - gap
        cx = cx_wall if direction == "E" else cx_wall - w
        points = _route_points(ex, ey, cx_wall, ey2, rng)
        if not points:
            return None
        return cx, cy, center_on_cells(points)

    if parent.w < 3 or w < 3:
        return None
    if parent.shape != "rect":
        ex = parent.x + parent.w / 2
    else:
        ex = rng.randint(parent.x + 1, parent.x + parent.w - 2)
    ex2 = ex + jog
    if child_shape != "rect":
        cx = round(ex2 - w / 2)   # room position must stay an integer
        ex2 = cx + w / 2          # snap arrival column to the child's true center
    else:
        cx = round(ex2) - rng.randint(1, w - 2)  # ex2 may be half-integer if parent is round
    ey = parent.y + parent.h if direction == "S" else parent.y
    cy_wall = ey + gap if direction == "S" else ey - gap
    cy = cy_wall if direction == "S" else cy_wall - h
    points = _route_points(ex, ey, ex2, cy_wall, rng, vertical_first=True)
    if not points:
        return None
    return cx, cy, center_on_cells(points)


def placement_clear(
    candidate: RoomNode, points: list[tuple[int, int]],
    others: list[RoomNode], corridor_segs: list[CorridorSeg],
) -> bool:
    if any(rects_overlap(candidate.x, candidate.y, candidate.w, candidate.h, r.x, r.y, r.w, r.h, margin=1) for r in others):
        return False
    if any(rects_overlap(candidate.x, candidate.y, candidate.w, candidate.h, c.x, c.y, c.w, c.h, margin=1) for c in corridor_segs):
        return False
    for seg in segments_from_points(points):
        if any(rects_overlap(seg.x, seg.y, seg.w, seg.h, r.x, r.y, r.w, r.h, margin=1) for r in others):
            return False
        if any(rects_overlap(seg.x, seg.y, seg.w, seg.h, c.x, c.y, c.w, c.h, margin=1) for c in corridor_segs):
            return False
    return True
