import type { NarrativeContent, Room, RoomNarrative } from '../types';
import { UNIT, type RenderContext } from './context';
import {
  drawNarrativeElementMarker,
  normalizeNarrativeElementKind,
  type NarrativeElementKind,
} from './narrative-elements';

const MARKER_SIZE = 24;
const WALL_PAD = 20;
const CENTER_BADGE_RADIUS = 38;
const MARKER_GAP = 8;
const MAX_ROOM_MARKERS = 9;

type Point = {
  x: number;
  y: number;
  gx?: number;
  gy?: number;
};

type MarkerItem = {
  kind: NarrativeElementKind;
  description: string;
  content: NarrativeContent;
};

export interface NarrativeContentMarker {
  id: string;
  roomId: number;
  kind: NarrativeElementKind;
  description: string;
  content: NarrativeContent;
  gx: number;
  gy: number;
  x: number;
  y: number;
  element?: SVGGElement;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashSeed(text: string): number {
  let h = 2166136261;

  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return h >>> 0;
}

function randomFrom(seed: string): () => number {
  let state = hashSeed(seed) || 1;

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10000) / 10000;
  };
}




function isUnlockDescription(description: string): boolean {
  return /^Room\s+\d+\s+door\s+\d+-\d+\s+/i.test(description.trim());
}

function isGeneratedUnlockDuplicate(description: string): boolean {
  const text = description.trim();

  if (isUnlockDescription(text)) return false;

  return (
    /\bRoom\s+\d+\s+door\b/i.test(text) ||
    /\b(unlock|opens?|seals?|sealed|mechanism|key|scroll)\b.*\bdoor\b/i.test(text) ||
    /\bdoor\b.*\b(room|key|scroll|mechanism)\b/i.test(text)
  );
}

function expandContent(room: RoomNarrative, capacity: number): MarkerItem[] {
  const required: MarkerItem[] = [];
  const optional: MarkerItem[] = [];

  for (const item of room.content || []) {
    const kind = normalizeNarrativeElementKind(item.type);
    if (!kind) continue;

    const quantity =
      kind === 'loot'
        ? 1
        : isUnlockDescription(
            String(item.description || ''),
          )
          ? 1
          : clamp(
              Math.round(Number(item.quantity || 1)),
              1,
              3,
            );

    const description = String(item.description || '').trim();
    if (isGeneratedUnlockDuplicate(description)) continue;
    
    for (let i = 0; i < quantity; i++) {
      const marker = { kind, description, content: item };

      if (isUnlockDescription(description)) {
        required.push(marker);
      } else {
        optional.push(marker);
      }
    }
  }

  return [...required, ...optional].slice(0, Math.max(required.length, capacity));
}

function pointFitsRoom(room: Room, px: number, py: number, roomPx: Point, w: number, h: number): boolean {
  const localX = px - roomPx.x;
  const localY = py - roomPx.y;

  if (room.shape === 'rect') return true;

  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 - MARKER_SIZE / 2 - 4;

  return (localX - cx) ** 2 + (localY - cy) ** 2 <= r ** 2;
}

function farEnough(point: Point, points: Point[]): boolean {
  const minDist = MARKER_SIZE + MARKER_GAP;

  return points.every((other) =>
    Math.hypot(point.x - other.x, point.y - other.y) >= minDist
  );
}

function awayFromCenterBadge(point: Point, center: Point): boolean {
  return Math.hypot(point.x - center.x, point.y - center.y) >= CENTER_BADGE_RADIUS;
}

function buildCandidates(ctx: RenderContext, room: Room, markerCount: number): Point[] {
  const [roomPxX, roomPxY] = ctx.toPx(room.x, room.y);
  const w = room.w * UNIT;
  const h = room.h * UNIT;
  const rand = randomFrom(`${room.id}:${markerCount}:${room.x}:${room.y}`);

  const marginX = room.w >= 4 ? 1 : 0;
  const marginY = room.h >= 4 ? 1 : 0;

  const cells: Point[] = [];

  const collectCells = (mx: number, my: number): void => {
    for (let gy = room.y + my; gy < room.y + room.h - my; gy++) {
      for (let gx = room.x + mx; gx < room.x + room.w - mx; gx++) {
        const [x, y] = ctx.toPx(gx + 0.5, gy + 0.5);

        if (pointFitsRoom(room, x, y, { x: roomPxX, y: roomPxY }, w, h)) {
          cells.push({ x, y, gx: gx + 0.5, gy: gy + 0.5 });
        }
      }
    }
  };

  collectCells(marginX, marginY);

  if (!cells.length && (marginX || marginY)) {
    collectCells(0, 0);
  }

  const anchors: [number, number][] = [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
    [0.50, 0.18],
    [0.82, 0.50],
    [0.50, 0.82],
    [0.18, 0.50],
    [0.35, 0.18],
    [0.65, 0.18],
    [0.35, 0.82],
    [0.65, 0.82],
  ];

  for (let i = anchors.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [anchors[i], anchors[j]] = [anchors[j], anchors[i]];
  }

  const score = (point: Point): number => {
    const nx = (point.x - roomPxX) / w;
    const ny = (point.y - roomPxY) / h;

    let best = Infinity;

    anchors.forEach(([ax, ay], index) => {
      const d = Math.hypot(nx - ax, ny - ay) + index * 0.025;
      best = Math.min(best, d);
    });

    return best + rand() * 0.015;
  };

  return cells.sort((a, b) => score(a) - score(b));
}

function roomMarkerCapacity(ctx: RenderContext, room: Room): number {
  const cells = buildCandidates(ctx, room, 1).length;

  if (cells <= 2) return 1;
  if (cells <= 5) return 2;
  if (cells <= 9) return 3;
  if (cells <= 16) return 4;

  return clamp(Math.floor(cells / 4) + 1, 1, MAX_ROOM_MARKERS);
}

function samePoint(a: Point, b: Point): boolean {
  return a.gx === b.gx && a.gy === b.gy;
}
function pickMarkerPoints(ctx: RenderContext, room: Room, count: number): Point[] {
  const [x, y] = ctx.toPx(room.x, room.y);
  const center = {
    x: x + room.w * UNIT / 2,
    y: y + room.h * UNIT / 2,
  };

  const candidates = buildCandidates(ctx, room, count);
  const picked: Point[] = [];

  const tryPick = (strictCenter: boolean, strictDistance: boolean): void => {
    for (const candidate of candidates) {
      if (picked.length >= count) return;
      if (picked.some((point) => samePoint(point, candidate))) continue;
      if (strictCenter && !awayFromCenterBadge(candidate, center)) continue;
      if (strictDistance && !farEnough(candidate, picked)) continue;

      picked.push(candidate);
    }
  };

  tryPick(true, true);
  tryPick(false, true);
  tryPick(false, false);

  return picked.slice(0, count);
}

export function getNarrativeContentMarkers(
  ctx: RenderContext,
  narratives: RoomNarrative[] = [],
): NarrativeContentMarker[] {
  const result: NarrativeContentMarker[] = [];

  for (const narrative of narratives) {
    const room = ctx.byId.get(narrative.id);
    if (!room) continue;

    const capacity = roomMarkerCapacity(ctx, room);
    const markers = expandContent(narrative, capacity);
    if (!markers.length) continue;

    const points = pickMarkerPoints(ctx, room, markers.length);

    markers.forEach((marker, index) => {
      const point = points[index];

      if (!point || point.gx === undefined || point.gy === undefined) return;

      result.push({
        id: `${narrative.id}:${index}:${marker.kind}`,
        roomId: narrative.id,
        kind: marker.kind,
        description: marker.description,
        content: marker.content,
        gx: point.gx,
        gy: point.gy,
        x: point.x,
        y: point.y,
      });
    });
  }

  return result;
}

export function renderNarrativeContent(
  ctx: RenderContext,
  narratives: RoomNarrative[] = [],
): NarrativeContentMarker[] {
  const markers = getNarrativeContentMarkers(ctx, narratives);

  markers.forEach((marker) => {
    if (
      marker.kind === 'enemy' ||
      marker.kind === 'loot'
    ) {
      return;
    }

    marker.element = drawNarrativeElementMarker(
      ctx,
      marker.kind,
      marker.x,
      marker.y,
      MARKER_SIZE,
      marker.description,
    );

    marker.element.setAttribute(
      'data-content-id',
      marker.id,
    );
  });

  return markers;
}
