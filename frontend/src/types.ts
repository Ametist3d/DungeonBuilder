export type Direction = 'N' | 'E' | 'S' | 'W';
export type Size = 'small' | 'medium' | 'large';

export interface Room {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  parentId: number | null;
  entranceDir: Direction | null;
  depth: number;
}

export interface Corridor {
  parentId: number;
  childId: number;
  points: [number, number][];
}

export interface GenerateRequest {
  seed?: string;
  size: Size;
  symmetryBreak: number;
}

export interface GenerateResponse {
  seed: string;
  target: number;
  maxDepth: number;
  rooms: Room[];
  corridors: Corridor[];
}
