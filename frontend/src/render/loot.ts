import type { LootItem, LootType } from '../types';
import { NS, type RenderContext } from './context';
import type { NarrativeContentMarker } from './narrative-content';
import { ensureNarrativeElementSymbols, markerId } from './narrative-elements';
import { applyLoot } from './player-stats';
import { addLootItems } from './inventory';

type LootState = {
  marker: NarrativeContentMarker;
  items: LootItem[];
  element: SVGGElement;
  picked: boolean;
};

const lootByCell = new Map<string, LootState>();

const LOOT_LABELS: Record<LootType, string> = {
  armor: 'Armor',
  weapon: 'Weapon',
  treasure: 'Treasure',
  spell: 'Spell',
  hpPotion: 'HP potion',
  manaPotion: 'Mana potion',
};

function cellKey(gx: number, gy: number): string {
  return `${Math.round(gx * 2)}:${Math.round(gy * 2)}`;
}

function normalizeItems(marker: NarrativeContentMarker): LootItem[] {
  const items = marker.content.loot;

  if (Array.isArray(items) && items.length) {
    return items.slice(0, 3);
  }

  return [
    {
      name: marker.description || 'Coin cache',
      type: 'treasure',
      value: 10,
      description: 'A small cache of valuables.',
    },
  ];
}

function itemEffect(item: LootItem): string {
  switch (item.type) {
    case 'armor':
      return `${item.value} DEF`;

    case 'weapon':
      return `${item.value} ATK`;

    case 'treasure':
      return `+${item.value} Gold`;

    case 'spell':
      return 'Spell learned';

    case 'hpPotion':
      return `Restore ${item.value} HP`;

    case 'manaPotion':
      return `Restore ${item.value} MP`;
  }
}

function tooltipText(loot: LootState): string {
  const header =
    loot.marker.description ||
    'Loot chest';

  const items = loot.items
    .map((item) => {
      const label = LOOT_LABELS[item.type];
      const description = item.description?.trim();
      const suffix = description
        ? `\n   ${description}`
        : '';

      return `• ${item.name} — ${label}, ${itemEffect(item)}${suffix}`;
    })
    .join('\n');

  return `${header}\n\n${items}`;
}

function getTooltip(): HTMLDivElement {
  let tooltip = document.getElementById('loot-tooltip') as HTMLDivElement | null;

  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'loot-tooltip';
    tooltip.className = 'loot-tooltip';
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

function showTooltip(event: PointerEvent, loot: LootState): void {
  const tooltip = getTooltip();
  tooltip.textContent = tooltipText(loot);
  tooltip.classList.add('visible');
  moveTooltip(event);
}

function hideTooltip(): void {
  getTooltip().classList.remove('visible');
}

function createLootElement(ctx: RenderContext, marker: NarrativeContentMarker, items: LootItem[]): LootState {
  ensureNarrativeElementSymbols(ctx);

  const group = document.createElementNS(NS, 'g');
  group.setAttribute('class', 'loot-marker');
  group.setAttribute('transform', `translate(${marker.x} ${marker.y})`);

  const background = document.createElementNS(NS, 'circle');
  background.setAttribute('r', '12');
  background.setAttribute('class', 'loot-marker-background');

  const icon = document.createElementNS(NS, 'use');
  icon.setAttribute('href', `#${markerId('loot')}`);
  icon.setAttribute('x', '-12');
  icon.setAttribute('y', '-12');
  icon.setAttribute('width', '24');
  icon.setAttribute('height', '24');
  icon.setAttribute('class', 'loot-chest-icon');

  group.appendChild(background);
  group.appendChild(icon);

  const loot: LootState = {
    marker,
    items,
    element: group,
    picked: false,
  };

  group.addEventListener('pointerenter', (event) => showTooltip(event, loot));
  group.addEventListener('pointermove', moveTooltip);
  group.addEventListener('pointerleave', hideTooltip);

  return loot;
}

export function renderLoot(
  ctx: RenderContext,
  markers: NarrativeContentMarker[] = [],
): void {
  hideTooltip();
  lootByCell.clear();

  markers
    .filter((marker) => marker.kind === 'loot')
    .forEach((marker) => {
      const items = normalizeItems(marker);
      const loot = createLootElement(ctx, marker, items);
      lootByCell.set(cellKey(marker.gx, marker.gy), loot);

      marker.element = loot.element;
      ctx.svg.appendChild(loot.element);
    });
}

export function pickupLootAt(
  gx: number,
  gy: number,
): boolean {
  const key = cellKey(gx, gy);
  const loot = lootByCell.get(key);

  if (!loot || loot.picked) {
    return false;
  }

  loot.picked = true;

  applyLoot(loot.items);
  addLootItems(loot.items);

  loot.element.classList.add('picked');

  lootByCell.delete(key);
  hideTooltip();

  return true;
}
