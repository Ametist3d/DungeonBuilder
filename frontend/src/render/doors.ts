import type {Door, Room, Opening } from '../types';
import { NS, UNIT, OPPOSITE, DIR_VECTOR, cellWallCenter, type RenderContext } from './context';

const DOOR_INSET = 5; // px -- how far into the corridor the door glyph sits from the room wall
const DOOR_THICKNESS = 6; // px -- how thick the door glyph is

function doorKey(parentId: number, childId: number, roomId: number): string {
  return `${parentId}-${childId}-${roomId}`;
}

function doorByRoomSide(doors: Door[]): Map<string, Door> {
  return new Map(
    doors.map((door) => [
      door.id || doorKey(door.parentId, door.childId, door.roomId),
      door,
    ])
  );
}

function findDoor(
  doors: Map<string, Door>,
  parentId: number,
  childId: number,
  roomId: number,
): Door | null {
  return doors.get(doorKey(parentId, childId, roomId)) || null;
}

function lockLabel(door: Door): string {
  if (door.lock === 'locked') return 'normal lock';
  if (door.lock === 'puzzleSealed') return 'puzzle mechanism';
  if (door.lock === 'magicSealed') return 'magic scroll seal';
  return 'no lock';
}

function doorTitle(door: Door | null): string {
  if (!door || door.state === 'open') return '';

  const parts = [`${door.material} door`];

  if (door.lock === 'locked') parts.push('normal key lock');
  else if (door.lock === 'puzzleSealed') parts.push('puzzle mechanism lock');
  else if (door.lock === 'magicSealed') parts.push('magic scroll seal');

  if (door.keyName) {
    parts.push(`needs ${door.keyName}`);
  }

  return parts.join(' — ');
}

const DOOR_TOOLTIP_ID = 'door-tooltip';
const DOOR_TOOLTIP_DELAY_MS = 35;

let doorTooltipTimer: number | null = null;

function getDoorTooltip(): HTMLDivElement {
  let el = document.getElementById(DOOR_TOOLTIP_ID) as HTMLDivElement | null;

  if (!el) {
    el = document.createElement('div');
    el.id = DOOR_TOOLTIP_ID;
    el.className = 'door-tooltip';
    document.body.appendChild(el);
  }

  return el;
}

function moveDoorTooltip(e: PointerEvent): void {
  const el = getDoorTooltip();
  const gap = 14;

  el.style.left = `${e.clientX + gap}px`;
  el.style.top = `${e.clientY + gap}px`;

  const rect = el.getBoundingClientRect();

  if (rect.right > window.innerWidth - 8) {
    el.style.left = `${e.clientX - rect.width - gap}px`;
  }

  if (rect.bottom > window.innerHeight - 8) {
    el.style.top = `${e.clientY - rect.height - gap}px`;
  }
}

function showDoorTooltip(e: PointerEvent, text: string): void {
  const content = text.trim();
  if (!content) return;

  if (doorTooltipTimer !== null) {
    window.clearTimeout(doorTooltipTimer);
  }

  doorTooltipTimer = window.setTimeout(() => {
    const el = getDoorTooltip();
    el.textContent = content;
    el.classList.add('visible');
    moveDoorTooltip(e);
  }, DOOR_TOOLTIP_DELAY_MS);
}

function hideDoorTooltip(): void {
  if (doorTooltipTimer !== null) {
    window.clearTimeout(doorTooltipTimer);
    doorTooltipTimer = null;
  }

  getDoorTooltip().classList.remove('visible');
}

function bindDoorTooltip(el: SVGElement, door: Door | null): void {
  const title = doorTitle(door);
  if (!title) return;

  el.addEventListener('pointerenter', (e) => showDoorTooltip(e, title));
  el.addEventListener('pointermove', moveDoorTooltip);
  el.addEventListener('pointerleave', hideDoorTooltip);
}

function drawDoor(
  ctx: RenderContext,
  gx: number,
  gy: number,
  vertical: boolean,
  insetSign: number = 0,
  door: Door | null = null,
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



  const closed = door?.state === 'closed';

  if (closed) {
      const bar = document.createElementNS(NS, 'line');

      if (vertical) {
        bar.setAttribute('x1', String(glyphPx));
        bar.setAttribute('y1', String(glyphPy + DOOR_THICKNESS));
        bar.setAttribute('x2', String(glyphPx));
        bar.setAttribute('y2', String(glyphPy + UNIT - DOOR_THICKNESS));
      } else {
        bar.setAttribute('x1', String(glyphPx + DOOR_THICKNESS));
        bar.setAttribute('y1', String(glyphPy));
        bar.setAttribute('x2', String(glyphPx + UNIT - DOOR_THICKNESS));
        bar.setAttribute('y2', String(glyphPy));
      }

      bar.setAttribute('class', `door-closed-bar door-${door.material} door-${door.lock}`);
      bar.setAttribute('data-door-id', door.id);

      bindDoorTooltip(bar, door);

      svg.appendChild(bar);

      if (door.lock === 'magicSealed' || door.lock === 'puzzleSealed') {
        const seal = document.createElementNS(NS, 'circle');
        seal.setAttribute('cx', String(glyphPx + (vertical ? 0 : UNIT / 2)));
        seal.setAttribute('cy', String(glyphPy + (vertical ? UNIT / 2 : 0)));
        seal.setAttribute('r', '5');
        seal.setAttribute('class', `door-seal door-${door.lock}`);
        seal.setAttribute('data-door-id', door.id);
        bindDoorTooltip(seal, door);
        svg.appendChild(seal);
      }
    }

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

function drawCorridorDoor(
  ctx: RenderContext,
  p0: [number, number],
  p1: [number, number],
  door: Door | null = null,
) {
  const [x0, y0] = p0;
  const [x1, y1] = p1;

  if (y0 === y1) {
    drawDoor(ctx, x0, y0 - 0.5, true, x1 > x0 ? 1 : -1, door);
  } else {
    drawDoor(ctx, x0 - 0.5, y0, false, y1 > y0 ? 1 : -1, door);
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
  const [wx, wy] = cellWallCenter(room, dir);
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

export function renderDoors(
  ctx: RenderContext,
  entrance: Opening | null,
  dungeonExit: Opening | null,
  doors: Door[] = [],
): void {
  const { rooms, corridors, byId, corridorPairs } = ctx;
  const doorMap = doorByRoomSide(doors);

  // every corridor -- tree-grown or a leaf-loop bridge -- gets doors at both mouths
  for (const c of corridors) {
    const pts = c.points;

    if (!c.branchesFromCorridor) {
      drawCorridorDoor(ctx, pts[0], pts[1], findDoor(doorMap, c.parentId, c.childId, c.parentId));
    }

    drawCorridorDoor(ctx, pts[pts.length - 1], pts[pts.length - 2], findDoor(doorMap, c.parentId, c.childId, c.childId));
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
      drawDoor(ctx, dir === 'E' ? parent.x + parent.w : parent.x, Math.floor((lo + hi) / 2), true, 0, null);
    } else {
      const lo = Math.max(parent.x, r.x);
      const hi = Math.min(parent.x + parent.w, r.x + r.w);
      drawDoor(ctx, Math.floor((lo + hi) / 2), dir === 'S' ? parent.y + parent.h : parent.y, false, 0, null);
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
