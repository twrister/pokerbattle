import { Faction } from '../entity/unit.js';
import { toFloat } from '../math/fixed.js';
import {
  buildingCellRange,
  isBuildingRectInsideArena,
  snapBuildingCenter,
} from '../nav/buildingGrid.js';
import { ARENA_HEIGHT, ARENA_WIDTH } from './arena.js';
import {
  getFormationBuildingTypeId,
  isBuildingOnlyFormation,
  resolveFormationSpawns,
  type CardFormation,
  type FormationSpawnPoint,
} from './cardFormations.js';
import { UNIT_CONFIGS } from './units.js';

/** 场地浮点宽高，半场规则与客户端射线落点共用同一套数值。 */
const ARENA_W = toFloat(ARENA_WIDTH);
const ARENA_H = toFloat(ARENA_HEIGHT);
/** 中线 Y（含）：蓝方半场上沿 / 红方半场下沿。 */
export const HALF_COURT_MID_Y = ARENA_H / 2;

export interface SimPoint {
  x: number;
  y: number;
}

/** 返回阵营己方半场的 Y 闭区间（含中线）。 */
export function halfCourtYRange(faction: Faction): { minY: number; maxY: number } {
  if (faction === Faction.Blue) return { minY: 0, maxY: HALF_COURT_MID_Y };
  return { minY: HALF_COURT_MID_Y, maxY: ARENA_H };
}

/**
 * 整套阵型是否都落在指定阵营半场内。
 * 故意不做逐单位 clamp：贴边时 clamp 会把整排压扁重叠。
 */
export function isFormationInsideHalfCourt(
  points: readonly FormationSpawnPoint[],
  faction: Faction,
): boolean {
  const { minY, maxY } = halfCourtYRange(faction);
  return points.every(
    (point) => point.x >= 0 && point.x <= ARENA_W && point.y >= minY && point.y <= maxY,
  );
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
 * 自动出兵落点：从己方半场中央出发，再按阵型包围盒把锚点推回合法区域。
 * 阵型比半场还大时返回 null。
 */
export function halfCourtSafeAnchor(formation: CardFormation, faction: Faction): SimPoint | null {
  if (isBuildingOnlyFormation(formation)) {
    const typeId = getFormationBuildingTypeId(formation)!;
    return halfCourtSafeBuildingAnchor(UNIT_CONFIGS[typeId].footprint, faction);
  }
  const { minY, maxY } = halfCourtYRange(faction);
  const centerX = ARENA_W / 2;
  const centerY = (minY + maxY) / 2;
  const points = resolveFormationSpawns(formation, faction, centerX, centerY);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const offsetX = shiftIntoRange(Math.min(...xs), Math.max(...xs), 0, ARENA_W);
  const offsetY = shiftIntoRange(Math.min(...ys), Math.max(...ys), minY, maxY);
  if (offsetX === null || offsetY === null) return null;
  return { x: centerX + offsetX, y: centerY + offsetY };
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

/** 求把 [min, max] 整体推入 [low, high] 所需的位移；区间本身超长则无解。 */
function shiftIntoRange(min: number, max: number, low: number, high: number): number | null {
  if (max - min > high - low) return null;
  if (min < low) return low - min;
  if (max > high) return high - max;
  return 0;
}
