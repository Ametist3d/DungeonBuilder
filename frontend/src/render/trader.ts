// import type { LootItem } from '../types';
import type { RenderContext } from './context';
import type { NarrativeContentMarker } from './narrative-content';
import { getPlayerStats, spendGold} from './player-stats';
import { addLootItems } from './inventory';

interface PotionOffer {
  id: string;
  name: string;
  size: 'S' | 'M' | 'L' | 'XL';
  heal: number;
  cost: number;
  description: string;
}

const POTION_MENU: PotionOffer[] = [
  { id: 'potion-s', name: 'Minor Healing Potion', size: 'S', heal: 15, cost: 15, description: 'A quick sip. Restores 15 HP.' },
  { id: 'potion-m', name: 'Healing Potion', size: 'M', heal: 30, cost: 28, description: 'A standard remedy. Restores 30 HP.' },
  { id: 'potion-l', name: 'Greater Healing Potion', size: 'L', heal: 55, cost: 48, description: 'A potent brew. Restores 55 HP.' },
  { id: 'potion-xl', name: 'Superior Healing Potion', size: 'XL', heal: 90, cost: 75, description: 'Near-full recovery. Restores 90 HP.' },
];


let openTraderId: string | null = null;
let cellTraderId: string | null = null;
const tradersByCell = new Map<string, NarrativeContentMarker>();

function cellKey(gx: number, gy: number): string {
  return `${Math.round(gx * 2)}:${Math.round(gy * 2)}`;
}

// --- item hover detail popup: same visual class as narrative-element-tooltip ---
const DETAIL_TOOLTIP_ID = 'trade-item-tooltip';

function getDetailTooltip(): HTMLDivElement {
  let el = document.getElementById(DETAIL_TOOLTIP_ID) as HTMLDivElement | null;

  if (!el) {
    el = document.createElement('div');
    el.id = DETAIL_TOOLTIP_ID;
    el.className = 'narrative-element-tooltip';
    document.body.appendChild(el);
  }

  return el;
}

function moveDetailTooltip(e: PointerEvent): void {
  const el = getDetailTooltip();
  const gap = 14;

  el.style.left = `${e.clientX + gap}px`;
  el.style.top = `${e.clientY + gap}px`;

  const rect = el.getBoundingClientRect();

  if (rect.right > window.innerWidth - 8) {
    el.style.left = `${e.clientX - rect.width - gap}px`;
  }

  if (rect.bottom > window.innerHeight - 8) {
    el.style.top = `${e.clientY - rect.height - gap}px`;
  }
}

function showDetailTooltip(e: PointerEvent, offer: PotionOffer): void {
  const el = getDetailTooltip();
  el.textContent = `${offer.name}\n${offer.description}\nCost: ${offer.cost} gold`;
  el.classList.add('visible');
  moveDetailTooltip(e);
}

function hideDetailTooltip(): void {
  getDetailTooltip().classList.remove('visible');
}

// --- trade panel (click-to-open, persistent list) ---
function getPanel(): HTMLDivElement {
  let panel = document.getElementById('trade-panel') as HTMLDivElement | null;
  if (panel) return panel;

  panel = document.createElement('div');
  panel.id = 'trade-panel';
  panel.className = 'trade-panel';

  panel.addEventListener('click', (e) => e.stopPropagation());
  document.body.appendChild(panel);

  return panel;
}

function closeTradePanel(): void {
  openTraderId = null;
  document.getElementById('trade-panel')?.classList.remove('visible');
  hideDetailTooltip();
}

function flashDenied(panel: HTMLDivElement, itemId: string): void {
  const row = panel.querySelector(`[data-item-id="${itemId}"]`);
  if (!row) return;

  row.classList.remove('trade-item-denied');
  void (row as HTMLElement).offsetWidth; // restart animation
  row.classList.add('trade-item-denied');
}

function attemptPurchase(offer: PotionOffer, panel: HTMLDivElement, marker: NarrativeContentMarker): void {
  const stats = getPlayerStats();

  if (stats.gold < offer.cost) {
    flashDenied(panel, offer.id);
    return;
  }

  spendGold(offer.cost);

  addLootItems([{
    name: offer.name,
    type: 'hpPotion',
    value: offer.heal,
    description: offer.description,
  }]);

  renderPanelContent(panel, marker);
}

function renderPanelContent(panel: HTMLDivElement, marker: NarrativeContentMarker): void {
  const stats = getPlayerStats();
  const traderName = marker.description.trim() || 'Traveling Merchant';

  panel.replaceChildren();

  const header = document.createElement('div');
  header.className = 'trade-panel-header';

  const title = document.createElement('span');
  title.className = 'trade-panel-title';
  title.textContent = traderName;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'trade-panel-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTradePanel();
  });

  header.appendChild(title);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const list = document.createElement('ul');
  list.className = 'trade-list';

  POTION_MENU.forEach((offer) => {
    const affordable = stats.gold >= offer.cost;

    const row = document.createElement('li');
    row.className = `trade-item${affordable ? '' : ' trade-item-unaffordable'}`;
    row.setAttribute('data-item-id', offer.id);

    const name = document.createElement('span');
    name.className = 'trade-item-name';
    name.textContent = `${offer.size} · ${offer.name}`;

    const cost = document.createElement('span');
    cost.className = 'trade-item-cost';
    cost.textContent = `${offer.cost}g`;

    row.appendChild(name);
    row.appendChild(cost);

    row.addEventListener('pointerenter', (e) => showDetailTooltip(e as PointerEvent, offer));
    row.addEventListener('pointermove', (e) => moveDetailTooltip(e as PointerEvent));
    row.addEventListener('pointerleave', hideDetailTooltip);

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      attemptPurchase(offer, panel, marker);
    });

    list.appendChild(row);
  });

  panel.appendChild(list);
}

function openPanelAt(x: number, y: number, marker: NarrativeContentMarker): void {
  openTraderId = marker.id;

  const panel = getPanel();
  renderPanelContent(panel, marker);

  panel.style.left = `${x}px`;
  panel.style.top = `${y}px`;
  panel.classList.add('visible');

  const rect = panel.getBoundingClientRect();
  if (rect.right > window.innerWidth - 8) panel.style.left = `${window.innerWidth - rect.width - 8}px`;
  if (rect.bottom > window.innerHeight - 8) panel.style.top = `${window.innerHeight - rect.height - 8}px`;
  if (rect.left < 8) panel.style.left = '8px';
  if (rect.top < 8) panel.style.top = '8px';
}

function openTradePanel(event: MouseEvent, marker: NarrativeContentMarker): void {
  if (openTraderId === marker.id) {
    closeTradePanel();
    return;
  }

  openPanelAt(event.clientX + 14, event.clientY + 14, marker);
}

function openTraderAtMarker(marker: NarrativeContentMarker): void {
  const rect = marker.element?.getBoundingClientRect();
  const x = rect ? rect.left + rect.width / 2 + 16 : window.innerWidth / 2;
  const y = rect ? rect.top + rect.height / 2 + 16 : window.innerHeight / 2;

  openPanelAt(x, y, marker);
}

document.addEventListener('click', () => closeTradePanel());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeTradePanel();
});

export function renderTraders(
  ctx: RenderContext,
  markers: NarrativeContentMarker[] = [],
): void {
  closeTradePanel();
  cellTraderId = null;
  tradersByCell.clear();

  markers
    .filter((marker) => marker.kind === 'npc')
    .forEach((marker) => {
      const element = marker.element;
      if (!element) return;

      element.classList.add('narrative-element-marker-trader');
      tradersByCell.set(cellKey(marker.gx, marker.gy), marker);

      element.addEventListener('click', (event) => {
        event.stopPropagation();
        openTradePanel(event as MouseEvent, marker);
      });
    });
}

export function notifyHeroEnteredCell(gx: number, gy: number): void {
  const key = cellKey(gx, gy);
  const marker = tradersByCell.get(key);

  if (marker) {
    if (cellTraderId !== marker.id) {
      cellTraderId = marker.id;
      openTraderAtMarker(marker);
    }
    return;
  }

  if (cellTraderId) {
    cellTraderId = null;
    closeTradePanel();
  }
}