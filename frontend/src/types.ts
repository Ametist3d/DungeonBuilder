export type Direction = 'N' | 'E' | 'S' | 'W';
export type Size = 'small' | 'medium' | 'large';
export type Shape = 'rect' | 'circle' | 'octagon';
export type LLMProvider = 'local' | 'api';

export interface Room {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  parentId: number | null;
  entranceDir: Direction | null;
  depth: number;
  shape: Shape;
  accent: boolean
}

export type NarrativeElementType =
  | 'loot'
  | 'enemy'
  | 'trap'
  | 'npc'
  | 'clue'
  | 'ritualObject'
  | 'hazard'
  | 'secret';

export interface NarrativeContent {
  type: NarrativeElementType | string;
  quantity: number;
  description?: string;
}

export interface GenerateRequest {
  seed?: string;
  size: Size;
  symmetryBreak: number;
  rectPct: number;
  circlePct: number;
  octagonPct: number;
  accentPct: number;
  llmProvider?: LLMProvider;
}

export interface Corridor {
  parentId: number;
  childId: number;
  points: [number, number][];
  branchesFromCorridor: boolean;
}

export interface Opening {
  roomId: number;
  direction: Direction;
}

export interface GenerateResponse {
  seed: string;
  target: number;
  maxDepth: number;
  rooms: Room[];
  corridors: Corridor[];
  entrance: Opening;
  exit: Opening;
}

export interface RoomNarrative {
  id: number;
  label: string;
  mapLabel?: string;
  description: string;
  content?: NarrativeContent[];
}

export interface DungeonNarrative {
  title: string;
  premise: string;
  rooms: RoomNarrative[];
}