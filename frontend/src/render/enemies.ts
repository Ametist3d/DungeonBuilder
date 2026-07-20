import type {
  EnemyDifficulty,
  EnemyType,
  NarrativeContent,
  Room,
} from '../types';
import { NS, type RenderContext } from './context';
import type { NarrativeContentMarker } from './narrative-content';
import {
  damagePlayer as applyPlayerDamage,
  getPlayerStats,
  resetPlayerStats,
  setPlayerStatus,
} from './player-stats';

type Point = { gx: number; gy: number };
type CombatPhase = 'player' | 'enemy' | 'dead';

type HeroStats = {
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
};

type HeroBridge = {
  getPosition: () => Point;
  getRoomId: () => number | null;
  onDeath: () => void;
};

type EnemyState = {
  id: string;
  roomId: number;
  description: string;
  type: EnemyType;
  difficulty: EnemyDifficulty;
  hp: number;
  maxHp: number;
  damage: number;
  range: number;
  gx: number;
  gy: number;
  active: boolean;
  element: SVGGElement;
};


const ENEMY_HP: Record<EnemyDifficulty, number> = {
  normal: 6,
  elite: 12,
  boss: 24,
};

const ENEMY_DAMAGE: Record<EnemyDifficulty, number> = {
  normal: 1,
  elite: 2,
  boss: 3,
};

const ENEMY_RANGE: Record<EnemyType, number> = {
  melee: 1,
  ranged: 4,
  mage: 3,
};

const state: {
  ctx: RenderContext | null;
  hero: HeroBridge | null;
  enemies: EnemyState[];
  activeRoomId: number | null;
  phase: CombatPhase;
} = {
  ctx: null,
  hero: null,
  enemies: [],
  activeRoomId: null,
  phase: 'player',
};

function normalizeEnemyType(value: unknown): EnemyType {
  return value === 'ranged' || value === 'mage' ? value : 'melee';
}

function normalizeDifficulty(value: unknown): EnemyDifficulty {
  return value === 'elite' || value === 'boss' ? value : 'normal';
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

  if (room.shape === 'circle') return Math.hypot(dx, dy) <= r;

  const cut = r * (Math.SQRT2 - 1);
  return dx <= r && dy <= r && dx + dy <= r + cut;
}

function distance(a: Point, b: Point): number {
  return Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy);
}

function attackDistance(a: Point, b: Point): number {
  return Math.max(Math.abs(a.gx - b.gx), Math.abs(a.gy - b.gy));
}

function enemyAt(gx: number, gy: number, ignoreId = ''): EnemyState | null {
  return state.enemies.find((enemy) =>
    enemy.id !== ignoreId &&
    enemy.hp > 0 &&
    enemy.gx === gx &&
    enemy.gy === gy
  ) || null;
}

function updateCombatStatus(): void {
  const defeated = state.phase === 'dead';

  const text = defeated
    ? 'Defeated'
    : state.activeRoomId === null
      ? 'Exploration'
      : state.phase === 'player'
        ? 'Player turn'
        : 'Enemy turn';

  setPlayerStatus(text, state.activeRoomId !== null, defeated);
}


function getTooltip(): HTMLDivElement {
  let tooltip = document.getElementById('enemy-tooltip') as HTMLDivElement | null;

  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'enemy-tooltip';
    tooltip.className = 'enemy-tooltip';
    document.body.appendChild(tooltip);
  }

  return tooltip;
}

function moveTooltip(event: PointerEvent): void {
  const tooltip = getTooltip();
  const gap = 14;

  tooltip.style.left = `${event.clientX + gap}px`;
  tooltip.style.top = `${event.clientY + gap}px`;

  const rect = tooltip.getBoundingClientRect();

  if (rect.right > window.innerWidth - 8) {
    tooltip.style.left = `${event.clientX - rect.width - gap}px`;
  }

  if (rect.bottom > window.innerHeight - 8) {
    tooltip.style.top = `${event.clientY - rect.height - gap}px`;
  }
}

function tooltipText(enemy: EnemyState): string {
  const title = enemy.description || `${enemy.difficulty} ${enemy.type}`;
  return `${title}\n${enemy.difficulty.toUpperCase()} ${enemy.type.toUpperCase()}\nHP ${enemy.hp}/${enemy.maxHp} · DMG ${enemy.damage} · RNG ${enemy.range}`;
}

function showTooltip(event: PointerEvent, enemy: EnemyState): void {
  const tooltip = getTooltip();
  tooltip.textContent = tooltipText(enemy);
  tooltip.classList.add('visible');
  moveTooltip(event);
}

function hideTooltip(): void {
  getTooltip().classList.remove('visible');
}

function createEnemySvg(enemy: EnemyState): SVGGElement {
  const group = document.createElementNS(NS, 'g');

  group.setAttribute('class', `enemy-token enemy-${enemy.difficulty} enemy-${enemy.type}`);

  group.setAttribute('data-enemy-id', enemy.id);

  group.innerHTML = `
    <circle
      class="enemy-body"
      cx="0"
      cy="0"
      r="12"
    />

    <circle
      class="enemy-hp-ring"
      cx="0"
      cy="0"
      r="15"
      pathLength="100"
      transform="rotate(-90)"
    />

    <g class="enemy-icon-wrap">
      <path
        class="enemy-icon-outline"
        d="
          M 119 68
          C 99 79, 84 96, 86 117
          C 87 132, 95 143, 108 150

          C 106 184, 112 217, 128 244
          C 140 265, 157 276, 181 277
          C 205 277, 223 265, 235 244
          C 251 217, 257 184, 254 150

          C 267 144, 275 132, 277 117
          C 279 96, 265 79, 246 68
          C 239 64, 235 68, 237 76
          L 244 99

          C 226 106, 204 110, 181 110
          C 157 110, 136 106, 117 99

          L 126 76
          C 129 68, 125 64, 119 68
          Z
        "
      />

      <path
        class="enemy-icon-fill"
        d="
          M 136 169
          L 169 179
          C 170 193, 162 205, 149 207
          C 136 208, 127 200, 127 188
          C 127 179, 131 173, 136 169
          Z
        "
      />

      <path
        class="enemy-icon-fill"
        d="
          M 220 169
          L 183 181
          C 180 194, 187 208, 202 214
          C 215 219, 228 211, 231 197
          C 233 185, 228 175, 220 169
          Z
        "
      />
    </g>
  `;

  group.addEventListener('pointerenter', (event) => {
    showTooltip(event, enemy);
  });

  group.addEventListener('pointermove', moveTooltip);
  group.addEventListener('pointerleave', hideTooltip);

  group.addEventListener('click', (event) => {
    if ((event as MouseEvent).button !== 0) return;

    event.stopPropagation();
    tryPlayerAttack(enemy);
  });

  return group;
}

function updateEnemyElement(enemy: EnemyState): void {
  if (!state.ctx) return;

  const [x, y] = state.ctx.toPx(enemy.gx, enemy.gy);
  enemy.element.setAttribute('transform', `translate(${x} ${y})`);
  enemy.element.classList.toggle('enemy-active', enemy.active && enemy.hp > 0);
  enemy.element.classList.toggle('enemy-defeated', enemy.hp <= 0);

  const hpRing = enemy.element.querySelector('.enemy-hp-ring') as SVGCircleElement | null;
  if (!hpRing) return;

  const hpPercent = Math.max(0, Math.min(100, enemy.hp / enemy.maxHp * 100));
  hpRing.style.strokeDasharray = `${hpPercent} 100`;
  hpRing.style.strokeDashoffset = '0';
}

function livingEnemiesInRoom(roomId: number): EnemyState[] {
  return state.enemies.filter((enemy) => enemy.roomId === roomId && enemy.hp > 0);
}

function activateCurrentRoom(): void {
  const roomId = state.hero?.getRoomId() ?? null;
  const roomEnemies = roomId === null ? [] : livingEnemiesInRoom(roomId);

  state.activeRoomId = roomEnemies.length ? roomId : null;

  state.enemies.forEach((enemy) => {
    enemy.active = state.activeRoomId !== null && enemy.roomId === state.activeRoomId && enemy.hp > 0;
    updateEnemyElement(enemy);
  });

  updateCombatStatus();
}

function damagePlayer(amount: number): void {
  if (state.phase === 'dead') return;

  applyPlayerDamage(amount);

  if (getPlayerStats().hp <= 0) {
    state.phase = 'dead';
    state.hero?.onDeath();
  }

  updateCombatStatus();
}

function canEnemyMoveTo(enemy: EnemyState, point: Point): boolean {
  const room = state.ctx?.byId.get(enemy.roomId);
  const hero = state.hero?.getPosition();

  if (!room || !insideRoom(room, point.gx, point.gy)) return false;
  if (hero && hero.gx === point.gx && hero.gy === point.gy) return false;
  return !enemyAt(point.gx, point.gy, enemy.id);
}

function moveEnemy(enemy: EnemyState, away: boolean): boolean {
  const hero = state.hero?.getPosition();
  if (!hero) return false;

  const candidates: Point[] = [
    { gx: enemy.gx + 1, gy: enemy.gy },
    { gx: enemy.gx - 1, gy: enemy.gy },
    { gx: enemy.gx, gy: enemy.gy + 1 },
    { gx: enemy.gx, gy: enemy.gy - 1 },
  ].filter((point) => canEnemyMoveTo(enemy, point));

  candidates.sort((a, b) => {
    const diff = distance(a, hero) - distance(b, hero);
    return away ? -diff : diff;
  });

  const next = candidates[0];
  if (!next) return false;

  enemy.gx = next.gx;
  enemy.gy = next.gy;
  updateEnemyElement(enemy);
  return true;
}

function enemyAction(enemy: EnemyState): void {
  const hero = state.hero?.getPosition();

  if (
    !hero ||
    enemy.hp <= 0 ||
    getPlayerStats().hp <= 0
  ) {
    return;
  }

  const dist = attackDistance(enemy, hero);

  if (enemy.type === 'melee') {
    if (dist <= 1) {
      damagePlayer(enemy.damage);
    } else {
      moveEnemy(enemy, false);
    }

    return;
  }

  if (
    enemy.type === 'ranged' &&
    dist <= 1 &&
    moveEnemy(enemy, true)
  ) {
    return;
  }

  if (dist <= enemy.range) {
    damagePlayer(enemy.damage);
  } else {
    moveEnemy(enemy, false);
  }
}

function runEnemyPhase(): void {
  const roomId = state.activeRoomId;
  if (roomId === null || state.phase === 'dead') return;

  state.phase = 'enemy';
  updateCombatStatus();

  for (const enemy of livingEnemiesInRoom(roomId)) {
    enemyAction(enemy);
    if (getPlayerStats().hp <= 0) return;
  }

  state.phase = 'player';
  activateCurrentRoom();
}

function tryPlayerAttack(enemy: EnemyState): void {
  if (
    state.phase !== 'player' ||
    getPlayerStats().hp <= 0 ||
    !enemy.active ||
    enemy.hp <= 0
  ) {
    return;
  }

  const hero = state.hero?.getPosition();

  if (
    !hero ||
    attackDistance(hero, enemy) > 1
  ) {
    return;
  }

  enemy.hp = Math.max(0, enemy.hp - getPlayerStats().attack);

  updateEnemyElement(enemy);

  if (enemy.hp === 0) {
    hideTooltip();
  }

  const tooltip = getTooltip();

  if (tooltip.classList.contains('visible')) {
    tooltip.textContent = tooltipText(enemy);
  }

  if (!livingEnemiesInRoom(enemy.roomId).length) {
    state.activeRoomId = null;
    enemy.active = false;

    updateEnemyElement(enemy);
    updateCombatStatus();

    return;
  }

  runEnemyPhase();
}

function enemyFromMarker(marker: NarrativeContentMarker): EnemyState {
  const content: NarrativeContent = marker.content;
  const difficulty = normalizeDifficulty(content.difficulty);
  const type = normalizeEnemyType(content.enemyType);
  const maxHp = ENEMY_HP[difficulty];

  const enemy = {
    id: marker.id,
    roomId: marker.roomId,
    description: marker.description,
    type,
    difficulty,
    hp: maxHp,
    maxHp,
    damage: ENEMY_DAMAGE[difficulty],
    range: ENEMY_RANGE[type],
    gx: marker.gx,
    gy: marker.gy,
    active: false,
    element: document.createElementNS(NS, 'g'),
  } satisfies EnemyState;

  enemy.element = createEnemySvg(enemy);
  return enemy;
}

export function renderEnemies(
  ctx: RenderContext,
  markers: NarrativeContentMarker[] = [],
): void {
  hideTooltip();
  resetPlayerStats();

  state.ctx = ctx;
  state.hero = null;
  state.activeRoomId = null;
  state.phase = 'player';

  state.enemies = markers
    .filter((marker) => marker.kind === 'enemy')
    .map(enemyFromMarker);

  state.enemies.forEach((enemy) => {
    ctx.svg.appendChild(enemy.element);
    updateEnemyElement(enemy);

    const marker = markers.find((item) => item.id === enemy.id);

    if (marker) {
      marker.element = enemy.element;
    }
  });

  updateCombatStatus();
}

export function bindHeroCombat(hero: HeroBridge): void {
  state.hero = hero;
}

export function notifyHeroPositionChanged(): void {
  activateCurrentRoom();
}

export function completeHeroMove(): void {
  activateCurrentRoom();

  if (state.activeRoomId !== null && state.phase === 'player') {
    runEnemyPhase();
  }
}

export function canHeroAct(): boolean {
  return state.phase === 'player' && getPlayerStats().hp > 0;
}

export function canHeroMoveToRoom(roomId: number | null): boolean {
  if (!canHeroAct()) return false;
  if (state.activeRoomId === null) return true;
  return roomId === state.activeRoomId;
}

export function isEnemyCell(gx: number, gy: number): boolean {
  return enemyAt(gx, gy) !== null;
}
