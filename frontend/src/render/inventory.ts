import type {
  LootItem,
  LootType,
} from '../types';
import { subscribePlayerStats, getPlayerStats, applyLoot, equipWeapon, unequipWeapon, equipArmor, unequipArmor } from './player-stats';

export type InventoryKind =
  | 'key'
  | 'scroll'
  | 'mechanism'
  | LootType;

export interface InventoryItemInput {
  id: string;
  kind: InventoryKind;
  name: string;
  value?: number;
  quantity?: number;
}

interface InventoryEntry {
  id: string;
  kind: InventoryKind;
  name: string;
  value?: number;
  quantity: number;
}

const inventory = new Map<string, InventoryEntry>();

let collapsed = false;
let goldTotal = 0;

subscribePlayerStats((stats) => {
  goldTotal = stats.gold;
  renderInventory();
});

const KIND_LABELS: Record<InventoryKind, string> = {
  key: 'Key',
  scroll: 'Scroll',
  mechanism: 'Mechanism',
  armor: 'Armour',
  weapon: 'Weapon',
  treasure: 'Treasure',
  spell: 'Spell',
  hpPotion: 'HP potion',
  manaPotion: 'Mana potion',
};

function getPanel(): HTMLDivElement {
  let panel = document.getElementById('inventory-panel') as HTMLDivElement | null;

  if (panel) return panel;

  panel = document.createElement('div');
  panel.id = 'inventory-panel';
  panel.className = 'inventory-panel';

  panel.innerHTML = `
    <button
      class="inventory-toggle"
      type="button"
      aria-expanded="true"
    >
      <span>Inventory</span>
      <span class="inventory-toggle-icon">▾</span>
    </button>

    <div class="inventory-body">
      <p class="inventory-empty">Empty</p>
      <ul class="inventory-list"></ul>
    </div>
  `;

  const toggle = panel.querySelector('.inventory-toggle') as HTMLButtonElement;

  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    renderInventory();
  });

  document.getElementById('canvas-wrap')?.appendChild(panel);

  return panel;
}

function valueText(entry: InventoryEntry): string {
  if (entry.value === undefined) {
    return '';
  }

  switch (entry.kind) {
    case 'armor':
      return `DEF ${entry.value}`;

    case 'weapon':
      return `ATK ${entry.value}`;

    case 'treasure':
      return `+${entry.value} gold`;

    case 'hpPotion':
      return `+${entry.value} HP`;

    case 'manaPotion':
      return `+${entry.value} MP`;

    default:
      return '';
  }
}

function flashDenied(id: string): void {
  const row = getPanel().querySelector(`[data-item-id="${id}"]`);
  if (!row) return;

  row.classList.remove('inventory-item-denied');
  void (row as HTMLElement).offsetWidth; // restart animation
  row.classList.add('inventory-item-denied');
}

function useConsumable(entry: InventoryEntry): void {
  const stats = getPlayerStats();
  const isFull = entry.kind === 'hpPotion' ? stats.hp >= stats.maxHp : stats.mp >= stats.maxMp;

  if (isFull) {
    flashDenied(entry.id);
    return;
  }

  applyLoot([{
    type: entry.kind as 'hpPotion' | 'manaPotion',
    value: entry.value ?? 0,
    name: entry.name,
  }]);

  entry.quantity -= 1;
  if (entry.quantity <= 0) {
    inventory.delete(entry.id);
  }

  renderInventory();
}

function toggleWeapon(entry: InventoryEntry): void {
  const stats = getPlayerStats();

  if (stats.equippedWeaponId === entry.id) {
    unequipWeapon();
  } else {
    equipWeapon(entry.id, entry.value ?? 0);
  }
}

function toggleArmor(entry: InventoryEntry): void {
  const stats = getPlayerStats();

  if (stats.equippedArmorId === entry.id) {
    unequipArmor();
  } else {
    equipArmor(entry.id, entry.value ?? 0);
  }
}

function handleItemClick(entry: InventoryEntry): void {
  if (entry.kind === 'hpPotion' || entry.kind === 'manaPotion') {
    useConsumable(entry);
  } else if (entry.kind === 'weapon') {
    toggleWeapon(entry);
  } else if (entry.kind === 'armor') {
    toggleArmor(entry);
  }
}

function renderInventory(): void {
  const panel = getPanel();

  panel.classList.toggle('inventory-collapsed', collapsed);

  const toggle = panel.querySelector('.inventory-toggle') as HTMLButtonElement;
  const icon = panel.querySelector('.inventory-toggle-icon') as HTMLSpanElement;
  const list = panel.querySelector('.inventory-list') as HTMLUListElement;
  const empty = panel.querySelector('.inventory-empty') as HTMLParagraphElement;

  toggle.setAttribute('aria-expanded', String(!collapsed));

  icon.textContent = collapsed
    ? '▸'
    : '▾';

  list.replaceChildren();

  if (goldTotal > 0) {
    const goldItem = document.createElement('li');
    goldItem.className = 'inventory-item inventory-item-gold';

    const goldName = document.createElement('span');
    goldName.className = 'inventory-item-name';
    goldName.textContent = 'Treasure';

    const goldValue = document.createElement('span');
    goldValue.className = 'inventory-item-value';
    goldValue.textContent = `${goldTotal} gold`;

    goldItem.appendChild(goldName);
    goldItem.appendChild(goldValue);
    list.appendChild(goldItem);
  }

  const entries = [...inventory.values()];

  empty.hidden = entries.length > 0 || goldTotal > 0;

  const stats = getPlayerStats();
  const interactiveKinds: InventoryKind[] = ['weapon', 'armor', 'hpPotion', 'manaPotion'];

  entries.forEach((entry) => {
    const item = document.createElement('li');
    item.className = 'inventory-item';
    item.setAttribute('data-item-id', entry.id);

    const isEquipped =
      (entry.kind === 'weapon' && stats.equippedWeaponId === entry.id) ||
      (entry.kind === 'armor' && stats.equippedArmorId === entry.id);

    if (interactiveKinds.includes(entry.kind)) {
      item.classList.add('inventory-item-clickable');
      item.addEventListener('click', () => handleItemClick(entry));
    }

    if (isEquipped) {
      item.classList.add('inventory-item-equipped');
    }
    const name = document.createElement('span');
    name.className = 'inventory-item-name';

    const quantity = entry.quantity > 1
      ? ` ×${entry.quantity}`
      : '';

    name.textContent =
      `${isEquipped ? '✓ ' : ''}${KIND_LABELS[entry.kind]}: ${entry.name}${quantity}`;

    const value = valueText(entry);

    item.appendChild(name);

    if (value) {
      const stats = document.createElement('span');
      stats.className = 'inventory-item-value';
      stats.textContent = value;
      item.appendChild(stats);
    }

    list.appendChild(item);
  });
}

export function resetInventory(): void {
  inventory.clear();
  renderInventory();
}

export function addInventoryItem(item: InventoryItemInput): void {
  const existing = inventory.get(item.id);

  if (existing) {
    existing.quantity += Math.max(1, item.quantity || 1);
  } else {
    inventory.set(item.id, {
      id: item.id,
      kind: item.kind,
      name: item.name,
      value: item.value,
      quantity: Math.max(1, item.quantity || 1),
    });
  }

  renderInventory();
}

export function addLootItems(
  items: LootItem[],
): void {
  items
    .filter((item) => item.type !== 'treasure')
    .forEach((item) => {
      addInventoryItem({
        id: `loot:${item.type}:${item.name}`,
        kind: item.type,
        name: item.name,
        value: item.value,
      });
    });
}

export function clearUnlockItems(): void {
  for (const [id, entry] of inventory) {
    if (entry.kind === 'key' || entry.kind === 'scroll' || entry.kind === 'mechanism') {
      inventory.delete(id);
    }
  }

  renderInventory();
}
