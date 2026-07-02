import type { Room, Corridor, Opening } from './types';

const NS = 'http://www.w3.org/2000/svg';
const OPPOSITE: Record<string, string> = { N: 'S', S: 'N', E: 'W', W: 'E' };
const UNIT = 28;
const CORRIDOR_GRID_WIDTH = 1;
const HATCH_LEN = 5;
const HATCH_GAP = 7;

const DIR_VECTOR: Record<string, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

const wallCenter = (r: Room, dir: string): [number, number] => {
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
const octagonVertices = (cx: number, cy: number, R: number): [number, number][] => {
  const m = R * (Math.SQRT2 - 1);
  return [
    [cx - m, cy - R], [cx + m, cy - R],
    [cx + R, cy - m], [cx + R, cy + m],
    [cx + m, cy + R], [cx - m, cy + R],
    [cx - R, cy + m], [cx - R, cy - m],
  ];
};

export function renderDungeon(
  svg: SVGSVGElement,
  rooms: Room[],
  corridors: Corridor[] = [],
  entrance: Opening | null = null,
  dungeonExit: Opening | null = null,
): void {
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

  for (const opening of [entrance, dungeonExit]) {
    if (!opening) continue;
    const room = rooms.find((r) => r.id === opening.roomId);
    if (!room) continue;
    const [wx, wy] = wallCenter(room, opening.direction);
    const [nx, ny] = DIR_VECTOR[opening.direction];
    // const tx = wx + nx * OPENING_STUB_LEN, ty = wy + ny * OPENING_STUB_LEN;
    const tx = wx + nx * 2, ty = wy + ny * 2; // small margin for the arrow + label
    minX = Math.min(minX, wx, tx);
    minY = Math.min(minY, wy, ty);
    maxX = Math.max(maxX, wx, tx);
    maxY = Math.max(maxY, wy, ty);
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

  const CORRIDOR_PX = CORRIDOR_GRID_WIDTH * UNIT;

  // Builds fresh copies of every room + corridor-leg silhouette, filled solid.
  // Used for the drop-shadow and the exterior-halo mask -- both need the same
  // "footprint" geometry but as independent DOM elements (SVG nodes can't be
  // shared across two parents), so this is called once per use.
  const buildFloorUnionShapes = (fill: string): SVGElement[] => {
    const shapes: SVGElement[] = [];
    for (const r of rooms) {
      const [px, py] = toPx(r.x, r.y);
      const w = r.w * UNIT, h = r.h * UNIT;
      let el: SVGElement;
      if (r.shape === 'circle') {
        el = document.createElementNS(NS, 'circle');
        el.setAttribute('cx', String(px + w / 2));
        el.setAttribute('cy', String(py + h / 2));
        el.setAttribute('r', String(Math.min(w, h) / 2));
      } else if (r.shape === 'octagon') {
        el = document.createElementNS(NS, 'polygon');
        el.setAttribute('points', octagonVertices(px + w / 2, py + h / 2, Math.min(w, h) / 2).map(([x, y]) => `${x},${y}`).join(' '));
      } else {
        el = document.createElementNS(NS, 'rect');
        el.setAttribute('x', String(px));
        el.setAttribute('y', String(py));
        el.setAttribute('width', String(w));
        el.setAttribute('height', String(h));
      }
      el.setAttribute('fill', fill);
      shapes.push(el);
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
        el.setAttribute('fill', fill);
        shapes.push(el);
      }
    }
    return shapes;
  };

  const earlyDefs = document.createElementNS(NS, 'defs');
  svg.appendChild(earlyDefs);

  // --- inset shadow: light from the top-left, so shadow gathers along each
  // shape's bottom-right *inner* edge. Classic SVG inset-shadow recipe --
  // invert+blur+offset the shape's own alpha, clip that back to the shape,
  // then merge over the original so nothing spills past the wall.
  const SHADOW_DX = 5, SHADOW_DY = 5, SHADOW_BLUR = 1;
  const insetFilter = document.createElementNS(NS, 'filter');
  insetFilter.setAttribute('id', 'inset-shadow');
  insetFilter.setAttribute('x', '-25%');
  insetFilter.setAttribute('y', '-25%');
  insetFilter.setAttribute('width', '150%');
  insetFilter.setAttribute('height', '150%');
  insetFilter.innerHTML = `
    <feComponentTransfer in="SourceAlpha" result="inverted">
      <feFuncA type="table" tableValues="1 0"/>
    </feComponentTransfer>
    <feGaussianBlur in="inverted" stdDeviation="${SHADOW_BLUR}" result="blurred"/>
    <feOffset in="blurred" dx="${SHADOW_DX}" dy="${SHADOW_DY}" result="offset"/>
    <feFlood flood-color="var(--shadow-color)" flood-opacity="0.4" result="tint"/>
    <feComposite in="tint" in2="offset" operator="in" result="tinted-edge"/>
    <feComposite in="tinted-edge" in2="SourceAlpha" operator="in" result="clipped"/>
    <feMerge>
      <feMergeNode in="SourceGraphic"/>
      <feMergeNode in="clipped"/>
    </feMerge>
  `;
  earlyDefs.appendChild(insetFilter);

  // --- exterior rubble halo: a stippled texture band just outside the
  // walls. Built by dilating the floor silhouette and subtracting the
  // original, leaving only the ring beyond the walls, then filling that
  // ring with a tiled rubble pattern. NOTE: feMorphology (the dilate) is
  // broadly supported but can be slow on very large maps -- shrink
  // HALO_RADIUS or drop this layer entirely if regeneration feels sluggish.
  const HALO_RADIUS = 9;
  const haloFilter = document.createElementNS(NS, 'filter');
  haloFilter.setAttribute('id', 'halo-dilate');
  haloFilter.setAttribute('x', '-20%');
  haloFilter.setAttribute('y', '-20%');
  haloFilter.setAttribute('width', '140%');
  haloFilter.setAttribute('height', '140%');
  haloFilter.setAttribute('primitiveUnits', 'userSpaceOnUse');
  const dilateOp = document.createElementNS(NS, 'feMorphology');
  dilateOp.setAttribute('in', 'SourceGraphic');
  dilateOp.setAttribute('operator', 'dilate');
  dilateOp.setAttribute('radius', String(HALO_RADIUS));
  dilateOp.setAttribute('result', 'dilated');
  haloFilter.appendChild(dilateOp);
  const subtractOp = document.createElementNS(NS, 'feComposite');
  subtractOp.setAttribute('in', 'dilated');
  subtractOp.setAttribute('in2', 'SourceGraphic');
  subtractOp.setAttribute('operator', 'out');
  haloFilter.appendChild(subtractOp);
  earlyDefs.appendChild(haloFilter);

  const rubblePattern = document.createElementNS(NS, 'pattern');
  rubblePattern.setAttribute('id', 'rubble-pattern');
  rubblePattern.setAttribute('width', '20');
  rubblePattern.setAttribute('height', '14');
  rubblePattern.setAttribute('patternUnits', 'userSpaceOnUse');
  rubblePattern.setAttribute('patternTransform', 'rotate(9)');
  rubblePattern.innerHTML =
    '<rect width="22" height="14" class="rubble-bg"/>' +
    '<path d="M-2,4 Q3.5,0 9,4 T20,4 T31,4" class="rubble-wave"/>' +
    '<path d="M-2,10 Q3.5,6 9,10 T20,10 T31,10" class="rubble-wave"/>';
  earlyDefs.appendChild(rubblePattern);

  const haloMask = document.createElementNS(NS, 'mask');
  haloMask.setAttribute('id', 'halo-mask');
  haloMask.setAttribute('maskUnits', 'userSpaceOnUse');
  haloMask.setAttribute('x', '0');
  haloMask.setAttribute('y', '0');
  haloMask.setAttribute('width', String(pxW));
  haloMask.setAttribute('height', String(pxH));
  const haloMaskGroup = document.createElementNS(NS, 'g');
  haloMaskGroup.setAttribute('filter', 'url(#halo-dilate)');
  buildFloorUnionShapes('white').forEach((el) => haloMaskGroup.appendChild(el));
  haloMask.appendChild(haloMaskGroup);
  earlyDefs.appendChild(haloMask);

  const rubbleRect = document.createElementNS(NS, 'rect');
  rubbleRect.setAttribute('x', '0');
  rubbleRect.setAttribute('y', '0');
  rubbleRect.setAttribute('width', String(pxW));
  rubbleRect.setAttribute('height', String(pxH));
  rubbleRect.setAttribute('fill', 'url(#rubble-pattern)');
  rubbleRect.setAttribute('mask', 'url(#halo-mask)');
  svg.appendChild(rubbleRect);

  
  // --- corridors first, so room walls sit visually on top of their mouths ---
  // const CORRIDOR_PX = CORRIDOR_GRID_WIDTH * UNIT;
  const pathFromPoints = (points: [number, number][]): string =>
    points
      .map(([gx, gy], i) => {
        const [px, py] = toPx(gx, gy);
        return `${i === 0 ? 'M' : 'L'}${px},${py}`;
      })
      .join(' ');

  let corridorFilterCounter = 0;

  for (const c of corridors) {
    const d = pathFromPoints(c.points);

    const border = document.createElementNS(NS, 'path');
    border.setAttribute('d', d);
    border.setAttribute('class', 'corridor-border');
    border.setAttribute('stroke-width', String(CORRIDOR_PX + 6));
    svg.appendChild(border);

    // per-corridor filter region: objectBoundingBox collapses to zero
    // width or height on a perfectly straight leg (getBBox ignores stroke
    // width), which some browsers render as an opaque fallback rect
    // instead of silently skipping the effect. Computing the region
    // manually in userSpaceOnUse sidesteps that entirely.
    let minPx = Infinity, minPy = Infinity, maxPx = -Infinity, maxPy = -Infinity;
    for (const [gx, gy] of c.points) {
      const [ppx, ppy] = toPx(gx, gy);
      minPx = Math.min(minPx, ppx); maxPx = Math.max(maxPx, ppx);
      minPy = Math.min(minPy, ppy); maxPy = Math.max(maxPy, ppy);
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
    corridorFilter.innerHTML = insetFilter.innerHTML; // reuse the same shadow recipe
    earlyDefs.appendChild(corridorFilter);

    const floor = document.createElementNS(NS, 'path');
    floor.setAttribute('d', d);
    floor.setAttribute('class', 'corridor-floor');
    floor.setAttribute('stroke-width', String(CORRIDOR_PX));
    floor.setAttribute('filter', 'url(#inset-shadow)');
    floor.setAttribute('filter', `url(#${filterId})`);
    svg.appendChild(floor);

  }

  // --- room floor shapes ---
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

  // --- floor grid: dashed reference grid, same UNIT scale as everything else,
  // clipped to only show where there's actual floor (rooms + corridors) ---
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
  const CORRIDOR_PX_CLIP = CORRIDOR_GRID_WIDTH * UNIT;
  for (const c of corridors) {
    for (let i = 0; i < c.points.length - 1; i++) {
      const [gx0, gy0] = c.points[i];
      const [gx1, gy1] = c.points[i + 1];
      const [px0, py0] = toPx(gx0, gy0);
      const [px1, py1] = toPx(gx1, gy1);
      const el = document.createElementNS(NS, 'rect');
      if (gy0 === gy1) {
        el.setAttribute('x', String(Math.min(px0, px1)));
        el.setAttribute('y', String(py0 - CORRIDOR_PX_CLIP / 2));
        el.setAttribute('width', String(Math.abs(px1 - px0)));
        el.setAttribute('height', String(CORRIDOR_PX_CLIP));
      } else {
        el.setAttribute('x', String(px0 - CORRIDOR_PX_CLIP / 2));
        el.setAttribute('y', String(Math.min(py0, py1)));
        el.setAttribute('width', String(CORRIDOR_PX_CLIP));
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

  // --- room number badges, centered ---
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
        tick.setAttribute('x2', String(sx - HATCH_LEN * Math.cos(a)));
        tick.setAttribute('y2', String(sy - HATCH_LEN * Math.sin(a)));
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
  const DOOR_INSET = 5; // px -- how far into the corridor the door glyph sits from the room wall

  const drawDoor = (gx: number, gy: number, vertical: boolean, insetSign: number = 0) => {
    const [wallPx, wallPy] = toPx(gx, gy);
    const glyphPx = vertical ? wallPx + insetSign * DOOR_INSET : wallPx;
    const glyphPy = vertical ? wallPy : wallPy + insetSign * DOOR_INSET;

    const gap = document.createElementNS(NS, 'rect');
    if (vertical) {
      // travel is along x -- the erasure spans from the wall out to the
      // glyph, so the mouth stays visually open even though the door
      // marker itself is drawn further inside the corridor
      const lo = Math.min(wallPx, glyphPx) - (insetSign === 0 ? 6 : 0);
      const hi = Math.max(wallPx, glyphPx) + 6;
      gap.setAttribute('x', String(lo));
      gap.setAttribute('y', String(wallPy));
      gap.setAttribute('width', String(hi - lo));
      gap.setAttribute('height', String(UNIT));
    } else {
      const lo = Math.min(wallPy, glyphPy) - (insetSign === 0 ? 6 : 0);
      const hi = Math.max(wallPy, glyphPy) + 6;
      gap.setAttribute('x', String(wallPx));
      gap.setAttribute('y', String(lo));
      gap.setAttribute('width', String(UNIT));
      gap.setAttribute('height', String(hi - lo));
    }
    gap.setAttribute('class', 'door-gap');
    svg.appendChild(gap);

    const frame = document.createElementNS(NS, 'rect');
    if (vertical) {
      frame.setAttribute('x', String(glyphPx - 6));
      frame.setAttribute('y', String(glyphPy));
      frame.setAttribute('width', '12');
      frame.setAttribute('height', String(UNIT));
   } else {
      frame.setAttribute('x', String(glyphPx));
     frame.setAttribute('y', String(glyphPy - 6));
      frame.setAttribute('width', String(UNIT));
      frame.setAttribute('height', '12');
   }
    frame.setAttribute('class', 'door-frame');
    svg.appendChild(frame);

    const makeTick = (offset: number) => {
      const t = document.createElementNS(NS, 'line');
      if (vertical) {
        t.setAttribute('x1', String(glyphPx - 5));
        t.setAttribute('y1', String(glyphPy + UNIT / 2 + offset));
        t.setAttribute('x2', String(glyphPx + 5));
        t.setAttribute('y2', String(glyphPy + UNIT / 2 + offset));
      } else {
        t.setAttribute('x1', String(glyphPx + UNIT / 2 + offset));
        t.setAttribute('y1', String(glyphPy - 5));
        t.setAttribute('x2', String(glyphPx + UNIT / 2 + offset));
        t.setAttribute('y2', String(glyphPy + 5));
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
      drawDoor(x0, y0 - 0.5, true, x1 > x0 ? 1 : -1);   // travel is E/W -- pierces a vertical wall
    } else {
      drawDoor(x0 - 0.5, y0, false, y1 > y0 ? 1 : -1);  // travel is N/S -- pierces a horizontal wall
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

  // --- entrance / exit openings ---
  const OPENING_GAP = 4;         // px between the wall and the near edge of the arrow glyph
  const OPENING_ARROW_LEN = 11;  // px, tip-to-base length of the triangle
  const OPENING_ARROW_WIDTH = 7; // px, half-width of the triangle's base
  const OPENING_LABEL_GAP = 7;   // px between the glyph's outer edge and the label

  const drawOpening = (room: Room, dir: string, label: string, arrowInward: boolean) => {
    const vertical = dir === 'E' || dir === 'W';
    const [wx, wy] = wallCenter(room, dir);
    if (vertical) {
      drawDoor(wx, wy - 0.5, true);
    } else {
      drawDoor(wx - 0.5, wy, false);
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
    text.setAttribute('y', String(farY + dirY * OPENING_LABEL_GAP + 4));
    text.setAttribute('text-anchor', vertical ? 'start' : 'middle');
    if (vertical && dirX < 0) text.setAttribute('text-anchor', 'end');
    text.setAttribute('class', 'opening-label');
    text.textContent = label;
    svg.appendChild(text);
  };

  if (entrance) {
    const room = byId.get(entrance.roomId);
    if (room) drawOpening(room, entrance.direction, 'IN', true);
  }
  if (dungeonExit) {
    const room = byId.get(dungeonExit.roomId);
    if (room) drawOpening(room, dungeonExit.direction, 'OUT', false);
  }

}
