import type { LootItem } from '../types';

export interface PlayerStats {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  defense: number;
  attack: number;
  gold: number;
  spells: string[];
}

type StatsListener = (stats: PlayerStats) => void;

const BASE_STATS: PlayerStats = {
  hp: 20,
  maxHp: 20,
  mp: 10,
  maxMp: 10,
  defense: 0,
  attack: 3,
  gold: 0,
  spells: [],
};

let state: PlayerStats = cloneStats(BASE_STATS);
let statusText = 'Exploration';
let combatActive = false;
let defeated = false;

const listeners = new Set<StatsListener>();

function cloneStats(stats: PlayerStats): PlayerStats {
  return {
    ...stats,
    spells: [...stats.spells],
  };
}

function getHud(): HTMLDivElement {
  let hud = document.getElementById(
    'player-hud',
  ) as HTMLDivElement | null;

  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'player-hud';
    hud.className = 'player-hud';

    document
      .getElementById('canvas-wrap')
      ?.appendChild(hud);
  }

  return hud;
}

function renderHud(): void {
  const hud = getHud();

  hud.innerHTML = `
    <div class="player-hud-stats">
      <span>HP <b>${state.hp}/${state.maxHp}</b></span>
      <span>MP <b>${state.mp}/${state.maxMp}</b></span>
      <span>DEF <b>${state.defense}</b></span>
      <span>ATK <b>${state.attack}</b></span>
      <span>Gold <b>${state.gold}</b></span>
    </div>
    <div class="player-hud-status">${statusText}</div>
  `;

  hud.classList.toggle(
    'combat-active',
    combatActive,
  );

  hud.classList.toggle(
    'player-defeated',
    defeated,
  );
}

function emit(): void {
  const snapshot = cloneStats(state);

  listeners.forEach((listener) => {
    listener(snapshot);
  });

  renderHud();
}

export function resetPlayerStats(): void {
  state = cloneStats(BASE_STATS);
  statusText = 'Exploration';
  combatActive = false;
  defeated = false;
  emit();
}

export function getPlayerStats(): PlayerStats {
  return cloneStats(state);
}

export function subscribePlayerStats(
  listener: StatsListener,
): () => void {
  listeners.add(listener);
  listener(cloneStats(state));

  return () => {
    listeners.delete(listener);
  };
}

export function setPlayerStatus(
  text: string,
  activeCombat = false,
  isDefeated = false,
): void {
  statusText = text;
  combatActive = activeCombat;
  defeated = isDefeated;
  renderHud();
}

export function damagePlayer(rawDamage: number): number {
  const damage = Math.max(
    1,
    Math.round(rawDamage) - state.defense,
  );

  state.hp = Math.max(
    0,
    state.hp - damage,
  );

  emit();
  return damage;
}

export function applyLoot(items: LootItem[]): void {
  for (const item of items) {
    const value = Math.max(
      0,
      Math.round(Number(item.value) || 0),
    );

    switch (item.type) {
      case 'armor':
        state.defense = Math.max(
          state.defense,
          value,
        );
        break;

      case 'weapon':
        state.attack = Math.max(
          state.attack,
          value,
        );
        break;

      case 'treasure':
        state.gold += value;
        break;

      case 'spell':
        if (!state.spells.includes(item.name)) {
          state.spells.push(item.name);
        }
        break;

      case 'hpPotion':
        state.hp = Math.min(
          state.maxHp,
          state.hp + value,
        );
        break;

      case 'manaPotion':
        state.mp = Math.min(
          state.maxMp,
          state.mp + value,
        );
        break;
    }
  }

  emit();
}
