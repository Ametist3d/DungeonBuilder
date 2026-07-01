import type { Room, Corridor } from './types';

const NS = 'http://www.w3.org/2000/svg';
const OPPOSITE: Record<string, string> = { N: 'S', S: 'N', E: 'W', W: 'E' };
const UNIT = 28;
const CORRIDOR_GRID_WIDTH = 1;
const HATCH_LEN = 5;
const HATCH_GAP = 7;

// Chamfered-square octagon: flat edges land exactly on the bounding box at
// all four cardinal points (tan(22.5°) = √2 − 1), so corridor attachment
// points computed from box edges always meet the actual silhouette.
const octagonVertices = (cx: number, cy: number, R: number): [number, number][] => {
  const m = R * (Math.SQRT2 - 1);
  return [
    [cx - m, cy - R], [cx + m, cy - R],
    [cx + R, cy - m], [cx + R, cy + m],
    [cx + m, cy + R], [cx - m, cy + R],
    [cx - R, cy + m], [cx - R, cy - m],
  ];
};

export function renderDungeon(svg: SVGSVGElement, rooms: Room[], corridors: Corridor[] = []): void {
  svg.innerHTML = '';
  if (rooms.length === 0) return;

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
  const pad = 2;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const pxW = (maxX - minX) * UNIT;
  const pxH = (maxY - minY) * UNIT;
  svg.setAttribute('viewBox', `0 0 ${pxW} ${pxH}`);

  const toPx = (gx: number, gy: number): [number, number] => [(gx - minX) * UNIT, (gy - minY) * UNIT];
  const byId = new Map<number, Room>();
  rooms.forEach((r) => byId.set(r.id, r));
  const corridorPairs = new Set<string>();
  corridors.forEach((c) => corridorPairs.add(`${c.parentId}-${c.childId}`));

  // --- corridors first, so room walls sit visually on top of their mouths ---
  const CORRIDOR_PX = CORRIDOR_GRID_WIDTH * UNIT;
  const pathFromPoints = (points: [number, number][]): string =>
    points
      .map(([gx, gy], i) => {
        const [px, py] = toPx(gx, gy);
        return `${i === 0 ? 'M' : 'L'}${px},${py}`;
      })
      .join(' ');

  for (const c of corridors) {
    const d = pathFromPoints(c.points);

    const border = document.createElementNS(NS, 'path');
    border.setAttribute('d', d);
    border.setAttribute('class', 'corridor-border');
    border.setAttribute('stroke-width', String(CORRIDOR_PX + 6));
    svg.appendChild(border);

    const floor = document.createElementNS(NS, 'path');
    floor.setAttribute('d', d);
    floor.setAttribute('class', 'corridor-floor');
    floor.setAttribute('stroke-width', String(CORRIDOR_PX));
    svg.appendChild(floor);
  }

  // --- rooms + numbered key badges ---
  for (const r of rooms) {
    const [px, py] = toPx(r.x, r.y);
    const w = r.w * UNIT, h = r.h * UNIT;
    const shapeClass = 'room-rect' + (r.parentId === null ? ' root' : '');

    if (r.shape === 'circle') {
      const cx = px + w / 2, cy = py + h / 2;
      const R = Math.min(w, h) / 2;
      const circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('cx', String(cx));
      circle.setAttribute('cy', String(cy));
      circle.setAttribute('r', String(R));
      circle.setAttribute('class', shapeClass);
      svg.appendChild(circle);
    } else if (r.shape === 'octagon') {
      const cx = px + w / 2, cy = py + h / 2;
      const R = Math.min(w, h) / 2;
      const poly = document.createElementNS(NS, 'polygon');
      poly.setAttribute('points', octagonVertices(cx, cy, R).map(([x, y]) => `${x},${y}`).join(' '));
      poly.setAttribute('class', shapeClass);
      svg.appendChild(poly);
    } else {
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', String(px));
      rect.setAttribute('y', String(py));
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', String(h));
      rect.setAttribute('class', shapeClass);
      svg.appendChild(rect);
    }

    const bx = px + 12;
    const by = py + 12;
    const numGroup = document.createElementNS(NS, 'g');
    numGroup.setAttribute('class', 'room-number');
    const badge = document.createElementNS(NS, 'circle');
    badge.setAttribute('cx', String(bx));
    badge.setAttribute('cy', String(by));
    badge.setAttribute('r', '9');
    numGroup.appendChild(badge);
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', String(bx));
    label.setAttribute('y', String(by + 4));
    label.setAttribute('text-anchor', 'middle');
    label.textContent = String(r.id);
    numGroup.appendChild(label);
    svg.appendChild(numGroup);
  }

  // --- "Dyson hatching": short perpendicular ticks along the outside of each wall ---
  const hatchEdge = (x0: number, y0: number, x1: number, y1: number) => {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.round(len / HATCH_GAP));
    const ux = dx / len, uy = dy / len;     // unit vector along the wall
    const nx = -uy, ny = ux;                // unit vector pointing outward
    for (let i = 1; i < steps; i++) {
      const sx = x0 + ux * len * (i / steps);
      const sy = y0 + uy * len * (i / steps);
      const tick = document.createElementNS(NS, 'line');
      tick.setAttribute('x1', String(sx));
      tick.setAttribute('y1', String(sy));
      tick.setAttribute('x2', String(sx + nx * HATCH_LEN));
      tick.setAttribute('y2', String(sy + ny * HATCH_LEN));
      tick.setAttribute('class', 'hatch-tick');
      svg.appendChild(tick);
    }
  };

  for (const r of rooms) {
    const [px, py] = toPx(r.x, r.y);
    const w = r.w * UNIT, h = r.h * UNIT;

    if (r.shape === 'circle') {
      const cx = px + w / 2, cy = py + h / 2;
      const R = Math.min(w, h) / 2;
      const steps = Math.max(8, Math.round((2 * Math.PI * R) / HATCH_GAP));
      for (let i = 0; i < steps; i++) {
        const a = (2 * Math.PI * i) / steps;
        const sx = cx + R * Math.cos(a), sy = cy + R * Math.sin(a);
        const tick = document.createElementNS(NS, 'line');
        tick.setAttribute('x1', String(sx));
        tick.setAttribute('y1', String(sy));
        tick.setAttribute('x2', String(sx + HATCH_LEN * Math.cos(a)));
        tick.setAttribute('y2', String(sy + HATCH_LEN * Math.sin(a)));
        tick.setAttribute('class', 'hatch-tick');
        svg.appendChild(tick);
      }
    } else if (r.shape === 'octagon') {
      const cx = px + w / 2, cy = py + h / 2;
      const R = Math.min(w, h) / 2;
      const pts = octagonVertices(cx, cy, R);
      for (let i = 0; i < 8; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % 8];
        hatchEdge(x0, y0, x1, y1);
      }
    } else {
      hatchEdge(px, py, px + w, py);
      hatchEdge(px + w, py, px + w, py + h);
      hatchEdge(px + w, py + h, px, py + h);
      hatchEdge(px, py + h, px, py);
    }
  }

  // --- door glyph: a gap punched in the wall + a short double-tick across the threshold ---
  const drawDoor = (gx: number, gy: number, vertical: boolean) => {
    const [px, py] = toPx(gx, gy);

    const gap = document.createElementNS(NS, 'rect');
    if (vertical) {
      gap.setAttribute('x', String(px - 6));
      gap.setAttribute('y', String(py));
      gap.setAttribute('width', '12');
      gap.setAttribute('height', String(UNIT));
    } else {
      gap.setAttribute('x', String(px));
      gap.setAttribute('y', String(py - 6));
      gap.setAttribute('width', String(UNIT));
      gap.setAttribute('height', '12');
    }
    gap.setAttribute('class', 'door-gap');
    svg.appendChild(gap);

    const makeTick = (offset: number) => {
      const t = document.createElementNS(NS, 'line');
      if (vertical) {
        t.setAttribute('x1', String(px - 5));
        t.setAttribute('y1', String(py + UNIT / 2 + offset));
        t.setAttribute('x2', String(px + 5));
        t.setAttribute('y2', String(py + UNIT / 2 + offset));
      } else {
        t.setAttribute('x1', String(px + UNIT / 2 + offset));
        t.setAttribute('y1', String(py - 5));
        t.setAttribute('x2', String(px + UNIT / 2 + offset));
        t.setAttribute('y2', String(py + 5));
      }
      t.setAttribute('class', 'door-tick');
      svg.appendChild(t);
    };
    makeTick(-2);
    makeTick(2);
  };

  // --- compass rose ---
  const compass = document.createElementNS(NS, 'g');
  compass.setAttribute('class', 'compass-rose');
  compass.setAttribute('transform', `translate(${pxW - 40}, 40)`);
  const needle = document.createElementNS(NS, 'path');
  needle.setAttribute('d', 'M0,-16 L5,2 L0,-3 L-5,2 Z');
  compass.appendChild(needle);
  const ring = document.createElementNS(NS, 'circle');
  ring.setAttribute('r', '18');
  compass.appendChild(ring);
  const nLabel = document.createElementNS(NS, 'text');
  nLabel.setAttribute('y', '-22');
  nLabel.setAttribute('text-anchor', 'middle');
  nLabel.textContent = 'N';
  compass.appendChild(nLabel);
  svg.appendChild(compass);

  // --- scale bar ---
  const scale = document.createElementNS(NS, 'g');
  scale.setAttribute('class', 'scale-bar');
  scale.setAttribute('transform', `translate(20, ${pxH - 24})`);
  const bar = document.createElementNS(NS, 'rect');
  bar.setAttribute('width', String(UNIT));
  bar.setAttribute('height', '4');
  scale.appendChild(bar);
  const scaleLabel = document.createElementNS(NS, 'text');
  scaleLabel.setAttribute('y', '-4');
  scaleLabel.textContent = '5 ft';
  scale.appendChild(scaleLabel);
  svg.appendChild(scale);

  // --- doors: every corridor -- tree-grown or a leaf-loop bridge -- gets doors at both mouths ---
  const drawCorridorDoor = (p0: [number, number], p1: [number, number]) => {
    const [x0, y0] = p0;
    const [x1, y1] = p1;
    if (y0 === y1) {
      drawDoor(x0, y0 - 0.5, true);   // travel is E/W -- pierces a vertical wall
    } else {
      drawDoor(x0 - 0.5, y0, false);  // travel is N/S -- pierces a horizontal wall
    }
  };

  for (const c of corridors) {
    const pts = c.points;
    drawCorridorDoor(pts[0], pts[1]);
    drawCorridorDoor(pts[pts.length - 1], pts[pts.length - 2]);
  }

  // --- rooms directly flush against their tree parent (no corridor) get one door each ---
  for (const r of rooms) {
    if (r.parentId === null || r.entranceDir === null) continue;
    if (corridorPairs.has(`${r.parentId}-${r.id}`)) continue;
    const parent = byId.get(r.parentId);
    if (!parent) continue;
    const dir = OPPOSITE[r.entranceDir];
    if (dir === 'E' || dir === 'W') {
      const lo = Math.max(parent.y, r.y);
      const hi = Math.min(parent.y + parent.h, r.y + r.h);
      drawDoor(dir === 'E' ? parent.x + parent.w : parent.x, (lo + hi) / 2 - 0.5, true);
    } else {
      const lo = Math.max(parent.x, r.x);
      const hi = Math.min(parent.x + parent.w, r.x + r.w);
      drawDoor((lo + hi) / 2 - 0.5, dir === 'S' ? parent.y + parent.h : parent.y, false);
    }
  }
}
