/**
 * 建筑占地的格子工具。
 *
 * 场地按整数格对齐：偶数边长建筑中心落在格线交点，奇数边长落在格心，
 * 保证四边都贴齐格线，不会半格悬空。
 */

/** 建筑在整数格坐标系下的半开区间占地 [minX, maxX) × [minY, maxY)。 */
export interface BuildingCellRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * 把世界坐标吸附到建筑合法中心。
 * 偶数 footprint：吸附到整数（格线交点）；奇数：吸附到 *.5（格心）。
 */
export function snapBuildingCenter(v: number, footprint: number): number {
  const size = Math.max(1, Math.floor(footprint));
  if (size % 2 === 0) return Math.round(v);
  return Math.floor(v) + 0.5;
}

/** 由吸附后的中心与边长算出占地整数格范围（半开区间）。 */
export function buildingCellRange(
  centerX: number,
  centerY: number,
  footprint: number,
): BuildingCellRect {
  const size = Math.max(1, Math.floor(footprint));
  const half = size / 2;
  const minX = Math.floor(centerX - half);
  const minY = Math.floor(centerY - half);
  return {
    minX,
    minY,
    maxX: minX + size,
    maxY: minY + size,
  };
}

/** 占地是否完全落在 [0, width) × [0, height) 场地内。 */
export function isBuildingRectInsideArena(
  rect: BuildingCellRect,
  width: number,
  height: number,
): boolean {
  return rect.minX >= 0 && rect.minY >= 0 && rect.maxX <= width && rect.maxY <= height;
}
