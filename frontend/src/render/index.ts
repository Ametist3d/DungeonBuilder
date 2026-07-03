import type { Room, Corridor, Opening } from '../types';
import { buildRenderContext } from './context';
import {
  buildInsetShadowFilter, buildHaloFilter, buildRubblePattern, buildAccentBlurFilter,
  renderHalo, renderWallHatching, renderCompass, renderScaleBar,
} from './styling';
import { renderCorridorFloors, renderRoomFloors, renderFloorGrid, renderRoomLabels } from './floors';
import { renderDoors } from './doors';

export function renderDungeon(
  svg: SVGSVGElement,
  rooms: Room[],
  corridors: Corridor[] = [],
  entrance: Opening | null = null,
  dungeonExit: Opening | null = null,
): void {
  svg.innerHTML = '';
  if (rooms.length === 0) return;

  const ctx = buildRenderContext(svg, rooms, corridors, entrance, dungeonExit);

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
  renderCompass(ctx);
  renderScaleBar(ctx);
  renderDoors(ctx, entrance, dungeonExit);
}
