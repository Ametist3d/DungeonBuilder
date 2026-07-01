import type { Room } from './types';

const NS = 'http://www.w3.org/2000/svg';
const OPPOSITE: Record<string, string> = { N: 'S', S: 'N', E: 'W', W: 'E' };
const UNIT = 28;

export function renderDungeon(svg: SVGSVGElement, rooms: Room[]): void {
  svg.innerHTML = '';
  if (rooms.length === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rooms) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  const pad = 2;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  svg.setAttribute('viewBox', `0 0 ${(maxX - minX) * UNIT} ${(maxY - minY) * UNIT}`);

  const toPx = (gx: number, gy: number): [number, number] => [(gx - minX) * UNIT, (gy - minY) * UNIT];
  const byId = new Map<number, Room>();
  rooms.forEach((r) => byId.set(r.id, r));

  for (const r of rooms) {
    const [px, py] = toPx(r.x, r.y);

    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', String(px));
    rect.setAttribute('y', String(py));
    rect.setAttribute('width', String(r.w * UNIT));
    rect.setAttribute('height', String(r.h * UNIT));
    rect.setAttribute('rx', '3');
    rect.setAttribute('class', 'room-rect' + (r.parentId === null ? ' root' : ''));
    svg.appendChild(rect);

    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', String(px + 6));
    label.setAttribute('y', String(py + 14));
    label.setAttribute('class', 'room-label');
    label.textContent = 'R' + r.id;
    svg.appendChild(label);
  }

  for (const r of rooms) {
    if (r.parentId === null || r.entranceDir === null) continue;
    const parent = byId.get(r.parentId);
    if (!parent) continue;

    const dir = OPPOSITE[r.entranceDir];
    const doorRect = document.createElementNS(NS, 'rect');

    if (dir === 'E' || dir === 'W') {
      const lo = Math.max(parent.y, r.y);
      const hi = Math.min(parent.y + parent.h, r.y + r.h);
      const [px, py] = toPx(dir === 'E' ? parent.x + parent.w : parent.x, (lo + hi) / 2 - 0.5);
      doorRect.setAttribute('x', String(px - 2));
      doorRect.setAttribute('y', String(py));
      doorRect.setAttribute('width', '4');
      doorRect.setAttribute('height', String(UNIT));
    } else {
      const lo = Math.max(parent.x, r.x);
      const hi = Math.min(parent.x + parent.w, r.x + r.w);
      const [px, py] = toPx((lo + hi) / 2 - 0.5, dir === 'S' ? parent.y + parent.h : parent.y);
      doorRect.setAttribute('x', String(px));
      doorRect.setAttribute('y', String(py - 2));
      doorRect.setAttribute('width', String(UNIT));
      doorRect.setAttribute('height', '4');
    }
    doorRect.setAttribute('class', 'door');
    svg.appendChild(doorRect);
  }
}
