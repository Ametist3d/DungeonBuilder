import type {
  LootItem,
  LootType,
} from '../types';

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

const inventory = new Map<
  string,
  InventoryEntry
>();

let collapsed = false;

const KIND_LABELS: Record<
  InventoryKind,
  string
> = {
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
  let panel = document.getElementById(
    'inventory-panel',
  ) as HTMLDivElement | null;

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

  const toggle = panel.querySelector(
    '.inventory-toggle',
  ) as HTMLButtonElement;

  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    renderInventory();
  });

  document
    .getElementById('canvas-wrap')
    ?.appendChild(panel);

  return panel;
}

function valueText(
  entry: InventoryEntry,
): string {
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

function renderInventory(): void {
  const panel = getPanel();

  panel.classList.toggle(
    'inventory-collapsed',
    collapsed,
  );

  const toggle = panel.querySelector(
    '.inventory-toggle',
  ) as HTMLButtonElement;

  const icon = panel.querySelector(
    '.inventory-toggle-icon',
  ) as HTMLSpanElement;

  const list = panel.querySelector(
    '.inventory-list',
  ) as HTMLUListElement;

  const empty = panel.querySelector(
    '.inventory-empty',
  ) as HTMLParagraphElement;

  toggle.setAttribute(
    'aria-expanded',
    String(!collapsed),
  );

  icon.textContent = collapsed
    ? '▸'
    : '▾';

  list.replaceChildren();

  const entries = [...inventory.values()];

  empty.hidden = entries.length > 0;

  entries.forEach((entry) => {
    const item = document.createElement('li');
    item.className = 'inventory-item';

    const name = document.createElement('span');
    name.className = 'inventory-item-name';

    const quantity = entry.quantity > 1
      ? ` ×${entry.quantity}`
      : '';

    name.textContent =
      `${KIND_LABELS[entry.kind]}: ${entry.name}${quantity}`;

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

export function addInventoryItem(
  item: InventoryItemInput,
): void {
  const existing = inventory.get(item.id);

  if (existing) {
    existing.quantity += Math.max(
      1,
      item.quantity || 1,
    );
  } else {
    inventory.set(item.id, {
      id: item.id,
      kind: item.kind,
      name: item.name,
      value: item.value,
      quantity: Math.max(
        1,
        item.quantity || 1,
      ),
    });
  }

  renderInventory();
}

export function addLootItems(
  items: LootItem[],
): void {
  items.forEach((item) => {
    addInventoryItem({
      id: `loot:${item.type}:${item.name}`,
      kind: item.type,
      name: item.name,
      value: item.value,
    });
  });
}
