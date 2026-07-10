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
  clue: 'Scroll / clue',
  ritualObject: 'Mechanism',
  hazard: 'Hazard',
  secret: 'Key / secret',
};

const DOOR_MATERIAL_ROWS = [
  { label: 'Open passage', className: 'door-open' },
  { label: 'Wood door', className: 'door-wood' },
  { label: 'Iron door', className: 'door-iron' },
  { label: 'Stone door', className: 'door-stone' },
  { label: 'Bone door', className: 'door-bone' },
  { label: 'Arcane door', className: 'door-arcane' },
];

const LOCK_ROWS = [
  { label: 'Lock — key', className: 'door-locked' },
  { label: 'Puzzle — mech', className: 'door-puzzleSealed' },
  { label: 'Magic — scroll', className: 'door-magicSealed' },
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

function swatchRows(rows: { label: string; className: string }[]): string {
  return rows
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
    <div class="map-ui-topbar">
      <div class="map-ui-compass" aria-label="Compass">
        <div class="map-ui-compass-n">N</div>
        <div class="map-ui-compass-needle"></div>
      </div>

      <button class="map-ui-settings-toggle" type="button" aria-label="Hide settings" title="Hide settings">
        ▸
      </button>
    </div>

    <section class="map-ui-legend" aria-label="Map legend">
      <h3>Legend</h3>

      <div class="map-ui-section">Elements</div>
      ${elementRows()}

    <div class="map-ui-section map-ui-section-doors">Door types</div>
    ${swatchRows(DOOR_MATERIAL_ROWS)}

    <div class="map-ui-section map-ui-section-locks">Lock types</div>
    ${swatchRows(LOCK_ROWS)}
    </section>
  `;

  const toggle = overlay.querySelector('.map-ui-settings-toggle') as HTMLButtonElement;
  const shell = document.querySelector('.app-shell');

  toggle.addEventListener('click', () => {
    shell?.classList.toggle('settings-collapsed');

    const collapsed = shell?.classList.contains('settings-collapsed') ?? false;
    toggle.textContent = collapsed ? '◂' : '▸';
    toggle.setAttribute('aria-label', collapsed ? 'Show settings' : 'Hide settings');
    toggle.setAttribute('title', collapsed ? 'Show settings' : 'Hide settings');
  });

  container.appendChild(overlay);
}
