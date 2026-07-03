import { NS, UNIT, octagonVertices, type RenderContext } from './context';

// Corridors are a constant 1-cell-wide tube, so they need a much smaller
// shadow reach than rooms do or the shadow swallows the whole tube instead
// of reading as a thin inked edge.
const SHADOW_DX_CORRIDOR = 5, SHADOW_DY_CORRIDOR = 5, SHADOW_BLUR_CORRIDOR = 1;

export function renderCorridorFloors(ctx: RenderContext): void {
  const { svg, defs, corridors, toPx, CORRIDOR_PX } = ctx;

  const pathFromPoints = (points: [number, number][]): string =>
    points
      .map(([gx, gy], i) => {
        const [px, py] = toPx(gx, gy);
        return `${i === 0 ? 'M' : 'L'}${px},${py}`;
      })
      .join(' ');

  const extendBranchStart = (points: [number, number][]): [number, number][] => {
    const [x0, y0] = points[0];
    const [x1, y1] = points[1];
    const ext = 0.5; // grid cells -- half the corridor width, so the butt-capped
                      // stroke actually overlaps the trunk instead of ending exactly on its centerline
    if (y0 === y1) {
      const dir = x1 > x0 ? -1 : 1;
      return [[x0 + dir * ext, y0], ...points.slice(1)];
    }
    const dir = y1 > y0 ? -1 : 1;
    return [[x0, y0 + dir * ext], ...points.slice(1)];
  };

  const paths = corridors.map((c) =>
    pathFromPoints(c.branchesFromCorridor ? extendBranchStart(c.points) : c.points)
  );

  // pass 1: every corridor's border, before any floor -- so a branch's
  // border-cap where it meets its trunk always ends up UNDER some floor
  corridors.forEach((c, i) => {
    const border = document.createElementNS(NS, 'path');
    border.setAttribute('d', paths[i]);
    border.setAttribute('class', 'corridor-border');
    border.setAttribute('stroke-width', String(CORRIDOR_PX + 6));
    svg.appendChild(border);
  });

  // pass 2: floors, grouped so a branch shares ONE shadow pass with its
  // trunk instead of each getting its own independently-shadowed shape.
  // Two separately-filtered shapes that happen to overlap is exactly what
  // caused the compounding artifacts at junctions -- grouping them into a
  // single SourceGraphic makes the shared seam interior to the shape, so
  // there's no edge left there for the shadow recipe to gather on.
  const onTrunkPath = (jx: number, jy: number, pts: [number, number][]): boolean => {
    for (let k = 0; k < pts.length - 1; k++) {
      const [x0, y0] = pts[k];
      const [x1, y1] = pts[k + 1];
      if (x0 === x1 && x0 === jx && Math.min(y0, y1) <= jy && jy <= Math.max(y0, y1)) return true;
      if (y0 === y1 && y0 === jy && Math.min(x0, x1) <= jx && jx <= Math.max(x0, x1)) return true;
    }
    return false;
  };

  const groupOf = corridors.map((_, i) => i);
  const find = (i: number): number => (groupOf[i] === i ? i : (groupOf[i] = find(groupOf[i])));
  corridors.forEach((c, i) => {
    if (!c.branchesFromCorridor) return;
    const [jx, jy] = c.points[0];
    const trunkIdx = corridors.findIndex((t, ti) => ti !== i && onTrunkPath(jx, jy, t.points));
    if (trunkIdx >= 0) groupOf[find(i)] = find(trunkIdx);
  });

  const groups = new Map<number, number[]>();
  corridors.forEach((_, i) => {
    const g = find(i);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(i);
  });

  let corridorFilterCounter = 0;
  for (const members of groups.values()) {
    const d = members.map((i) => paths[i]).join(' ');

    let minPx = Infinity, minPy = Infinity, maxPx = -Infinity, maxPy = -Infinity;
    for (const i of members) {
      for (const [gx, gy] of corridors[i].points) {
        const [ppx, ppy] = toPx(gx, gy);
        minPx = Math.min(minPx, ppx); maxPx = Math.max(maxPx, ppx);
        minPy = Math.min(minPy, ppy); maxPy = Math.max(maxPy, ppy);
      }
    }
    const pad = CORRIDOR_PX + 20;
    const filterId = `inset-shadow-corridor-${corridorFilterCounter++}`;
    const corridorFilter = document.createElementNS(NS, 'filter');
    corridorFilter.setAttribute('id', filterId);
    corridorFilter.setAttribute('filterUnits', 'userSpaceOnUse');
    corridorFilter.setAttribute('x', String(minPx - pad));
    corridorFilter.setAttribute('y', String(minPy - pad));
    corridorFilter.setAttribute('width', String(maxPx - minPx + pad * 2));
    corridorFilter.setAttribute('height', String(maxPy - minPy + pad * 2));
    corridorFilter.innerHTML = `
      <feComponentTransfer in="SourceAlpha" result="inverted">
        <feFuncA type="table" tableValues="1 0"/>
      </feComponentTransfer>
      <feGaussianBlur in="inverted" stdDeviation="${SHADOW_BLUR_CORRIDOR}" result="blurred"/>
      <feOffset in="blurred" dx="${SHADOW_DX_CORRIDOR}" dy="${SHADOW_DY_CORRIDOR}" result="offset"/>
      <feFlood flood-color="var(--shadow-color)" flood-opacity="0.6" result="tint"/>
      <feComposite in="tint" in2="offset" operator="in" result="tinted-edge"/>
      <feComposite in="tinted-edge" in2="SourceAlpha" operator="in" result="clipped"/>
      <feMerge>
        <feMergeNode in="SourceGraphic"/>
        <feMergeNode in="clipped"/>
      </feMerge>
    `;
    defs.appendChild(corridorFilter);

    const floor = document.createElementNS(NS, 'path');
    floor.setAttribute('d', d);
    floor.setAttribute('class', 'corridor-floor');
    floor.setAttribute('stroke-width', String(CORRIDOR_PX));
    floor.setAttribute('filter', `url(#${filterId})`);
    svg.appendChild(floor);
  }
}

export function renderRoomFloors(ctx: RenderContext): void {
  const { svg, rooms, toPx } = ctx;

  for (const r of rooms) {
    const [px, py] = toPx(r.x, r.y);
    const w = r.w * UNIT, h = r.h * UNIT;
    const shapeClass = 'room-rect' + (r.parentId === null ? ' root' : '') + (r.accent ? ' accent' : '');

    if (r.shape === 'circle') {
      const cx = px + w / 2, cy = py + h / 2;
      const R = Math.min(w, h) / 2;
      const circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('cx', String(cx));
      circle.setAttribute('cy', String(cy));
      circle.setAttribute('r', String(R));
      circle.setAttribute('class', shapeClass);
      circle.setAttribute('filter', 'url(#inset-shadow)');
      svg.appendChild(circle);
    } else if (r.shape === 'octagon') {
      const cx = px + w / 2, cy = py + h / 2;
      const R = Math.min(w, h) / 2;
      const poly = document.createElementNS(NS, 'polygon');
      poly.setAttribute('points', octagonVertices(cx, cy, R).map(([x, y]) => `${x},${y}`).join(' '));
      poly.setAttribute('class', shapeClass);
      poly.setAttribute('filter', 'url(#inset-shadow)');
      svg.appendChild(poly);
    } else {
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', String(px));
      rect.setAttribute('y', String(py));
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', String(h));
      rect.setAttribute('class', shapeClass);
      rect.setAttribute('filter', 'url(#inset-shadow)');
      svg.appendChild(rect);
    }
  }
}

export function renderFloorGrid(ctx: RenderContext): void {
  const { svg, rooms, corridors, toPx, pxW, pxH, CORRIDOR_PX } = ctx;

  const defs = document.createElementNS(NS, 'defs');
  const clip = document.createElementNS(NS, 'clipPath');
  clip.setAttribute('id', 'floor-clip');

  for (const r of rooms) {
    const [px, py] = toPx(r.x, r.y);
    const w = r.w * UNIT, h = r.h * UNIT;
    if (r.shape === 'circle') {
      const el = document.createElementNS(NS, 'circle');
      el.setAttribute('cx', String(px + w / 2));
      el.setAttribute('cy', String(py + h / 2));
      el.setAttribute('r', String(Math.min(w, h) / 2));
      clip.appendChild(el);
    } else if (r.shape === 'octagon') {
      const el = document.createElementNS(NS, 'polygon');
      el.setAttribute('points', octagonVertices(px + w / 2, py + h / 2, Math.min(w, h) / 2).map(([x, y]) => `${x},${y}`).join(' '));
      clip.appendChild(el);
    } else {
      const el = document.createElementNS(NS, 'rect');
      el.setAttribute('x', String(px));
      el.setAttribute('y', String(py));
      el.setAttribute('width', String(w));
      el.setAttribute('height', String(h));
      clip.appendChild(el);
    }
  }
  for (const c of corridors) {
    for (let i = 0; i < c.points.length - 1; i++) {
      const [gx0, gy0] = c.points[i];
      const [gx1, gy1] = c.points[i + 1];
      const [px0, py0] = toPx(gx0, gy0);
      const [px1, py1] = toPx(gx1, gy1);
      const el = document.createElementNS(NS, 'rect');
      if (gy0 === gy1) {
        el.setAttribute('x', String(Math.min(px0, px1)));
        el.setAttribute('y', String(py0 - CORRIDOR_PX / 2));
        el.setAttribute('width', String(Math.abs(px1 - px0)));
        el.setAttribute('height', String(CORRIDOR_PX));
      } else {
        el.setAttribute('x', String(px0 - CORRIDOR_PX / 2));
        el.setAttribute('y', String(Math.min(py0, py1)));
        el.setAttribute('width', String(CORRIDOR_PX));
        el.setAttribute('height', String(Math.abs(py1 - py0)));
      }
      clip.appendChild(el);
    }
  }
  defs.appendChild(clip);
  svg.appendChild(defs);

  const floorGrid = document.createElementNS(NS, 'g');
  floorGrid.setAttribute('class', 'floor-grid');
  floorGrid.setAttribute('clip-path', 'url(#floor-clip)');
  for (let gx = 0; gx <= pxW; gx += UNIT) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', String(gx));
    line.setAttribute('y1', '0');
    line.setAttribute('x2', String(gx));
    line.setAttribute('y2', String(pxH));
    floorGrid.appendChild(line);
  }
  for (let gy = 0; gy <= pxH; gy += UNIT) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('y1', String(gy));
    line.setAttribute('x2', String(pxW));
    line.setAttribute('y2', String(gy));
    floorGrid.appendChild(line);
  }
  svg.appendChild(floorGrid);
}

export function renderRoomLabels(ctx: RenderContext): void {
  const { svg, rooms, toPx } = ctx;

  for (const r of rooms) {
    const [px, py] = toPx(r.x, r.y);
    const w = r.w * UNIT, h = r.h * UNIT;
    const cx = px + w / 2, cy = py + h / 2;
    const numGroup = document.createElementNS(NS, 'g');
    numGroup.setAttribute('class', 'room-number');
    const badge = document.createElementNS(NS, 'circle');
    badge.setAttribute('cx', String(cx));
    badge.setAttribute('cy', String(cy));
    badge.setAttribute('r', '9');
    numGroup.appendChild(badge);
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', String(cx));
    label.setAttribute('y', String(cy + 4));
    label.setAttribute('text-anchor', 'middle');
    label.textContent = String(r.id);
    numGroup.appendChild(label);
    svg.appendChild(numGroup);
  }
}
