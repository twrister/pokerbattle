import { Faction } from '../entity/unit.js';
import { toFloat } from '../math/fixed.js';
import {
  buildingCellRange,
  isBuildingRectInsideArena,
  snapBuildingCenter,
} from '../nav/buildingGrid.js';
import { ARENA_HEIGHT, ARENA_WIDTH } from './arena.js';
import { ARENA_RIVER_MAX_Y, ARENA_RIVER_MIN_Y } from './arenaTerrain.js';
import {
  getFormationBuildingTypeId,
  isBuildingOnlyFormation,
  type CardFormation,
  type FormationSpawnPoint,
} from './cardFormations.js';
import { UNIT_CONFIGS } from './units.js';

/** 场地浮点宽高，半场规则与客户端射线落点共用同一套数值。 */
const ARENA_W = toFloat(ARENA_WIDTH);
const ARENA_H = toFloat(ARENA_HEIGHT);
/** 蓝方部署区上沿；保留旧名称以兼容客户端放置逻辑。 */
export const HALF_COURT_MID_Y = ARENA_RIVER_MIN_Y;

export interface SimPoint {
  x: number;
  y: number;
}

/** 返回阵营己方部署区的 Y 边界；中间河道和桥面均不可部署。 */
export function halfCourtYRange(faction: Faction): { minY: number; maxY: number } {
  if (faction === Faction.Blue) return { minY: 0, maxY: HALF_COURT_MID_Y };
  return { minY: ARENA_RIVER_MAX_Y, maxY: ARENA_H };
}

/**
 * 出兵锚点（拖拽落点）是否落在白色部署区内。
 * 与客户端半场高亮范围一致：锚点合法即可放置，允许阵型贴边溢出。
 */
export function isDeployAnchorInsideHalfCourt(
  x: number,
  y: number,
  faction: Faction,
): boolean {
  const { minY, maxY } = halfCourtYRange(faction);
  return (
    x >= 0
    && x <= ARENA_W
    && y >= minY
    && (faction === Faction.Blue ? y < maxY : y <= maxY)
  );
}

/**
 * 整套阵型是否都落在指定阵营半场内。
 * 仅用于需要“整阵收拢”的辅助逻辑；正式落点校验请用 isDeployAnchorInsideHalfCourt。
 */
export function isFormationInsideHalfCourt(
  points: readonly FormationSpawnPoint[],
  faction: Faction,
): boolean {
  return points.every((point) => isDeployAnchorInsideHalfCourt(point.x, point.y, faction));
}

/**
 * 吸附后的建筑占地是否完全落在指定阵营半场内。
 * 用占格半开区间判断，避免半截建筑跨过中线。
 */
export function isBuildingInsideHalfCourt(
  centerX: number,
  centerY: number,
  footprint: number,
  faction: Faction,
): boolean {
  const snappedX = snapBuildingCenter(centerX, footprint);
  const snappedY = snapBuildingCenter(centerY, footprint);
  const rect = buildingCellRange(snappedX, snappedY, footprint);
  if (!isBuildingRectInsideArena(rect, ARENA_W, ARENA_H)) return false;
  const { minY, maxY } = halfCourtYRange(faction);
  return rect.minY >= minY && rect.maxY <= maxY;
}

/**
 * 自动出兵落点：优先半场中央。
 * 兵种阵型只要锚点在白色部署区即可；建筑仍按占地能否完整放下决定。
 */
export function halfCourtSafeAnchor(formation: CardFormation, faction: Faction): SimPoint | null {
  if (isBuildingOnlyFormation(formation)) {
    const typeId = getFormationBuildingTypeId(formation)!;
    return halfCourtSafeBuildingAnchor(UNIT_CONFIGS[typeId].footprint, faction);
  }
  const { minY, maxY } = halfCourtYRange(faction);
  const centerX = ARENA_W / 2;
  const centerY = (minY + maxY) / 2;
  if (!isDeployAnchorInsideHalfCourt(centerX, centerY, faction)) return null;
  return { x: centerX, y: centerY };
}

/** 己方半场内可容纳指定占地的吸附中心；装不下则返回 null。 */
export function halfCourtSafeBuildingAnchor(footprint: number, faction: Faction): SimPoint | null {
  const size = Math.max(1, Math.floor(footprint));
  const { minY, maxY } = halfCourtYRange(faction);
  const halfHeight = maxY - minY;
  if (size > ARENA_W || size > halfHeight) return null;
  const half = size / 2;
  const minCenter = minY + half;
  const maxCenterX = ARENA_W - half;
  const maxCenterY = maxY - half;
  if (half > maxCenterX || minCenter > maxCenterY) return null;
  const cx = snapBuildingCenter((half + maxCenterX) / 2, size);
  const cy = snapBuildingCenter((minCenter + maxCenterY) / 2, size);
  if (!isBuildingInsideHalfCourt(cx, cy, size, faction)) return null;
  return { x: cx, y: cy };
}
