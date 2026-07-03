import type { Opening } from '../types';
import { NS, UNIT, DIR_VECTOR, octagonVertices, wallCenter, type RenderContext } from './context';

// ============================================================================
// filter / pattern defs
// ============================================================================

// --- inset shadow: light from the top-left, so shadow gathers along each
// shape's bottom-right *inner* edge. Classic SVG inset-shadow recipe --
// invert+blur+offset the shape's own alpha, clip that back to the shape,
// then merge over the original so nothing spills past the wall.
const SHADOW_DX = 8, SHADOW_DY = 8, SHADOW_BLUR = 1;

export function buildInsetShadowFilter(defs: SVGDefsElement): void {
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
    <feFlood flood-color="var(--shadow-color)" flood-opacity="0.6" result="tint"/>
    <feComposite in="tint" in2="offset" operator="in" result="tinted-edge"/>
    <feComposite in="tinted-edge" in2="SourceAlpha" operator="in" result="clipped"/>
    <feMerge>
      <feMergeNode in="SourceGraphic"/>
      <feMergeNode in="clipped"/>
    </feMerge>
  `;
  defs.appendChild(insetFilter);
}

// --- exterior rubble halo filter: dilate the floor silhouette and subtract
// the original, leaving only the ring beyond the walls. NOTE: feMorphology
// (the dilate) is broadly supported but can be slow on very large maps --
// shrink HALO_RADIUS or drop the halo layer entirely if regen feels sluggish.
const HALO_RADIUS = 9;
const HALO_BLUR = 5;

export function buildHaloFilter(defs: SVGDefsElement): void {
  const haloFilter = document.createElementNS(NS, 'filter');
  haloFilter.setAttribute('id', 'halo-dilate');
  haloFilter.setAttribute('x', '-50%');
  haloFilter.setAttribute('y', '-50%');
  haloFilter.setAttribute('width', '200%');
  haloFilter.setAttribute('height', '200%');
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
  subtractOp.setAttribute('result', 'ring');
  haloFilter.appendChild(subtractOp);
  const ringBlurOp = document.createElementNS(NS, 'feGaussianBlur');
  ringBlurOp.setAttribute('in', 'ring');
  ringBlurOp.setAttribute('stdDeviation', String(HALO_BLUR));
  haloFilter.appendChild(ringBlurOp);
  defs.appendChild(haloFilter);
}

export function buildRubblePattern(defs: SVGDefsElement): void {
  const rubblePattern = document.createElementNS(NS, 'pattern');
  rubblePattern.setAttribute('id', 'rubble-pattern');
  rubblePattern.setAttribute('width', '8');
  rubblePattern.setAttribute('height', '8');
  rubblePattern.setAttribute('patternUnits', 'userSpaceOnUse');
  rubblePattern.setAttribute('patternTransform', 'rotate(45)');
  rubblePattern.innerHTML =
    '<line x1="0" y1="0" x2="8" y2="0" class="rubble-hatch"/>' +
    '<line x1="0" y1="4" x2="8" y2="4" class="rubble-hatch rubble-hatch-light"/>';
  defs.appendChild(rubblePattern);
}

// px -- softness of the exterior rubble texture; 0 = crisp lines
const ACCENT_BLUR = 0.1;

export function buildAccentBlurFilter(defs: SVGDefsElement): void {
  const accentBlurFilter = document.createElementNS(NS, 'filter');
  accentBlurFilter.setAttribute('id', 'accent-blur');
  accentBlurFilter.setAttribute('x', '-20%');
  accentBlurFilter.setAttribute('y', '-20%');
  accentBlurFilter.setAttribute('width', '140%');
  accentBlurFilter.setAttribute('height', '140%');
  accentBlurFilter.innerHTML = `<feGaussianBlur stdDeviation="${ACCENT_BLUR}"/>`;
  defs.appendChild(accentBlurFilter);
}

// ============================================================================
// exterior rubble halo
// ============================================================================

// Builds fresh copies of every room + corridor-leg silhouette, filled solid.
// Used for the halo mask -- called once, just for that mask's <g>.
function buildFloorUnionShapes(ctx: RenderContext, fill: string): SVGElement[] {
  const { rooms, corridors, toPx, CORRIDOR_PX } = ctx;
  const shapes: SVGElement[] = [];
  const pathD = (points: [number, number][]): string =>
    points.map(([gx, gy], i) => {
      const [ppx, ppy] = toPx(gx, gy);
      return `${i === 0 ? 'M' : 'L'}${ppx},${ppy}`;
    }).join(' ');

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
    // one continuous stroked path per corridor -- exactly matches the
    // visible outline (corridor-border uses the same +6 width), so the
    // halo mask never has a seam at a turn like separate leg-rects did
    const el = document.createElementNS(NS, 'path');
    el.setAttribute('d', pathD(c.points));
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', fill);
    el.setAttribute('stroke-width', String(CORRIDOR_PX + 6));
    el.setAttribute('stroke-linejoin', 'miter');
    el.setAttribute('stroke-linecap', 'butt');
    shapes.push(el);
  }
  return shapes;
}

export function renderHalo(
  ctx: RenderContext,
  entrance: Opening | null,
  dungeonExit: Opening | null,
): void {
  const { svg, defs, rooms, toPx, pxW, pxH } = ctx;

  const haloMask = document.createElementNS(NS, 'mask');
  haloMask.setAttribute('id', 'halo-mask');
  haloMask.setAttribute('maskUnits', 'userSpaceOnUse');
  haloMask.setAttribute('x', '0');
  haloMask.setAttribute('y', '0');
  haloMask.setAttribute('width', String(pxW));
  haloMask.setAttribute('height', String(pxH));
  const haloMaskGroup = document.createElementNS(NS, 'g');
  haloMaskGroup.setAttribute('filter', 'url(#halo-dilate)');
  buildFloorUnionShapes(ctx, 'white').forEach((el) => haloMaskGroup.appendChild(el));
  haloMask.appendChild(haloMaskGroup);

  // leave the halo clear at entrance/exit -- the rubble texture would
  // otherwise run straight across the arrow glyph drawn there later
  for (const opening of [entrance, dungeonExit]) {
    if (!opening) continue;
    const room = rooms.find((r) => r.id === opening.roomId);
    if (!room) continue;
    const [wx, wy] = wallCenter(room, opening.direction);
    const [nx, ny] = DIR_VECTOR[opening.direction];
    const [px0, py0] = toPx(wx, wy);
    const holeLen = HALO_RADIUS * 2 + 24;
    const holeWidth = UNIT * 0.9;
    const hole = document.createElementNS(NS, 'rect');
    if (nx !== 0) {
      hole.setAttribute('x', String(nx > 0 ? px0 : px0 - holeLen));
      hole.setAttribute('y', String(py0 - holeWidth / 2));
      hole.setAttribute('width', String(holeLen));
      hole.setAttribute('height', String(holeWidth));
    } else {
      hole.setAttribute('x', String(px0 - holeWidth / 2));
      hole.setAttribute('y', String(ny > 0 ? py0 : py0 - holeLen));
      hole.setAttribute('width', String(holeWidth));
      hole.setAttribute('height', String(holeLen));
    }
    hole.setAttribute('fill', 'black'); // black in a luminance mask = hidden
    haloMask.appendChild(hole);
  }
  defs.appendChild(haloMask);

  const haloBacking = document.createElementNS(NS, 'rect');
  haloBacking.setAttribute('x', '0');
  haloBacking.setAttribute('y', '0');
  haloBacking.setAttribute('width', String(pxW));
  haloBacking.setAttribute('height', String(pxH));
  haloBacking.setAttribute('fill', 'var(--halo-bg)');
  haloBacking.setAttribute('mask', 'url(#halo-mask)');
  svg.appendChild(haloBacking);

  const rubbleRect = document.createElementNS(NS, 'rect');
  rubbleRect.setAttribute('x', '0');
  rubbleRect.setAttribute('y', '0');
  rubbleRect.setAttribute('width', String(pxW));
  rubbleRect.setAttribute('height', String(pxH));
  rubbleRect.setAttribute('fill', 'url(#rubble-pattern)');
  rubbleRect.setAttribute('mask', 'url(#halo-mask)');
  rubbleRect.setAttribute('filter', 'url(#accent-blur)');
  svg.appendChild(rubbleRect);
}

// ============================================================================
// Dyson hatching -- short perpendicular ink ticks along the outside of every wall
// ============================================================================

const HATCH_LEN = 5;
const HATCH_GAP = 7;

export function renderWallHatching(ctx: RenderContext): void {
  const { svg, rooms, toPx } = ctx;

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
}

// ============================================================================
// map furniture: compass rose, scale bar
// ============================================================================

export function renderCompass(ctx: RenderContext): void {
  const { svg, pxW } = ctx;
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
}

export function renderScaleBar(ctx: RenderContext): void {
  const { svg, pxH } = ctx;
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
}
