import './style.css';
import { generateDungeon } from './api';
import { renderDungeon } from './render/index';
import type { Size } from './types';
import { setupPanZoom } from './pan-zoom'

const svg = document.getElementById('canvas') as unknown as SVGSVGElement;
const canvasWrap = document.getElementById('canvas-wrap') as HTMLDivElement;
const seedInput = document.getElementById('seedInput') as HTMLInputElement;
const sizeSelect = document.getElementById('sizeSelect') as HTMLSelectElement;
const breakRange = document.getElementById('breakRange') as HTMLInputElement;
const breakVal = document.getElementById('breakVal') as HTMLSpanElement;
const genBtn = document.getElementById('genBtn') as HTMLButtonElement;
const randSeedBtn = document.getElementById('randSeedBtn') as HTMLButtonElement;

const statRooms = document.getElementById('statRooms') as HTMLSpanElement;
const statTarget = document.getElementById('statTarget') as HTMLSpanElement;
const statDepth = document.getElementById('statDepth') as HTMLSpanElement;
const statSeed = document.getElementById('statSeed') as HTMLSpanElement;
const accentPctRange = document.getElementById('accentPctRange') as HTMLInputElement;
const accentPctVal = document.getElementById('accentPctVal') as HTMLSpanElement;
const panZoom = setupPanZoom(canvasWrap, svg);

const rectPctRange = document.getElementById('rectPctRange') as HTMLInputElement;
const circlePctRange = document.getElementById('circlePctRange') as HTMLInputElement;
const hexPctRange = document.getElementById('hexPctRange') as HTMLInputElement;
const rectPctVal = document.getElementById('rectPctVal') as HTMLSpanElement;
const circlePctVal = document.getElementById('circlePctVal') as HTMLSpanElement;
const octagonPctRange = document.getElementById('octagonPctRange') as HTMLInputElement;
const octagonPctVal = document.getElementById('octagonPctVal') as HTMLSpanElement;
accentPctRange.addEventListener('input', () => { accentPctVal.textContent = accentPctRange.value; });

rectPctRange.addEventListener('input', () => { rectPctVal.textContent = rectPctRange.value; });
circlePctRange.addEventListener('input', () => { circlePctVal.textContent = circlePctRange.value; });
octagonPctRange.addEventListener('input', () => { octagonPctVal.textContent = octagonPctRange.value; });

breakRange.addEventListener('input', () => {
  breakVal.textContent = breakRange.value;
});

function randomSeedString(): string {
  return Math.floor(Math.random() * 1e9).toString(36);
}

async function runGenerate(): Promise<void> {
  const seed = seedInput.value.trim() || randomSeedString();
  seedInput.value = seed;

  try {
    const result = await generateDungeon({
      seed,
      size: sizeSelect.value as Size,
      symmetryBreak: parseInt(breakRange.value, 10),
      rectPct: parseInt(rectPctRange.value, 10),
      circlePct: parseInt(circlePctRange.value, 10),
      octagonPct: parseInt(octagonPctRange.value, 10),
      accentPct: parseInt(accentPctRange.value, 10),
    });

    renderDungeon(svg, result.rooms, result.corridors, result.entrance, result.exit);
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



genBtn.addEventListener('click', runGenerate);
randSeedBtn.addEventListener('click', () => {
  seedInput.value = randomSeedString();
  runGenerate();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runGenerate();
});

seedInput.value = randomSeedString();
runGenerate();
