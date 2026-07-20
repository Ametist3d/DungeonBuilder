import type { Door, Room, Corridor, Opening, RoomNarrative } from '../types';
import { renderNarrativeLabels } from './narrative-labels';
import { renderNarrativeContent } from './narrative-content';
import { buildRenderContext } from './context';
import {
  buildInsetShadowFilter, buildHaloFilter, buildRubblePattern, buildAccentBlurFilter,
  renderHalo, renderWallHatching, renderScaleBar,
} from './styling';
import { renderCorridorFloors, renderRoomFloors, renderFloorGrid, renderRoomLabels } from './floors';
import { renderDoors } from './doors';
import { renderHeroes } from './heroes';
import { renderEnemies } from './enemies';
import { renderLoot } from './loot';


export function renderDungeon(
  svg: SVGSVGElement,
  rooms: Room[],
  corridors: Corridor[] = [],
  entrance: Opening | null = null,
  dungeonExit: Opening | null = null,
  doors: Door[] = [],
  roomNarratives: RoomNarrative[] = [],
  options: { carryProgress?: boolean; onDungeonExit?: () => void } = {},
): Set<number> {
  svg.innerHTML = '';
  if (rooms.length === 0) return new Set<number>();

  const ctx = buildRenderContext(
    svg,
    rooms,
    corridors,
    entrance,
    dungeonExit,
    roomNarratives.length ? 8 : 2,
  );

  buildInsetShadowFilter(ctx.defs);
  buildHaloFilter(ctx.defs);
  buildRubblePattern(ctx.defs);
  buildAccentBlurFilter(ctx.defs);

  renderHalo(ctx, entrance, dungeonExit);
  renderCorridorFloors(ctx);
  renderRoomFloors(ctx);
  renderFloorGrid(ctx);
  renderRoomLabels(ctx);
  renderWallHatching(ctx);
  renderScaleBar(ctx);
  renderDoors(ctx, entrance, dungeonExit, doors);
  const contentMarkers = renderNarrativeContent(ctx, roomNarratives);

  renderLoot(ctx, contentMarkers);
  renderEnemies(ctx, contentMarkers, !options.carryProgress);

  const placedRoomIds = renderNarrativeLabels(ctx, roomNarratives);

  renderHeroes(ctx, entrance, dungeonExit, doors, contentMarkers, options.carryProgress ?? false, options.onDungeonExit);


  return placedRoomIds;
}
