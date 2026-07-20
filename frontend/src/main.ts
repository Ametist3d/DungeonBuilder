import './style.css';
import { generateDungeon } from './api';
import { renderDungeon } from './render/index';
import type { DungeonNarrative, GenerateRequest, GenerateResponse, LLMProvider, Size } from './types';
import { setupPanZoom } from './pan-zoom';
import { setupMapOverlay } from './map-overlay';
import { setupHeroControls } from './render/heroes';
import { addExperience } from './render/player-stats';

const svg = document.getElementById('canvas') as unknown as SVGSVGElement;
const canvasWrap = document.getElementById('canvas-wrap') as HTMLDivElement;

const scenarioName = document.getElementById('scenarioName') as HTMLSpanElement;
const scenarioNarrative = document.getElementById('scenarioNarrative') as HTMLSpanElement;
const llmProviderSelect = document.getElementById('llmProviderSelect') as HTMLSelectElement;

const seedInput = document.getElementById('seedInput') as HTMLInputElement;
const randomSeedCheck = document.getElementById('randomSeedCheck') as HTMLInputElement;
const sizeSelect = document.getElementById('sizeSelect') as HTMLSelectElement;

const breakRange = document.getElementById('breakRange') as HTMLInputElement;
const breakVal = document.getElementById('breakVal') as HTMLSpanElement;

const rectPctRange = document.getElementById('rectPctRange') as HTMLInputElement;
const rectPctVal = document.getElementById('rectPctVal') as HTMLSpanElement;

const circlePctRange = document.getElementById('circlePctRange') as HTMLInputElement;
const circlePctVal = document.getElementById('circlePctVal') as HTMLSpanElement;

const octagonPctRange = document.getElementById('octagonPctRange') as HTMLInputElement;
const octagonPctVal = document.getElementById('octagonPctVal') as HTMLSpanElement;

const accentPctRange = document.getElementById('accentPctRange') as HTMLInputElement;
const accentPctVal = document.getElementById('accentPctVal') as HTMLSpanElement;

const genBtn = document.getElementById('genBtn') as HTMLButtonElement;
const addNarrativeBtn = document.getElementById('addNarrativeBtn') as HTMLButtonElement;

const statRooms = document.getElementById('statRooms') as HTMLSpanElement;
const statTarget = document.getElementById('statTarget') as HTMLSpanElement;
const statDepth = document.getElementById('statDepth') as HTMLSpanElement;
const statSeed = document.getElementById('statSeed') as HTMLSpanElement;

const narrativePanel = document.getElementById('narrativePanel') as HTMLDivElement;

const panZoom = setupPanZoom(canvasWrap, svg);
setupHeroControls();
setupMapOverlay(canvasWrap);

const DEFAULT_SCENARIO_NAME = 'Dungeon generator — version 0.1: rooms';
const DEFAULT_SCENARIO_NARRATIVE = 'Generate a map, then add narrative.';

const closedDoorPctRange = document.getElementById('closedDoorPctRange') as HTMLInputElement;
const closedDoorPctVal = document.getElementById('closedDoorPctVal') as HTMLSpanElement;

let currentDungeon: GenerateResponse | null = null;
let currentNarrative: DungeonNarrative | null = null;

function randomSeedString(): string {
  return Math.floor(Math.random() * 1e9).toString(36);
}

function setScenarioHeader(
  name = DEFAULT_SCENARIO_NAME,
  narrative = DEFAULT_SCENARIO_NARRATIVE,
): void {
  scenarioName.textContent = name;
  scenarioNarrative.textContent = narrative;
}

function buildRequest(seed: string): GenerateRequest {
  return {
    seed,
    size: sizeSelect.value as Size,
    symmetryBreak: parseInt(breakRange.value, 10),
    rectPct: parseInt(rectPctRange.value, 10),
    circlePct: parseInt(circlePctRange.value, 10),
    octagonPct: parseInt(octagonPctRange.value, 10),
    accentPct: parseInt(accentPctRange.value, 10),
    llmProvider: llmProviderSelect.value as LLMProvider,
    closedDoorPct: parseInt(closedDoorPctRange.value, 10),
  };
}

async function narrateDungeon(req: GenerateRequest): Promise<DungeonNarrative> {
  const res = await fetch('/api/dungeon/narrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    throw new Error(`Narrate failed: ${res.status} ${await res.text()}`);
  }

  return res.json() as Promise<DungeonNarrative>;
}

function renderNarrative(
  narrative: DungeonNarrative,
  inlineRoomIds = new Set<number>(),
): void {
  narrativePanel.innerHTML = '';

  const title = document.createElement('h3');
  title.textContent = narrative.title;
  narrativePanel.appendChild(title);

  const premise = document.createElement('p');
  premise.className = 'narrative-premise';
  premise.textContent = narrative.premise;
  narrativePanel.appendChild(premise);

  const fallbackRooms = narrative.rooms.filter((room) => !inlineRoomIds.has(room.id));

  if (!fallbackRooms.length) {
    const note = document.createElement('p');
    note.className = 'narrative-premise';
    note.textContent = 'All room notes are placed on the map.';
    narrativePanel.appendChild(note);
    return;
  }

  for (const room of fallbackRooms) {
    const item = document.createElement('article');
    item.className = 'room-narrative';

    const name = document.createElement('strong');
    name.textContent = `${room.id}. ${room.label}`;

    const desc = document.createElement('p');
    desc.textContent = room.description;

    item.appendChild(name);
    item.appendChild(desc);
    narrativePanel.appendChild(item);
  }
}

function handleDungeonExit(): void {
  const roomCount = currentDungeon?.rooms.length ?? 6;
  addExperience(150 + roomCount * 15);

  window.setTimeout(() => {
    void runGenerate(true);
  }, 300);
}

async function runGenerate(carryProgress = false): Promise<void> {
  const seed = randomSeedCheck.checked || !seedInput.value.trim()
    ? randomSeedString()
    : seedInput.value.trim();

  seedInput.value = seed;
  setScenarioHeader();
  narrativePanel.innerHTML = '';

  try {
    const result = await generateDungeon(buildRequest(seed));

    currentDungeon = result;
    currentNarrative = null;

    renderDungeon(
      svg, result.rooms, result.corridors, result.entrance, result.exit, result.doors,
      [], { carryProgress, onDungeonExit: handleDungeonExit },
    );
    panZoom.reset();

    statRooms.textContent = String(result.rooms.length);
    statTarget.textContent = String(result.target);
    statDepth.textContent = String(result.maxDepth);
    statSeed.textContent = result.seed;
  } catch (err) {
    console.error(err);
    statRooms.textContent = 'error — is the backend running?';
  }
}

async function runNarrative(): Promise<void> {
  const seed = seedInput.value.trim() || randomSeedString();
  seedInput.value = seed;

  addNarrativeBtn.disabled = true;
  addNarrativeBtn.textContent = 'Writing...';

  try {
    const narrative = await narrateDungeon(buildRequest(seed));
    currentNarrative = narrative;

    setScenarioHeader(narrative.title, narrative.premise);

    if (currentDungeon) {
      const placedRoomIds = renderDungeon(
        svg,
        currentDungeon.rooms,
        currentDungeon.corridors,
        currentDungeon.entrance,
        currentDungeon.exit,
        currentDungeon.doors,
        narrative.rooms,
        { carryProgress: true, onDungeonExit: handleDungeonExit },
      );

      requestAnimationFrame(() => {
        panZoom.reset();
      });

      renderNarrative(narrative, placedRoomIds);
    } else {
      renderNarrative(narrative);
    }
  } catch (err) {
    console.error(err);
    narrativePanel.textContent = 'Narrative failed — check backend/API key.';
  } finally {
    addNarrativeBtn.disabled = false;
    addNarrativeBtn.textContent = 'Add narrative';
  }
}

breakRange.addEventListener('input', () => {
  breakVal.textContent = breakRange.value;
});

rectPctRange.addEventListener('input', () => {
  rectPctVal.textContent = rectPctRange.value;
});

circlePctRange.addEventListener('input', () => {
  circlePctVal.textContent = circlePctRange.value;
});

octagonPctRange.addEventListener('input', () => {
  octagonPctVal.textContent = octagonPctRange.value;
});

accentPctRange.addEventListener('input', () => {
  accentPctVal.textContent = accentPctRange.value;
});

genBtn.addEventListener('click', () => { void runGenerate(false); });
addNarrativeBtn.addEventListener('click', runNarrative);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void runGenerate(false);
});

closedDoorPctRange.addEventListener('input', () => {
  closedDoorPctVal.textContent = closedDoorPctRange.value;
});

seedInput.value = randomSeedString();
setScenarioHeader();
void runGenerate(false);