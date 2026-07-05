import type { Room, RoomNarrative } from '../types';
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
};

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

type MarkerItem = {
  kind: NarrativeElementKind;
  description: string;
};

function expandContent(room: RoomNarrative): MarkerItem[] {
  const markers: MarkerItem[] = [];

  for (const item of room.content || []) {
    const kind = normalizeNarrativeElementKind(item.type);
    if (!kind) continue;

    const quantity = clamp(Math.round(Number(item.quantity || 1)), 1, 3);
    const description = String(item.description || '').trim();

    for (let i = 0; i < quantity; i++) {
      markers.push({ kind, description });
    }
  }

  return markers.slice(0, MAX_ROOM_MARKERS);
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
  const [x, y] = ctx.toPx(room.x, room.y);
  const w = room.w * UNIT;
  const h = room.h * UNIT;
  const pad = Math.min(WALL_PAD, Math.max(8, Math.min(w, h) * 0.22));
  const innerW = Math.max(1, w - pad * 2);
  const innerH = Math.max(1, h - pad * 2);
  const rand = randomFrom(`${room.id}:${markerCount}:${room.x}:${room.y}`);

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

  const candidates = anchors.map(([ax, ay]) => {
    const jitterX = (rand() - 0.5) * Math.min(10, innerW * 0.15);
    const jitterY = (rand() - 0.5) * Math.min(10, innerH * 0.15);

    return {
      x: x + pad + innerW * ax + jitterX,
      y: y + pad + innerH * ay + jitterY,
    };
  });

  for (let i = 0; i < 16; i++) {
    candidates.push({
      x: x + pad + innerW * rand(),
      y: y + pad + innerH * rand(),
    });
  }

  return candidates.filter((point) => pointFitsRoom(room, point.x, point.y, { x, y }, w, h));
}

function pickMarkerPoints(ctx: RenderContext, room: Room, count: number): Point[] {
  const [x, y] = ctx.toPx(room.x, room.y);
  const center = {
    x: x + room.w * UNIT / 2,
    y: y + room.h * UNIT / 2,
  };

  const picked: Point[] = [];

  for (const candidate of buildCandidates(ctx, room, count)) {
    if (!awayFromCenterBadge(candidate, center)) continue;
    if (!farEnough(candidate, picked)) continue;

    picked.push(candidate);
    if (picked.length >= count) break;
  }

  if (!picked.length && count > 0) {
    const fallback = buildCandidates(ctx, room, count)[0];

    if (fallback) {
      picked.push(fallback);
    } else {
      picked.push({
        x: center.x + CENTER_BADGE_RADIUS,
        y: center.y,
      });
    }
  }

  return picked;
}

export function renderNarrativeContent(
  ctx: RenderContext,
  narratives: RoomNarrative[] = [],
): void {
  if (!narratives.length) return;

  for (const narrative of narratives) {
    const room = ctx.byId.get(narrative.id);
    if (!room) continue;

    const markers = expandContent(narrative);
    if (!markers.length) continue;

    const points = pickMarkerPoints(ctx, room, markers.length);

    markers.slice(0, points.length).forEach((marker, index) => {
      drawNarrativeElementMarker(
        ctx,
        marker.kind,
        points[index].x,
        points[index].y,
        MARKER_SIZE,
        marker.description,
      );
    });
  }
}
