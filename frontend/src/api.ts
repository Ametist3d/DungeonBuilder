import type { GenerateRequest, GenerateResponse } from './types';

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
