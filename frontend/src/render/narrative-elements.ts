import { NS, type RenderContext } from './context';

export type NarrativeElementKind =
  | 'loot'
  | 'enemy'
  | 'trap'
  | 'npc'
  | 'clue'
  | 'ritualObject'
  | 'hazard'
  | 'secret';

export const NARRATIVE_ELEMENT_KINDS: NarrativeElementKind[] = [
  'loot',
  'enemy',
  'trap',
  'npc',
  'clue',
  'ritualObject',
  'hazard',
  'secret',
];

const TOOLTIP_ID = 'narrative-element-tooltip';
const TOOLTIP_DELAY_MS = 45;

let tooltipTimer: number | null = null;

function getTooltip(): HTMLDivElement {
  let el = document.getElementById(TOOLTIP_ID) as HTMLDivElement | null;

  if (!el) {
    el = document.createElement('div');
    el.id = TOOLTIP_ID;
    el.className = 'narrative-element-tooltip';
    document.body.appendChild(el);
  }

  return el;
}

function moveTooltip(e: PointerEvent): void {
  const el = getTooltip();
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

function showTooltip(e: PointerEvent, text: string): void {
  const content = text.trim();
  if (!content) return;

  if (tooltipTimer !== null) {
    window.clearTimeout(tooltipTimer);
  }

  tooltipTimer = window.setTimeout(() => {
    const el = getTooltip();
    el.textContent = content;
    el.classList.add('visible');
    moveTooltip(e);
  }, TOOLTIP_DELAY_MS);
}

function hideTooltip(): void {
  if (tooltipTimer !== null) {
    window.clearTimeout(tooltipTimer);
    tooltipTimer = null;
  }

  getTooltip().classList.remove('visible');
}

const SYMBOL_SIZE = 24;
const SYMBOL_PREFIX = 'narrative-element-symbol';

export const NARRATIVE_ELEMENT_SYMBOLS: Record<NarrativeElementKind, string> = {
  loot: `
    <path d="M-7,-3 L-3,-8 L5,-8 L9,-3 L1,8 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <path d="M-7,-3 H9 M-3,-8 L1,8 M5,-8 L1,8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  `,

  enemy: `
    <path d="M-7,-1 C-7,-7 -3,-10 1,-10 C5,-10 9,-7 9,-1 C9,3 7,5 4,6 L4,9 H-2 L-2,6 C-5,5 -7,3 -7,-1 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="-3" cy="-2" r="1.5" fill="currentColor"/>
    <circle cx="4" cy="-2" r="1.5" fill="currentColor"/>
    <path d="M0,2 L-1,5 H2 Z" fill="currentColor"/>
  `,

    trap: `
    <path d="
        M-8.2,7.4
        H8.2
        C9,7.4 9.4,6.9 9.4,6.1
        L9,-0.8
        C8.9,-1.8 8.3,-2.4 7.5,-2.4
        C6.8,-2.4 6.3,-1.8 6.1,-0.8
        L5.5,3.8

        L3.8,-6
        C3.6,-7 3.1,-7.5 2.4,-7.5
        C1.7,-7.5 1.2,-7 1.1,-6
        L0.3,3.8

        L-1.5,-6
        C-1.7,-7 -2.2,-7.5 -2.9,-7.5
        C-3.6,-7.5 -4.1,-7 -4.3,-6
        L-5.1,3.8

        L-6.6,-0.8
        C-6.9,-1.8 -7.4,-2.4 -8.1,-2.4
        C-8.9,-2.4 -9.4,-1.8 -9.4,-0.8
        V6.1
        C-9.4,6.9 -9,7.4 -8.2,7.4
        Z
    " fill="currentColor"/>
    `,

  npc: `
    <circle cx="0" cy="-5" r="4" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M-8,9 C-7,3 -4,0 0,0 C4,0 7,3 8,9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  `,

  clue: `
    <path d="M-6,-8 H5 C7.2,-8 9,-6.2 9,-4 C9,-2.4 8.2,-1.2 7,-0.5 V7.5 H-5 C-7.2,7.5 -9,5.7 -9,3.5 C-9,1.7 -7.7,0.2 -6,-0.2 Z"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linejoin="round"/>
    <path d="M-6,-8 C-4.3,-7.4 -4.3,-1.2 -6,-0.2"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"/>
    <path d="M-3,-4.8 H4 M-3,-2 H5 M-3,0.8 H3"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"/>
    <path d="M5,-8 C3.5,-6.7 3.5,-2.1 5,-0.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"/>
  `,

  ritualObject: `
    <circle cx="0" cy="0" r="8" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M0,-9 V9 M-8,0 H8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="0" cy="0" r="2.5" fill="currentColor"/>
    <path d="M-5,-5 L5,5 M5,-5 L-5,5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  `,

  hazard: `
    <path d="M0,-6.6 L5.8,4.2 H-5.8 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <path d="M0,-2.4 V1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    <circle cx="0" cy="3" r="1" fill="currentColor"/>
  `,

  secret: `
    <path transform="translate(-10.8 -10.8) scale(0.018)" fill="currentColor" d="M328.261,271.758C146.977,271.758,0,418.697,0,599.981c0,181.283,146.977,328.261,328.261,328.261c161.72,0,296.083-116.959,323.206-270.903c0.306,0.017,0.605,0.064,0.912,0.076h126.386v182.46h139.538v-182.46h65.796v264.068h139.538V657.414H1200V517.878H647.095c-0.322,0.026-0.63,0.048-0.95,0.076C609.721,376.371,481.219,271.758,328.261,271.758z M328.261,423.611c97.415,0,176.37,78.955,176.37,176.37c0,97.414-78.955,176.407-176.37,176.407s-176.408-78.993-176.408-176.407C151.853,502.566,230.847,423.611,328.261,423.611z"/>
  `,
};

export function markerId(kind: NarrativeElementKind): string {
  return `${SYMBOL_PREFIX}-${kind}`;
}

function appendSymbol(defs: SVGDefsElement, kind: NarrativeElementKind): void {
  const symbol = document.createElementNS(NS, 'symbol');
  symbol.setAttribute('id', markerId(kind));
  symbol.setAttribute('viewBox', '-12 -12 24 24');
  symbol.innerHTML = NARRATIVE_ELEMENT_SYMBOLS[kind];
  defs.appendChild(symbol);
}

export function ensureNarrativeElementSymbols(ctx: RenderContext): void {
  if (ctx.defs.querySelector(`[data-${SYMBOL_PREFIX}="true"]`)) return;

  const marker = document.createElementNS(NS, 'g');
  marker.setAttribute(`data-${SYMBOL_PREFIX}`, 'true');
  ctx.defs.appendChild(marker);

  for (const kind of NARRATIVE_ELEMENT_KINDS) {
    appendSymbol(ctx.defs, kind);
  }
}

export function normalizeNarrativeElementKind(value: unknown): NarrativeElementKind | null {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

  if (key === 'loot' || key === 'treasure') return 'loot';
  if (key === 'enemy' || key === 'monster' || key === 'creature') return 'enemy';
  if (key === 'trap') return 'trap';
  if (key === 'npc' || key === 'character' || key === 'nonplayercharacter') return 'npc';
  if (key === 'clue' || key === 'hint') return 'clue';
  if (key === 'ritualobject' || key === 'ritual' || key === 'artifact' || key === 'relic') return 'ritualObject';
  if (key === 'hazard' || key === 'danger') return 'hazard';
  if (key === 'secret' || key === 'hidden') return 'secret';

  return null;
}

export function drawNarrativeElementMarker(
  ctx: RenderContext,
  kind: NarrativeElementKind,
  x: number,
  y: number,
  size = 24,
  description = '',
): SVGGElement {
  ensureNarrativeElementSymbols(ctx);

  const group = document.createElementNS(NS, 'g');
  group.setAttribute('class', `narrative-element-marker narrative-element-marker-${kind}`);
  group.setAttribute('transform', `translate(${x}, ${y})`);
  group.style.color = 'var(--ink)';

  const tooltip = description.trim();

  if (tooltip) {
    group.setAttribute('data-tooltip', tooltip);

    group.addEventListener('pointerenter', (e) => {
      showTooltip(e, group.getAttribute('data-tooltip') || '');
    });

    group.addEventListener('pointermove', moveTooltip);
    group.addEventListener('pointerleave', hideTooltip);
  }

  const bg = document.createElementNS(NS, 'circle');
  bg.setAttribute('r', String(size / 2));
  bg.setAttribute('fill', 'var(--room-fill)');
  bg.setAttribute('stroke', 'var(--ink)');
  bg.setAttribute('stroke-width', '1.5');
  group.appendChild(bg);

  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#${markerId(kind)}`);
  use.setAttribute('x', String(-size / 2));
  use.setAttribute('y', String(-size / 2));
  use.setAttribute('width', String(size));
  use.setAttribute('height', String(size));
  group.appendChild(use);

  ctx.svg.appendChild(group);
  return group;
}
