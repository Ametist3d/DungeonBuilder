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
  level: number;
  xp: number;
}

type StatsListener = (stats: PlayerStats) => void;

const BASE_STATS: PlayerStats = {
  hp: 40,
  maxHp: 40,
  mp: 20,
  maxMp: 20,
  defense: 0,
  attack: 3,
  gold: 0,
  spells: [],
  level: 1,
  xp: 0,
};

const XP_THRESHOLDS = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
  85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
];
const MAX_LEVEL = XP_THRESHOLDS.length;
const HP_PER_LEVEL = 8;
const MP_PER_LEVEL = 4;

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
  let hud = document.getElementById('player-hud') as HTMLDivElement | null;

  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'player-hud';
    hud.className = 'player-hud';

    document.getElementById('canvas-wrap')?.appendChild(hud);
  }

  return hud;
}

function xpProgressPercent(): number {
  if (state.level >= MAX_LEVEL) return 100;

  const prev = XP_THRESHOLDS[state.level - 1];
  const next = XP_THRESHOLDS[state.level];
  const span = next - prev;

  return span > 0 ? Math.max(0, Math.min(100, ((state.xp - prev) / span) * 100)) : 100;
}

function renderHud(): void {
  const hud = getHud();

  hud.innerHTML = `
    <div class="player-hud-stats">
      <span>Lv <b>${state.level}</b></span>
      <span>HP <b>${state.hp}/${state.maxHp}</b></span>
      <span>MP <b>${state.mp}/${state.maxMp}</b></span>
      <span>DEF <b>${state.defense}</b></span>
      <span>ATK <b>${state.attack}</b></span>
      <span>Gold <b>${state.gold}</b></span>
    </div>
    <div class="player-hud-xp">
      <div class="player-hud-xp-bar" style="width:${xpProgressPercent()}%"></div>
    </div>
    <div class="player-hud-status">${statusText}</div>
  `;

  hud.classList.toggle('combat-active', combatActive);
  hud.classList.toggle('player-defeated', defeated);
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

export function subscribePlayerStats(listener: StatsListener): () => void {
  listeners.add(listener);
  listener(cloneStats(state));

  return () => {
    listeners.delete(listener);
  };
}

export function setPlayerStatus(text: string, activeCombat = false, isDefeated = false): void {
  statusText = text;
  combatActive = activeCombat;
  defeated = isDefeated;
  renderHud();
}

export function damagePlayer(rawDamage: number): number {
  const damage = Math.max(1, Math.round(rawDamage) - state.defense);
  state.hp = Math.max(0, state.hp - damage);

  emit();
  return damage;
}

export function applyLoot(items: LootItem[]): void {
  for (const item of items) {
    const value = Math.max(0, Math.round(Number(item.value) || 0));

    switch (item.type) {
      case 'armor':
        state.defense = Math.max(state.defense, value);
        break;

      case 'weapon':
        state.attack = Math.max(state.attack, value);
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
        state.hp = Math.min(state.maxHp, state.hp + value);
        break;

      case 'manaPotion':
        state.mp = Math.min(state.maxMp, state.mp + value);
        break;
    }
  }

  emit();
}

export function addExperience(amount: number): { levels: number; hpGain: number; mpGain: number } {
  const gained = Math.max(0, Math.round(amount));
  if (gained <= 0) return { levels: 0, hpGain: 0, mpGain: 0 };

  state.xp += gained;

  let levels = 0;
  let hpGain = 0;
  let mpGain = 0;

  while (state.level < MAX_LEVEL && state.xp >= XP_THRESHOLDS[state.level]) {
    state.level += 1;
    levels += 1;
    hpGain += HP_PER_LEVEL;
    mpGain += MP_PER_LEVEL;
  }

  if (levels > 0) {
    state.maxHp += hpGain;
    state.hp += hpGain;
    state.maxMp += mpGain;
    state.mp += mpGain;
  }

  emit();

  return { levels, hpGain, mpGain };
}