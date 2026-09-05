import { Faction } from '../entity/unit.js';
import { EPSILON, toFloat } from '../math/fixed.js';
import { slotFaction, teamSlots, type MatchMode } from '../match/matchMode.js';
import {
  buildingCellRange,
  isBuildingRectInsideArena,
  snapBuildingCenter,
} from '../nav/buildingGrid.js';
import { ARENA_HEIGHT, ARENA_WIDTH } from './arena.js';
import { dumpArenaConfigDraft, resolveSideBasePositions } from './arenaConfig.js';
import { ARENA_RIVER_MAX_Y, ARENA_RIVER_MIN_Y } from './arenaTerrain.js';
import {
  getFormationBuildingTypeId,
  isBuildingOnlyFormation,
  type CardFormation,
  type FormationSpawnPoint,
} from './cardFormations.js';
import { UNIT_CONFIGS } from './units.js';

/** 蓝方部署区上沿；与河道下沿同一 live 绑定，配置 apply 后下一局生效。 */
export { ARENA_RIVER_MIN_Y as HALF_COURT_MID_Y } from './arenaTerrain.js';

export interface SimPoint {
  x: number;
  y: number;
}

/** 当前场地浮点宽，避免模块加载时把尺寸缓存死。 */
function arenaW(): number {
  return toFloat(ARENA_WIDTH);
}

/** 当前场地浮点高。 */
function arenaH(): number {
  return toFloat(ARENA_HEIGHT);
}

/** 返回阵营己方部署区的 Y 边界；中间河道和桥面均不可部署。 */
export function halfCourtYRange(faction: Faction): { minY: number; maxY: number } {
  if (faction === Faction.Blue) return { minY: 0, maxY: ARENA_RIVER_MIN_Y };
  return { minY: ARENA_RIVER_MAX_Y, maxY: arenaH() };
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
    && x <= arenaW()
    && y >= minY
    && (faction === Faction.Blue ? y < maxY : y <= maxY)
  );
}

/** 靠河一侧：点击超出部署边界最多 N 格仍接受，并吸附回岸边。 */
export const DEPLOY_RIVER_EDGE_TOLERANCE = 2;

/** 夹到蓝方岸边内侧时必须能扛住 Q16.16 取整，不能用 Number.EPSILON。 */
const DEPLOY_RIVER_EDGE_INSET = toFloat(EPSILON);

/**
 * 把出兵锚点归一化到己方半场：区内原样返回，靠河越界 2 格内夹回岸边。
 * 建筑 / 炸弹不要走这条；超出容错带或 X 出界则返回 null。
 */
export function normalizeDeployAnchor(
  x: number,
  y: number,
  faction: Faction,
): SimPoint | null {
  if (x < 0 || x > arenaW()) return null;
  const { minY, maxY } = halfCourtYRange(faction);
  if (faction === Faction.Blue) {
    if (y < minY || y >= maxY + DEPLOY_RIVER_EDGE_TOLERANCE) return null;
    return { x, y: y < maxY ? y : maxY - DEPLOY_RIVER_EDGE_INSET };
  }
  if (y > maxY || y <= minY - DEPLOY_RIVER_EDGE_TOLERANCE) return null;
  return { x, y: y >= minY ? y : minY };
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
  if (!isBuildingRectInsideArena(rect, arenaW(), arenaH())) return false;
  const { minY, maxY } = halfCourtYRange(faction);
  return rect.minY >= minY && rect.maxY <= maxY;
}

/**
 * 该席默认出兵的 X：与己方主堡垂直对齐。
 * 1v1 只有一座，结果就是半场中央；2v2 左右分路，不再挤到战场中线。
 */
export function halfCourtSlotAnchorX(mode: MatchMode, slot: number): number {
  const draft = dumpArenaConfigDraft(mode);
  const slots = teamSlots(slotFaction(slot, mode), mode);
  const index = slots.indexOf(slot);
  if (index < 0) return draft.width / 2;
  return resolveSideBasePositions(draft, slots.length)[index]?.x ?? draft.width / 2;
}

/** 无指定 X 时回退半场中央；越界则夹到场地内。 */
function resolveAnchorX(preferredX?: number): number {
  const maxX = arenaW();
  if (preferredX === undefined || !Number.isFinite(preferredX)) return maxX / 2;
  return Math.min(maxX, Math.max(0, preferredX));
}

/**
 * 自动出兵落点：Y 取半场中央，X 优先与指定主堡对齐。
 * 兵种阵型只要锚点在白色部署区即可；建筑仍按占地能否完整放下决定。
 */
export function halfCourtSafeAnchor(
  formation: CardFormation,
  faction: Faction,
  preferredX?: number,
): SimPoint | null {
  if (isBuildingOnlyFormation(formation)) {
    const typeId = getFormationBuildingTypeId(formation)!;
    return halfCourtSafeBuildingAnchor(UNIT_CONFIGS[typeId].footprint, faction, preferredX);
  }
  const { minY, maxY } = halfCourtYRange(faction);
  const centerX = resolveAnchorX(preferredX);
  const centerY = (minY + maxY) / 2;
  if (!isDeployAnchorInsideHalfCourt(centerX, centerY, faction)) return null;
  return { x: centerX, y: centerY };
}

/** 己方半场内可容纳指定占地的吸附中心；装不下则返回 null。 */
export function halfCourtSafeBuildingAnchor(
  footprint: number,
  faction: Faction,
  preferredX?: number,
): SimPoint | null {
  const size = Math.max(1, Math.floor(footprint));
  const { minY, maxY } = halfCourtYRange(faction);
  const halfHeight = maxY - minY;
  if (size > arenaW() || size > halfHeight) return null;
  const half = size / 2;
  const minCenter = minY + half;
  const maxCenterX = arenaW() - half;
  const maxCenterY = maxY - half;
  if (half > maxCenterX || minCenter > maxCenterY) return null;
  const cx = snapBuildingCenter(Math.min(maxCenterX, Math.max(half, resolveAnchorX(preferredX))), size);
  const cy = snapBuildingCenter((minCenter + maxCenterY) / 2, size);
  if (!isBuildingInsideHalfCourt(cx, cy, size, faction)) return null;
  return { x: cx, y: cy };
}
