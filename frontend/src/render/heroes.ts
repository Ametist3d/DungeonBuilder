import type { Door, Opening, Room } from '../types';
import { DIR_VECTOR, NS, type RenderContext } from './context';
import type { NarrativeContentMarker } from './narrative-content';
import {
    bindHeroCombat,
    canHeroAct,
    canHeroMoveToRoom,
    completeHeroMove,
    isEnemyCell,
    notifyHeroPositionChanged,
} from './enemies';
import {pickupLootAt} from './loot';
import {subscribePlayerStats, type PlayerStats,} from './player-stats';
import {applyStepEffects, setupEnvironmentEffects,} from './environment-effects';
import {addInventoryItem, resetInventory, type InventoryKind,} from './inventory'

export type HeroClass = 'wanderer';

type Point = { gx: number; gy: number };

interface WalkMap {
    cells: Set<string>;
    edges: Set<string>;
    blockedDoors: Map<string, Door>;
}

interface HeroState {
    className: HeroClass;
    gx: number;
    gy: number;
    ctx: RenderContext | null;
    group: SVGGElement | null;
    walkMap: WalkMap | null;
    keys: Set<string>;
    pickups: Map<string, NarrativeContentMarker>;
    doors: Door[];
    unsubscribeStats: (() => void) | null;
}

const HERO_STEP = 1;

const heroState: HeroState = {
    className: 'wanderer',
    gx: 0,
    gy: 0,
    ctx: null,
    group: null,
    walkMap: null,
    keys: new Set(),
    pickups: new Map(),
    doors: [],
    unsubscribeStats: null,
};

function snapHalf(v: number): number {
    return Math.round(v * 2) / 2;
}

function cellKey(gx: number, gy: number): string {
    return `${Math.round(gx * 2)}:${Math.round(gy * 2)}`;
}

function pointKey(point: Point): string {
    return cellKey(point.gx, point.gy);
}

function edgeKey(a: Point, b: Point): string {
    const ka = pointKey(a);
    const kb = pointKey(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function pointFromKey(key: string): Point {
    const [x, y] = key.split(':').map(Number);
    return { gx: x / 2, gy: y / 2 };
}

function addCell(map: WalkMap, point: Point): void {
    map.cells.add(pointKey(point));
}

function addEdge(map: WalkMap, a: Point, b: Point): void {
    if (!map.cells.has(pointKey(a)) || !map.cells.has(pointKey(b))) return;
    map.edges.add(edgeKey(a, b));
}

function insideRoom(room: Room, gx: number, gy: number): boolean {
    if (
        gx < room.x || gx >= room.x + room.w ||
        gy < room.y || gy >= room.y + room.h
    ) {
        return false;
    }

    if (room.shape === 'rect') return true;

    const cx = room.x + room.w / 2;
    const cy = room.y + room.h / 2;
    const r = Math.min(room.w, room.h) / 2 - 0.05;
    const dx = Math.abs(gx - cx);
    const dy = Math.abs(gy - cy);

    if (room.shape === 'circle') {
        return Math.hypot(dx, dy) <= r;
    }

    const cut = r * (Math.SQRT2 - 1);
    return dx <= r && dy <= r && dx + dy <= r + cut;
}

function roomIdAtPoint(ctx: RenderContext, point: Point): number | null {
    const room = ctx.rooms.find((item) => insideRoom(item, point.gx, point.gy));
    return room?.id ?? null;
}

function currentHeroRoomId(): number | null {
    if (!heroState.ctx) return null;
    return roomIdAtPoint(heroState.ctx, { gx: heroState.gx, gy: heroState.gy });
}

function roomCells(room: Room): Point[] {
    const cells: Point[] = [];

    for (let y = room.y; y < room.y + room.h; y++) {
        for (let x = room.x; x < room.x + room.w; x++) {
            const point = { gx: x + 0.5, gy: y + 0.5 };
            if (insideRoom(room, point.gx, point.gy)) cells.push(point);
        }
    }

    return cells;
}

function addRoom(map: WalkMap, room: Room): void {
    const cells = roomCells(room);
    const local = new Set<string>();

    cells.forEach((cell) => {
        addCell(map, cell);
        local.add(pointKey(cell));
    });

    cells.forEach((cell) => {
        const right = { gx: cell.gx + 1, gy: cell.gy };
        const down = { gx: cell.gx, gy: cell.gy + 1 };

        if (local.has(pointKey(right))) addEdge(map, cell, right);
        if (local.has(pointKey(down))) addEdge(map, cell, down);
    });
}

function segmentCells(p0: [number, number], p1: [number, number]): Point[] {
    const [x0, y0] = p0;
    const [x1, y1] = p1;
    const cells: Point[] = [];

    if (y0 === y1) {
        const y = snapHalf(y0);
        const start = Math.ceil(Math.min(x0, x1) - 0.5) + 0.5;
        const end = Math.floor(Math.max(x0, x1) - 0.5) + 0.5;

        for (let gx = start; gx <= end + 0.001; gx++) {
            cells.push({ gx: snapHalf(gx), gy: y });
        }
    } else {
        const x = snapHalf(x0);
        const start = Math.ceil(Math.min(y0, y1) - 0.5) + 0.5;
        const end = Math.floor(Math.max(y0, y1) - 0.5) + 0.5;

        for (let gy = start; gy <= end + 0.001; gy++) {
            cells.push({ gx: x, gy: snapHalf(gy) });
        }
    }

    return cells;
}

function addCorridorSegment(map: WalkMap, p0: [number, number], p1: [number, number]): void {
    const cells = segmentCells(p0, p1);

    cells.forEach((cell) => addCell(map, cell));

    for (let i = 0; i < cells.length - 1; i++) {
        addEdge(map, cells[i], cells[i + 1]);
    }
}

function doorEdgeFromSegment(near: [number, number], next: [number, number]): [Point, Point] | null {
    const [x0, y0] = near;
    const [x1, y1] = next;

    if (y0 === y1) {
        const sx = Math.sign(x1 - x0);
        if (!sx) return null;

        return [
            { gx: snapHalf(x0 - sx * 0.5), gy: snapHalf(y0) },
            { gx: snapHalf(x0 + sx * 0.5), gy: snapHalf(y0) },
        ];
    }

    const sy = Math.sign(y1 - y0);
    if (!sy) return null;

    return [
        { gx: snapHalf(x0), gy: snapHalf(y0 - sy * 0.5) },
        { gx: snapHalf(x0), gy: snapHalf(y0 + sy * 0.5) },
    ];
}

function corridorDoorEdge(ctx: RenderContext, door: Door): [Point, Point] | null {
    const corridor = ctx.corridors.find(
        (c) => c.parentId === door.parentId && c.childId === door.childId,
    );

    if (!corridor || corridor.points.length < 2) return null;

    if (door.roomId === door.parentId && !corridor.branchesFromCorridor) {
        return doorEdgeFromSegment(corridor.points[0], corridor.points[1]);
    }

    if (door.roomId === door.childId) {
        return doorEdgeFromSegment(
            corridor.points[corridor.points.length - 1],
            corridor.points[corridor.points.length - 2],
        );
    }

    return null;
}

function addDirectRoomDoorEdges(ctx: RenderContext, map: WalkMap): void {
    const { rooms, byId, corridorPairs } = ctx;

    for (const room of rooms) {
        if (room.parentId === null || room.entranceDir === null) continue;
        if (
            corridorPairs.has(`${room.parentId}-${room.id}`) ||
            corridorPairs.has(`${room.id}-${room.parentId}`)
        ) {
            continue;
        }

        const parent = byId.get(room.parentId);
        if (!parent) continue;

        const dir = DIR_VECTOR[room.entranceDir];
        const wallDir = { gx: -dir[0], gy: -dir[1] };

        if (room.entranceDir === 'E' || room.entranceDir === 'W') {
            const wallX = room.entranceDir === 'W' ? room.x : room.x + room.w;
            const lo = Math.max(parent.y, room.y);
            const hi = Math.min(parent.y + parent.h, room.y + room.h);
            const gy = Math.floor((lo + hi) / 2) + 0.5;

            addEdge(map, { gx: wallX + wallDir.gx * 0.5, gy }, { gx: wallX - wallDir.gx * 0.5, gy });
        } else {
            const wallY = room.entranceDir === 'N' ? room.y : room.y + room.h;
            const lo = Math.max(parent.x, room.x);
            const hi = Math.min(parent.x + parent.w, room.x + room.w);
            const gx = Math.floor((lo + hi) / 2) + 0.5;

            addEdge(map, { gx, gy: wallY + wallDir.gy * 0.5 }, { gx, gy: wallY - wallDir.gy * 0.5 });
        }
    }
}

function buildWalkMap(ctx: RenderContext, doors: Door[]): WalkMap {
    const map: WalkMap = {
        cells: new Set(),
        edges: new Set(),
        blockedDoors: new Map(),
    };

    ctx.rooms.forEach((room) => addRoom(map, room));

    ctx.corridors.forEach((corridor) => {
        for (let i = 0; i < corridor.points.length - 1; i++) {
            addCorridorSegment(map, corridor.points[i], corridor.points[i + 1]);
        }
    });

    doors.forEach((door) => {
        const edge = corridorDoorEdge(ctx, door);
        if (!edge) return;

        addEdge(map, edge[0], edge[1]);

        if (door.state === 'closed') {
            map.blockedDoors.set(edgeKey(edge[0], edge[1]), door);
        }
    });

    addDirectRoomDoorEdges(ctx, map);

    return map;
}

function entranceHeroPosition(room: Room, entrance: Opening): Point {
    switch (entrance.direction) {
        case 'N':
            return { gx: room.x + Math.floor(room.w / 2) + 0.5, gy: room.y + 0.5 };
        case 'S':
            return { gx: room.x + Math.floor(room.w / 2) + 0.5, gy: room.y + room.h - 0.5 };
        case 'E':
            return { gx: room.x + room.w - 0.5, gy: room.y + Math.floor(room.h / 2) + 0.5 };
        default:
            return { gx: room.x + 0.5, gy: room.y + Math.floor(room.h / 2) + 0.5 };
    }
}

function nearestWalkableCell(map: WalkMap, point: Point): Point {
    if (map.cells.has(pointKey(point))) return point;

    let best = point;
    let bestDist = Infinity;

    for (const key of map.cells) {
        const cell = pointFromKey(key);
        const dist = Math.hypot(cell.gx - point.gx, cell.gy - point.gy);

        if (dist < bestDist) {
            best = cell;
            bestDist = dist;
        }
    }

    return best;
}

function createHeroSvg(): SVGGElement {
    const hero = document.createElementNS(NS, 'g');
    hero.setAttribute('class', 'hero-token hero-wanderer');

    hero.innerHTML = `
    <circle
      class="hero-hp-ring"
      cx="0"
      cy="0"
      r="17"
      pathLength="100"
      transform="rotate(-90)"
    />

    <circle
      class="hero-mana-ring"
      cx="0"
      cy="0"
      r="14"
      pathLength="100"
      transform="rotate(-90)"
    />

    <circle class="hero-base" cx="0" cy="0" r="11"/>

    <path
      class="hero-cloak"
      d="M0,-10 C6,-8 9,-2 8,7 C4,10 -4,10 -8,7 C-9,-2 -6,-8 0,-10 Z"
    />

    <circle class="hero-face" cx="0" cy="-3" r="4"/>

    <path
      class="hero-hood"
      d="M-6,-3 C-4,-10 4,-10 6,-3 C3,-6 -3,-6 -6,-3 Z"
    />

    <path
      class="hero-blade"
      d="M6,-7 L11,-12 M9,-13 L12,-10"
    />
  `;

    return hero;
}

function updateHeroTransform(): void {
    if (!heroState.ctx || !heroState.group) return;

    const [x, y] = heroState.ctx.toPx(heroState.gx, heroState.gy);
    heroState.group.setAttribute('transform', `translate(${x} ${y})`);
}


function updateHeroRing(selector: string, current: number, maximum: number): void {
    const ring = heroState.group?.querySelector(selector) as SVGCircleElement | null;

    if (!ring) return;

    const percent = maximum > 0
        ? Math.max(0, Math.min(100, current / maximum * 100))
        : 0;

    ring.style.strokeDasharray = `${percent} 100`;
    ring.style.strokeDashoffset = '0';
    ring.style.opacity = percent > 0 ? '1' : '0';
}

function updateHeroStats(stats: PlayerStats): void {
    updateHeroRing('.hero-hp-ring', stats.hp, stats.maxHp);
    updateHeroRing('.hero-mana-ring', stats.mp, stats.maxMp);
}

function normalizeToken(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function textHasAny(text: string, words: string[]): boolean {
    const normalized = normalizeToken(text);
    return words.some((word) => normalized.includes(normalizeToken(word)));
}

function pickupTokens(marker: NarrativeContentMarker): string[] {
    const text = `${marker.kind} ${marker.description}`;
    const tokens = new Set<string>();

    heroState.doors.forEach((door) => {
        if (door.state !== 'closed') return;
        if (door.keyRoomId !== marker.roomId) return;

        const keyName = String(door.keyName || '').trim();
        if (!keyName) return;

        if (!textHasAny(text, [keyName]) && !textHasAny(text, [door.id])) return;

        tokens.add(`door:${door.id}`);
    });

    return [...tokens];
}


function canUnlockDoor(door: Door): boolean {
    return heroState.keys.has(`door:${door.id}`);
}

function markDoorUnlocked(door: Door): void {
    document
        .querySelectorAll(`[data-door-id="${door.id}"]`)
        .forEach((el) => el.classList.add('door-unlocked'));
}

function tryUnlockDoor(edge: string, door: Door): boolean {
    if (!canUnlockDoor(door)) return false;

    heroState.walkMap?.blockedDoors.delete(edge);
    door.state = 'open';
    markDoorUnlocked(door);

    return true;
}

function setPickedPopup(marker: NarrativeContentMarker): void {
    const cleanDescription = marker.description.replace(/\s*\(picked\)\s*$/i, '').trim();
    marker.description = `${cleanDescription} (picked)`;

    if (!marker.element) return;

    marker.element.classList.add('picked');
    marker.element.setAttribute('data-picked', 'true');
    marker.element.setAttribute('data-tooltip', marker.description);
    marker.element.setAttribute('aria-label', marker.description);

    marker.element.querySelector('title')?.remove();
}


function inventoryKindForUnlock(marker: NarrativeContentMarker): InventoryKind {
  if (marker.kind === 'clue') {
    return 'scroll';
  }

  if (marker.kind === 'ritualObject') {
    return 'mechanism';
  }

  return 'key';
}

function pickupAtCurrentCell(): void {
    pickupLootAt(heroState.gx, heroState.gy);

    const key = cellKey(heroState.gx, heroState.gy);

    const marker = heroState.pickups.get(key);

  if (
    !marker ||
    marker.element?.classList.contains('picked')
  ) {
    return;
  }

  const tokens = pickupTokens(marker);

  if (!tokens.length) return;

  tokens.forEach((token) => {
    heroState.keys.add(token);
  });

  heroState.pickups.delete(key);

  addInventoryItem({ id: marker.id, kind: inventoryKindForUnlock(marker), name: marker.description.trim() || 'Unlock item' });

  setPickedPopup(marker);

  console.log('picked', marker.description, tokens);
}

function canMoveTo(next: Point): boolean {
    const map = heroState.walkMap;
    if (!map) return true;

    const current = { gx: heroState.gx, gy: heroState.gy };
    const edge = edgeKey(current, next);
    const blockedDoor = map.blockedDoors.get(edge);

    if (!map.cells.has(pointKey(next)) || !map.edges.has(edge)) {
        return false;
    }

    if (blockedDoor && !tryUnlockDoor(edge, blockedDoor)) {
        return false;
    }

    return true;
}

export function renderHeroes(
  ctx: RenderContext,
  entrance: Opening | null,
  doors: Door[] = [],
  contentMarkers: NarrativeContentMarker[] = [],
): void {
  heroState.unsubscribeStats?.();
  heroState.unsubscribeStats = null;

  resetInventory();
  setupEnvironmentEffects(contentMarkers);

  if (!entrance) {
    heroState.group = null;
    return;
  }

  const room = ctx.byId.get(entrance.roomId);

  if (!room) {
    heroState.group = null;
    return;
  }

  const walkMap = buildWalkMap(ctx, doors);
  const pos = nearestWalkableCell(walkMap, entranceHeroPosition(room, entrance));

  heroState.ctx = ctx;
  heroState.gx = pos.gx;
  heroState.gy = pos.gy;
  heroState.walkMap = walkMap;
  heroState.doors = doors;
  heroState.keys = new Set();
  heroState.pickups = new Map();

  contentMarkers.forEach((marker) => {
    if (
      marker.kind !== 'secret' &&
      marker.kind !== 'clue' &&
      marker.kind !== 'ritualObject'
    ) {
      return;
    }

      heroState.pickups.set(cellKey(marker.gx, marker.gy), marker);
  });

  heroState.group = createHeroSvg();

  ctx.svg.appendChild(heroState.group);

  heroState.unsubscribeStats = subscribePlayerStats(updateHeroStats);

  updateHeroTransform();
  pickupAtCurrentCell();

  bindHeroCombat({
    getPosition: () => ({
      gx: heroState.gx,
      gy: heroState.gy,
    }),

    getRoomId: currentHeroRoomId,

    onDeath: () => {
      heroState.group?.classList.add('hero-dead');
    },
  });

  notifyHeroPositionChanged();
}

export function moveHero(dx: number, dy: number): void {
  if (!heroState.ctx || !heroState.group || !canHeroAct()) {
    return;
  }

  const next = {
    gx: snapHalf(heroState.gx + dx * HERO_STEP),
    gy: snapHalf(heroState.gy + dy * HERO_STEP),
  };

  if (isEnemyCell(next.gx, next.gy)) {
    return;
  }

  const nextRoomId = roomIdAtPoint(heroState.ctx, next);

  if (!canHeroMoveToRoom(nextRoomId)) {
    return;
  }

  if (!canMoveTo(next)) {
    return;
  }

  heroState.gx = next.gx;
  heroState.gy = next.gy;

  updateHeroTransform();

  const alive = applyStepEffects(heroState.gx, heroState.gy, nextRoomId);

  if (!alive) {
    heroState.group.classList.add('hero-dead');

    return;
  }

  pickupAtCurrentCell();
  completeHeroMove();
}

export function setupHeroControls(): void {
    document.addEventListener('keydown', (e) => {
        const target = e.target as HTMLElement | null;

        if (
            target?.tagName === 'INPUT' ||
            target?.tagName === 'SELECT' ||
            target?.tagName === 'TEXTAREA' ||
            e.ctrlKey ||
            e.metaKey ||
            e.altKey
        ) {
            return;
        }

        const key = e.key.toLowerCase();


        if (key === 'w' || key === 'arrowup') moveHero(0, -1);
        else if (key === 's' || key === 'arrowdown') moveHero(0, 1);
        else if (key === 'a' || key === 'arrowleft') moveHero(-1, 0);
        else if (key === 'd' || key === 'arrowright') moveHero(1, 0);
        else return;

        e.preventDefault();
    });
}
