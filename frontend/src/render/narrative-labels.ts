import type { Room, RoomNarrative } from '../types';
import { NS, UNIT, type RenderContext } from './context';

const TARGET_ASPECT = 1.5;
const MIN_LABEL_W = 190;
const MAX_LABEL_W = 430;
const WIDTH_STEP = 18;

const GAP = 20;
const PAD_X = 14;
const PAD_Y = 12;
const LINE_H = 21;

const TITLE_FONT_SIZE = 16;
const BODY_FONT_SIZE = 16;
const TITLE_CHAR_W = 8.8;
const BODY_CHAR_W = 8.0;

const MAX_BODY_CHARS = 260;


type Box = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type LabelLayout = {
  width: number;
  height: number;
  lines: string[];
  score: number;
  titleTruncated: boolean;
  bodyTruncated: boolean;
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function inflate(box: Box, amount: number): Box {
  return {
    x: box.x - amount,
    y: box.y - amount,
    w: box.w + amount * 2,
    h: box.h + amount * 2,
  };
}

function intersects(a: Box, b: Box): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

function fits(ctx: RenderContext, box: Box): boolean {
  return (
    box.x >= PAD_X &&
    box.y >= PAD_Y &&
    box.x + box.w <= ctx.pxW - PAD_X &&
    box.y + box.h <= ctx.pxH - PAD_Y
  );
}

function roomBox(ctx: RenderContext, room: Room): Box {
  const [x, y] = ctx.toPx(room.x, room.y);
  return {
    x,
    y,
    w: room.w * UNIT,
    h: room.h * UNIT,
  };
}

function corridorBoxes(ctx: RenderContext): Box[] {
  const boxes: Box[] = [];

  for (const corridor of ctx.corridors) {
    for (let i = 0; i < corridor.points.length - 1; i++) {
      const [gx0, gy0] = corridor.points[i];
      const [gx1, gy1] = corridor.points[i + 1];
      const [x0, y0] = ctx.toPx(gx0, gy0);
      const [x1, y1] = ctx.toPx(gx1, gy1);

      if (gy0 === gy1) {
        boxes.push(inflate({
          x: Math.min(x0, x1),
          y: y0 - ctx.CORRIDOR_PX / 2,
          w: Math.abs(x1 - x0),
          h: ctx.CORRIDOR_PX,
        }, 8));
      } else {
        boxes.push(inflate({
          x: x0 - ctx.CORRIDOR_PX / 2,
          y: Math.min(y0, y1),
          w: ctx.CORRIDOR_PX,
          h: Math.abs(y1 - y0),
        }, 8));
      }
    }
  }

  return boxes;
}



function cleanText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}


function trimToWord(text: string, maxChars: number): string {
  const clean = cleanText(text);
  if (clean.length <= maxChars) return clean;

  const sliced = clean.slice(0, maxChars - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const base = lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced;
  return `${base.trim()}…`;
}

function wrapText(text: string, maxChars: number): string[] {
  const words = cleanText(text).split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function labelBody(room: RoomNarrative): string {
  return trimToWord(room.mapLabel?.trim() || room.description, MAX_BODY_CHARS);
}

function buildLayout(room: RoomNarrative, wrapWidth: number): LabelLayout {
  const innerW = wrapWidth - PAD_X * 2;

  const titleCharsPerLine = Math.max(16, Math.floor(innerW / TITLE_CHAR_W));
  const bodyCharsPerLine = Math.max(18, Math.floor(innerW / BODY_CHAR_W));

  const fullTitle = `${room.id}. ${room.label}`.trim();
  const titleLine = trimToWord(fullTitle, titleCharsPerLine);
  const titleTruncated = titleLine !== fullTitle;

  const fullBody = labelBody(room);
  const bodyLines = wrapText(fullBody, bodyCharsPerLine);
  const visibleBody = bodyLines.join(' ');
  const bodyTruncated = visibleBody.length < fullBody.length;

  const lines = [titleLine, ...bodyLines];

  const measuredTitleW = titleLine.length * TITLE_CHAR_W;
  const measuredBodyW = Math.max(0, ...bodyLines.map((line) => line.length * BODY_CHAR_W));
  const measuredTextW = Math.max(measuredTitleW, measuredBodyW);

  const naturalWidth = Math.ceil(measuredTextW + PAD_X * 2);
  const width = clampNumber(naturalWidth, MIN_LABEL_W, wrapWidth);
  const height = PAD_Y * 2 + lines.length * LINE_H + 4;

  const aspect = width / height;
  const aspectPenalty = Math.abs(aspect - TARGET_ASPECT) * 35;
  const areaPenalty = (width * height) / 18000;
  const emptySpacePenalty = Math.max(0, width - naturalWidth) / 8;
  const titlePenalty = titleTruncated ? 200 : 0;
  const bodyPenalty = bodyTruncated ? 80 : 0;

  return {
    width,
    height,
    lines,
    score: aspectPenalty + areaPenalty + emptySpacePenalty + titlePenalty + bodyPenalty,
    titleTruncated,
    bodyTruncated,
  };
}

function buildLayoutVariants(room: RoomNarrative): LabelLayout[] {
  const variants: LabelLayout[] = [];

  for (let width = MIN_LABEL_W; width <= MAX_LABEL_W; width += WIDTH_STEP) {
    variants.push(buildLayout(room, width));
  }

  variants.sort((a, b) =>
    Number(a.titleTruncated) - Number(b.titleTruncated) ||
    Number(a.bodyTruncated) - Number(b.bodyTruncated) ||
    a.score - b.score ||
    a.height - b.height ||
    a.width - b.width
  );

  return variants;
}

function candidateBoxes(box: Box, labelW: number, labelH: number): Box[] {
  return [
    {
      x: box.x + box.w + GAP,
      y: box.y + box.h / 2 - labelH / 2,
      w: labelW,
      h: labelH,
    },
    {
      x: box.x - labelW - GAP,
      y: box.y + box.h / 2 - labelH / 2,
      w: labelW,
      h: labelH,
    },
    {
      x: box.x + box.w / 2 - labelW / 2,
      y: box.y - labelH - GAP,
      w: labelW,
      h: labelH,
    },
    {
      x: box.x + box.w / 2 - labelW / 2,
      y: box.y + box.h + GAP,
      w: labelW,
      h: labelH,
    },
    {
      x: box.x + box.w + GAP,
      y: box.y - labelH - GAP,
      w: labelW,
      h: labelH,
    },
    {
      x: box.x - labelW - GAP,
      y: box.y - labelH - GAP,
      w: labelW,
      h: labelH,
    },
    {
      x: box.x + box.w + GAP,
      y: box.y + box.h + GAP,
      w: labelW,
      h: labelH,
    },
    {
      x: box.x - labelW - GAP,
      y: box.y + box.h + GAP,
      w: labelW,
      h: labelH,
    },
  ];
}

function drawLabel(ctx: RenderContext, box: Box, lines: string[]): void {
  const group = document.createElementNS(NS, 'g');
  group.setAttribute('class', 'narrative-callout');

  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('x', String(box.x));
  bg.setAttribute('y', String(box.y));
  bg.setAttribute('width', String(box.w));
  bg.setAttribute('height', String(box.h));
  bg.setAttribute('rx', '6');
  group.appendChild(bg);

  const text = document.createElementNS(NS, 'text');
  text.setAttribute('x', String(box.x + PAD_X));
  text.setAttribute('y', String(box.y + PAD_Y + TITLE_FONT_SIZE));
  text.setAttribute('font-size', String(BODY_FONT_SIZE));

  const title = document.createElementNS(NS, 'tspan');
  title.setAttribute('x', String(box.x + PAD_X));
  title.setAttribute('dy', '0');
  title.setAttribute('class', 'narrative-callout-title');
  title.setAttribute('font-size', String(TITLE_FONT_SIZE));
  title.textContent = lines[0] || '';
  text.appendChild(title);

  for (const line of lines.slice(1)) {
    const tspan = document.createElementNS(NS, 'tspan');
    tspan.setAttribute('x', String(box.x + PAD_X));
    tspan.setAttribute('dy', String(LINE_H));
    tspan.setAttribute('font-size', String(BODY_FONT_SIZE));
    tspan.textContent = line;
    text.appendChild(tspan);
  }

  group.appendChild(text);
  ctx.svg.appendChild(group);
}

function pickLabelPlacement(
  ctx: RenderContext,
  narrative: RoomNarrative,
  sourceBox: Box,
  obstacles: Box[],
): { box: Box; lines: string[] } | null {
  const variants = buildLayoutVariants(narrative);

  for (const variant of variants) {
    const candidates = candidateBoxes(sourceBox, variant.width, variant.height);

    const box = candidates.find((candidate) =>
      fits(ctx, candidate) &&
      !obstacles.some((obstacle) => intersects(candidate, obstacle))
    );

    if (box) {
      return { box, lines: variant.lines };
    }
  }

  return null;
}

export function renderNarrativeLabels(
  ctx: RenderContext,
  narratives: RoomNarrative[] = [],
): Set<number> {
  const placed = new Set<number>();
  if (!narratives.length) return placed;

  const obstacles: Box[] = [
    ...ctx.rooms.map((room) => inflate(roomBox(ctx, room), 10)),
    ...corridorBoxes(ctx),
  ];

  for (const narrative of narratives) {
    const room = ctx.byId.get(narrative.id);
    if (!room) continue;

    const sourceBox = roomBox(ctx, room);
    const placement = pickLabelPlacement(ctx, narrative, sourceBox, obstacles);

    if (!placement) continue;

    drawLabel(ctx, placement.box, placement.lines);
    obstacles.push(inflate(placement.box, 6));
    placed.add(narrative.id);
  }

  return placed;
}
