import type { Room, Corridor, Opening } from '../types';

export const NS = 'http://www.w3.org/2000/svg';
export const UNIT = 28;
export const CORRIDOR_GRID_WIDTH = 1;

export const OPPOSITE: Record<string, string> = { N: 'S', S: 'N', E: 'W', W: 'E' };
export const DIR_VECTOR: Record<string, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

export const wallCenter = (r: Room, dir: string): [number, number] => {
  switch (dir) {
    case 'N': return [r.x + r.w / 2, r.y];
    case 'S': return [r.x + r.w / 2, r.y + r.h];
    case 'E': return [r.x + r.w, r.y + r.h / 2];
    default: return [r.x, r.y + r.h / 2]; // W
  }
};

// Chamfered-square octagon: flat edges land exactly on the bounding box at
// all four cardinal points (tan(22.5°) = √2 − 1), so corridor attachment
// points computed from box edges always meet the actual silhouette.
export const octagonVertices = (cx: number, cy: number, R: number): [number, number][] => {
  const m = R * (Math.SQRT2 - 1);
  return [
    [cx - m, cy - R], [cx + m, cy - R],
    [cx + R, cy - m], [cx + R, cy + m],
    [cx + m, cy + R], [cx - m, cy + R],
    [cx - R, cy + m], [cx - R, cy - m],
  ];
};

export interface RenderContext {
  svg: SVGSVGElement;
  defs: SVGDefsElement;
  rooms: Room[];
  corridors: Corridor[];
  byId: Map<number, Room>;
  corridorPairs: Set<string>;
  toPx: (gx: number, gy: number) => [number, number];
  pxW: number;
  pxH: number;
  CORRIDOR_PX: number;
}

export function buildRenderContext(
  svg: SVGSVGElement,
  rooms: Room[],
  corridors: Corridor[],
  entrance: Opening | null,
  dungeonExit: Opening | null,
  padCells = 2,
): RenderContext {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rooms) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  for (const c of corridors) {
    for (const [px, py] of c.points) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
  }

  for (const opening of [entrance, dungeonExit]) {
    if (!opening) continue;
    const room = rooms.find((r) => r.id === opening.roomId);
    if (!room) continue;
    const [wx, wy] = wallCenter(room, opening.direction);
    const [nx, ny] = DIR_VECTOR[opening.direction];
    const tx = wx + nx * 2, ty = wy + ny * 2; // small margin for the arrow + label
    minX = Math.min(minX, wx, tx);
    minY = Math.min(minY, wy, ty);
    maxX = Math.max(maxX, wx, tx);
    maxY = Math.max(maxY, wy, ty);
  }

  const pad = padCells;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const pxW = (maxX - minX) * UNIT;
  const pxH = (maxY - minY) * UNIT;
  svg.setAttribute('viewBox', `0 0 ${pxW} ${pxH}`);

  const toPx = (gx: number, gy: number): [number, number] => [(gx - minX) * UNIT, (gy - minY) * UNIT];
  const byId = new Map<number, Room>();
  rooms.forEach((r) => byId.set(r.id, r));
  const corridorPairs = new Set<string>();
  corridors.forEach((c) => corridorPairs.add(`${c.parentId}-${c.childId}`));

  const defs = document.createElementNS(NS, 'defs') as SVGDefsElement;
  svg.appendChild(defs);

  return {
    svg, defs, rooms, corridors, byId, corridorPairs, toPx, pxW, pxH,
    CORRIDOR_PX: CORRIDOR_GRID_WIDTH * UNIT,
  };
}
