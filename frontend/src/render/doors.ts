import type { Corridor, Room, Opening } from '../types';
import { NS, UNIT, OPPOSITE, DIR_VECTOR, wallCenter, type RenderContext } from './context';

const DOOR_INSET = 5; // px -- how far into the corridor the door glyph sits from the room wall
const DOOR_THICKNESS = 6; // px -- how thick the door glyph is

function drawDoor(
  ctx: RenderContext,
  gx: number,
  gy: number,
  vertical: boolean,
  insetSign: number = 0,
  closed = false,
) {
  const { svg, toPx } = ctx;
  const [wallPx, wallPy] = toPx(gx, gy);
  const glyphPx = vertical ? wallPx + insetSign * DOOR_INSET : wallPx;
  const glyphPy = vertical ? wallPy : wallPy + insetSign * DOOR_INSET;

  const gap = document.createElementNS(NS, 'rect');
  if (vertical) {
    // travel is along x -- pad always lands on the into-corridor side now,
    // not just whichever side happens to be numerically larger
    const farEdge = glyphPx + insetSign * DOOR_THICKNESS;
    const lo = Math.min(wallPx, farEdge) - (insetSign === 0 ? DOOR_THICKNESS : 0);
    const hi = Math.max(wallPx, farEdge) + (insetSign === 0 ? DOOR_THICKNESS : 0);
    gap.setAttribute('x', String(lo));
    gap.setAttribute('y', String(wallPy));
    gap.setAttribute('width', String(hi - lo));
    gap.setAttribute('height', String(UNIT));
  } else {
    const farEdge = glyphPy + insetSign * DOOR_THICKNESS;
    const lo = Math.min(wallPy, farEdge) - (insetSign === 0 ? DOOR_THICKNESS : 0);
    const hi = Math.max(wallPy, farEdge) + (insetSign === 0 ? DOOR_THICKNESS : 0);
    gap.setAttribute('x', String(wallPx));
    gap.setAttribute('y', String(lo));
    gap.setAttribute('width', String(UNIT));
    gap.setAttribute('height', String(hi - lo));
  }
  gap.setAttribute('class', 'door-gap');
  svg.appendChild(gap);

  const frame = document.createElementNS(NS, 'rect');
  if (vertical) {
    frame.setAttribute('x', String(glyphPx - DOOR_THICKNESS));
    frame.setAttribute('y', String(glyphPy));
    frame.setAttribute('width', '12');
    frame.setAttribute('height', String(UNIT));
  } else {
    frame.setAttribute('x', String(glyphPx));
    frame.setAttribute('y', String(glyphPy - DOOR_THICKNESS));
    frame.setAttribute('width', String(UNIT));
    frame.setAttribute('height', '12');
  }
  frame.setAttribute('class', 'door-frame');
  svg.appendChild(frame);

  if (closed) {
    const bar = document.createElementNS(NS, 'line');

    if (vertical) {
      bar.setAttribute('x1', String(glyphPx));
      bar.setAttribute('y1', String(glyphPy + 3));
      bar.setAttribute('x2', String(glyphPx));
      bar.setAttribute('y2', String(glyphPy + UNIT - 3));
    } else {
      bar.setAttribute('x1', String(glyphPx + 3));
      bar.setAttribute('y1', String(glyphPy));
      bar.setAttribute('x2', String(glyphPx + UNIT - 3));
      bar.setAttribute('y2', String(glyphPy));
    }

    bar.setAttribute('class', 'door-closed-bar');
    svg.appendChild(bar);
  }

  // const makeTick = (offset: number) => {
  //   const t = document.createElementNS(NS, 'line');
  //   if (vertical) {
  //     t.setAttribute('x1', String(glyphPx - DOOR_THICKNESS*2));
  //     t.setAttribute('y1', String(glyphPy + UNIT / 2 + offset));
  //     t.setAttribute('x2', String(glyphPx + DOOR_THICKNESS));
  //     t.setAttribute('y2', String(glyphPy + UNIT / 2 + offset));
  //   } else {
  //     t.setAttribute('x1', String(glyphPx + UNIT / 2 + offset));
  //     t.setAttribute('y1', String(glyphPy - DOOR_THICKNESS));
  //     t.setAttribute('x2', String(glyphPx + UNIT / 2 + offset));
  //     t.setAttribute('y2', String(glyphPy + DOOR_THICKNESS));
  //   }
  //   t.setAttribute('class', 'door-tick');
  //   svg.appendChild(t);
  // };
  // makeTick(-2);
  // makeTick(2);
}

// function drawJunctionPatch(ctx: RenderContext, gx: number, gy: number) {
//   const { svg, toPx } = ctx;
//   const [px, py] = toPx(gx, gy);
//   const patch = document.createElementNS(NS, 'rect');
//   patch.setAttribute('x', String(px - UNIT / 2));
//   patch.setAttribute('y', String(py - UNIT / 2));
//   patch.setAttribute('width', String(UNIT));
//   patch.setAttribute('height', String(UNIT));
//   patch.setAttribute('class', 'door-gap');
//   svg.appendChild(patch);
// }

function drawCorridorDoor(
  ctx: RenderContext,
  p0: [number, number],
  p1: [number, number],
  closed = false,
) {
  const [x0, y0] = p0;
  const [x1, y1] = p1;

  if (y0 === y1) {
    drawDoor(ctx, x0, y0 - 0.5, true, x1 > x0 ? 1 : -1, closed);
  } else {
    drawDoor(ctx, x0 - 0.5, y0, false, y1 > y0 ? 1 : -1, closed);
  }
}

// --- entrance / exit openings ---
const OPENING_GAP = 4;         // px between the wall and the near edge of the arrow glyph
const OPENING_ARROW_LEN = 11;  // px, tip-to-base length of the triangle
const OPENING_ARROW_WIDTH = 7; // px, half-width of the triangle's base
const OPENING_LABEL_GAP = 7;   // px between the glyph's outer edge and the label

function drawOpening(ctx: RenderContext, room: Room, dir: string, label: string, arrowInward: boolean) {
  const { svg, toPx } = ctx;
  const vertical = dir === 'E' || dir === 'W';
  const [wx, wy] = wallCenter(room, dir);
  if (vertical) {
    drawDoor(ctx, wx, wy - 0.5, true);
  } else {
    drawDoor(ctx, wx - 0.5, wy, false);
  }

  const [dirX, dirY] = DIR_VECTOR[dir]; // unit vector pointing outward, away from the room
  const [px0, py0] = toPx(wx, wy);

  // near/far ends of the glyph, both measured outward from the wall --
  // which end is the tip vs. the base depends on which way it should point
  const nearX = px0 + dirX * OPENING_GAP, nearY = py0 + dirY * OPENING_GAP;
  const farX = px0 + dirX * (OPENING_GAP + OPENING_ARROW_LEN);
  const farY = py0 + dirY * (OPENING_GAP + OPENING_ARROW_LEN);

  const [tipX, tipY] = arrowInward ? [nearX, nearY] : [farX, farY];
  const [baseX, baseY] = arrowInward ? [farX, farY] : [nearX, nearY];

  const leftX = baseX - dirY * OPENING_ARROW_WIDTH, leftY = baseY + dirX * OPENING_ARROW_WIDTH;
  const rightX = baseX + dirY * OPENING_ARROW_WIDTH, rightY = baseY - dirX * OPENING_ARROW_WIDTH;
  const arrow = document.createElementNS(NS, 'polygon');
  arrow.setAttribute('points', `${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`);
  arrow.setAttribute('class', 'opening-arrow');
  svg.appendChild(arrow);

  const text = document.createElementNS(NS, 'text');
  text.setAttribute('x', String(farX + dirX * OPENING_LABEL_GAP));
  text.setAttribute('y', String(farY + dirY * OPENING_LABEL_GAP + DOOR_THICKNESS));
  text.setAttribute('text-anchor', vertical ? 'start' : 'middle');
  if (vertical && dirX < 0) text.setAttribute('text-anchor', 'end');
  text.setAttribute('class', 'opening-label');
  text.textContent = label;
  svg.appendChild(text);
}

function closedRoomSideDoors(rooms: Room[], corridors: Corridor[]): Set<string> {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const incomingByRoom = new Map<number, Corridor[]>();

  for (const corridor of corridors) {
    const from = byId.get(corridor.parentId);
    const to = byId.get(corridor.childId);
    if (!from || !to) continue;

    if (from.depth < to.depth) {
      const list = incomingByRoom.get(to.id) || [];
      list.push(corridor);
      incomingByRoom.set(to.id, list);
    }

    if (to.depth < from.depth) {
      const list = incomingByRoom.get(from.id) || [];
      list.push(corridor);
      incomingByRoom.set(from.id, list);
    }
  }

  const closed = new Set<string>();

  for (const [roomId, incoming] of incomingByRoom) {
    if (incoming.length <= 1) continue;

    for (const corridor of incoming) {
      closed.add(`${corridor.parentId}-${corridor.childId}-${roomId}`);
    }
  }

  return closed;
}

function isClosedAtRoom(corridor: Corridor, roomId: number, closed: Set<string>): boolean {
  return closed.has(`${corridor.parentId}-${corridor.childId}-${roomId}`);
}

export function renderDoors(
  ctx: RenderContext,
  entrance: Opening | null,
  dungeonExit: Opening | null,
): void {
  const { rooms, corridors, byId, corridorPairs } = ctx;
  const closedDoors = closedRoomSideDoors(rooms, corridors);

  // every corridor -- tree-grown or a leaf-loop bridge -- gets doors at both mouths
  for (const c of corridors) {
    const pts = c.points;

    if (!c.branchesFromCorridor) {
      drawCorridorDoor(ctx, pts[0], pts[1], isClosedAtRoom(c, c.parentId, closedDoors));
    }

    drawCorridorDoor(
      ctx,
      pts[pts.length - 1],
      pts[pts.length - 2],
      isClosedAtRoom(c, c.childId, closedDoors),
    );
  }

  // rooms directly flush against their tree parent (no corridor) get one door each
  for (const r of rooms) {
    if (r.parentId === null || r.entranceDir === null) continue;
    if (corridorPairs.has(`${r.parentId}-${r.id}`) || corridorPairs.has(`${r.id}-${r.parentId}`)) continue;
    const parent = byId.get(r.parentId);
    if (!parent) continue;
    const dir = OPPOSITE[r.entranceDir];
    if (dir === 'E' || dir === 'W') {
      const lo = Math.max(parent.y, r.y);
      const hi = Math.min(parent.y + parent.h, r.y + r.h);
      drawDoor(ctx, dir === 'E' ? parent.x + parent.w : parent.x, Math.floor((lo + hi) / 2), true, 0, false);
    } else {
      const lo = Math.max(parent.x, r.x);
      const hi = Math.min(parent.x + parent.w, r.x + r.w);
      drawDoor(ctx, Math.floor((lo + hi) / 2), dir === 'S' ? parent.y + parent.h : parent.y, false, 0, false);
    }
  }

  if (entrance) {
    const room = byId.get(entrance.roomId);
    if (room) drawOpening(ctx, room, entrance.direction, 'IN', true);
  }
  if (dungeonExit) {
    const room = byId.get(dungeonExit.roomId);
    if (room) drawOpening(ctx, room, dungeonExit.direction, 'OUT', false);
  }
}
