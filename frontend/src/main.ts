import './style.css';
import { generateDungeon } from './api';
import { renderDungeon } from './render';
import type { Size } from './types';

const svg = document.getElementById('canvas') as unknown as SVGSVGElement;
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
    });

    renderDungeon(svg, result.rooms, result.corridors);
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
