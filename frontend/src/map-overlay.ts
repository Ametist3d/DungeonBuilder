import {
  NARRATIVE_ELEMENT_KINDS,
  NARRATIVE_ELEMENT_SYMBOLS,
  type NarrativeElementKind,
} from './render/narrative-elements';

const ELEMENT_LABELS: Record<NarrativeElementKind, string> = {
  loot: 'Loot',
  enemy: 'Enemy',
  trap: 'Trap',
  npc: 'NPC',
  clue: 'Clue',
  ritualObject: 'Ritual',
  hazard: 'Hazard',
  secret: 'Secret',
};

const DOOR_ROWS = [
  { label: 'Open', className: 'door-open' },
  { label: 'Wood locked', className: 'door-wood door-locked' },
  { label: 'Iron locked', className: 'door-iron door-locked' },
  { label: 'Stone sealed', className: 'door-stone door-sealed' },
  { label: 'Bone sealed', className: 'door-bone door-sealed' },
  { label: 'Magic sealed', className: 'door-arcane door-magicSealed' },
  { label: 'Puzzle sealed', className: 'door-arcane door-puzzleSealed' },
];

function iconSvg(kind: NarrativeElementKind): string {
  return `
    <svg class="map-ui-icon" viewBox="-12 -12 24 24" aria-hidden="true">
      ${NARRATIVE_ELEMENT_SYMBOLS[kind]}
    </svg>
  `;
}

function elementRows(): string {
  return NARRATIVE_ELEMENT_KINDS
    .map((kind) => `
      <div class="map-ui-row">
        <span class="map-ui-icon-wrap">${iconSvg(kind)}</span>
        <span>${ELEMENT_LABELS[kind]}</span>
      </div>
    `)
    .join('');
}

function doorRows(): string {
  return DOOR_ROWS
    .map((door) => `
      <div class="map-ui-row">
        <span class="map-ui-door-swatch ${door.className}"></span>
        <span>${door.label}</span>
      </div>
    `)
    .join('');
}

export function setupMapOverlay(container: HTMLElement): void {
  if (container.querySelector('.map-ui-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'map-ui-overlay';
  overlay.innerHTML = `
    <div class="map-ui-compass" aria-label="Compass">
      <div class="map-ui-compass-n">N</div>
      <div class="map-ui-compass-needle"></div>
    </div>

    <section class="map-ui-legend" aria-label="Map legend">
      <h3>Legend</h3>

      <div class="map-ui-section">Elements</div>
      ${elementRows()}

      <div class="map-ui-section map-ui-section-doors">Doors</div>
      ${doorRows()}
    </section>
  `;

  container.appendChild(overlay);
}
