import type { DungeonNarrative, GenerateRequest, GenerateResponse } from './types';

const API_BASE = '/api/dungeon';

export async function generateDungeon(req: GenerateRequest): Promise<GenerateResponse> {
  const res = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    throw new Error(`Generate failed: ${res.status} ${await res.text()}`);
  }

  return res.json() as Promise<GenerateResponse>;
}

export async function narrateDungeon(req: GenerateRequest): Promise<DungeonNarrative> {
  const res = await fetch(`${API_BASE}/narrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Generate failed: ${res.status} ${detail}`);
  }

  return res.json() as Promise<DungeonNarrative>;
}