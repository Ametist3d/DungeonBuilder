import type { NarrativeContentMarker } from './narrative-content';
import {
  damagePlayer,
  getPlayerStats,
  setPlayerStatus,
} from './player-stats';

const TRAP_DAMAGE = 6;
const HAZARD_DAMAGE = 1;

const trapsByCell = new Map<string, NarrativeContentMarker>();

const hazardRooms = new Set<number>();

function cellKey(gx: number, gy: number): string {
  return `${Math.round(gx * 2)}:${Math.round(gy * 2)}`;
}

function setMarkerTooltip(marker: NarrativeContentMarker, text: string): void {
  if (!marker.element) return;
  marker.element.setAttribute('data-tooltip', text);
  marker.element.setAttribute('aria-label', text);
}

function applyDamage(amount: number): boolean {
  damagePlayer(amount);

  const alive = getPlayerStats().hp > 0;

  if (!alive) {
    setPlayerStatus('Defeated', false, true);
  }

  return alive;
}

function triggerTrap(marker: NarrativeContentMarker): void {
  marker.element?.classList.add('trap-triggered');
  const description = marker.description || 'Triggered trap';
  setMarkerTooltip(marker, `${description}\nTriggered`);
}

export function setupEnvironmentEffects(markers: NarrativeContentMarker[] = []): void {
  trapsByCell.clear();
  hazardRooms.clear();

  markers.forEach((marker) => {
    if (marker.kind === 'trap') {
      trapsByCell.set(cellKey(marker.gx, marker.gy), marker);
      setMarkerTooltip(marker, `${marker.description || 'Trap'}\nOne-time damage: ${TRAP_DAMAGE}`);
      return;
    }

    if (marker.kind === 'hazard') {
      hazardRooms.add(marker.roomId);
      setMarkerTooltip(marker, `${marker.description || 'Hazard'}\nDamage per move: ${HAZARD_DAMAGE}`);
    }
  });
}

export function applyStepEffects(gx: number, gy: number, roomId: number | null): boolean {
  const key = cellKey(gx, gy);
  const trap = trapsByCell.get(key);

  if (trap) {
    trapsByCell.delete(key);
    triggerTrap(trap);

    if (!applyDamage(TRAP_DAMAGE)) {
      return false;
    }
  }

  if (roomId !== null && hazardRooms.has(roomId)) {
    if (!applyDamage(HAZARD_DAMAGE)) {
      return false;
    }
  }

  return true;
}
