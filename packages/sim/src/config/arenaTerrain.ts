import { fromFloat } from '../math/fixed.js';
import type { NavGrid } from '../nav/grid.js';
import { ARENA_WIDTH } from './arena.js';

/** 中线河道的下沿；apply 场景配置后会改写。 */
export let ARENA_RIVER_MIN_Y = 15;
/** 中线河道的上沿（半开区间上界）；apply 场景配置后会改写。 */
export let ARENA_RIVER_MAX_Y = 16;

export interface ArenaBridge {
  minX: number;
  maxX: number;
}

/** 左右两座桥，是地面单位跨河的唯一通道；apply 时原地替换内容以保持引用稳定。 */
export const ARENA_BRIDGES: ArenaBridge[] = [
  { minX: 3, maxX: 5 },
  { minX: 13, maxX: 15 },
];

/**
 * 河道默认居中：两侧半场尽量对称。
 * 高度为偶数且河宽为奇数时，下沿用 floor，蓝方会少半格。
 */
export function centeredRiverRange(
  height: number,
  riverWidth: number,
): { minY: number; maxY: number } {
  const minY = Math.floor((height - riverWidth) / 2);
  return { minY, maxY: minY + riverWidth };
}

/** 用居中河道范围与桥列表覆盖运行时地形；仅配置 apply 调用。 */
export function setArenaTerrain(riverMinY: number, riverMaxY: number, bridges: readonly ArenaBridge[]): void {
  ARENA_RIVER_MIN_Y = riverMinY;
  ARENA_RIVER_MAX_Y = riverMaxY;
  ARENA_BRIDGES.splice(0, ARENA_BRIDGES.length, ...bridges.map((bridge) => ({ ...bridge })));
}

/**
 * 将对局专属的河道写入导航网格。
 * World 本身不默认调用此函数，让模拟沙盒继续使用空旷场地。
 */
export function applyArenaTerrain(nav: NavGrid): void {
  nav.setBlockedWorldRectExclusive(
    fromFloat(0),
    fromFloat(ARENA_RIVER_MIN_Y),
    ARENA_WIDTH,
    fromFloat(ARENA_RIVER_MAX_Y),
  );

  for (const bridge of ARENA_BRIDGES) {
    nav.setBlockedWorldRectExclusive(
      fromFloat(bridge.minX),
      fromFloat(ARENA_RIVER_MIN_Y),
      fromFloat(bridge.maxX),
      fromFloat(ARENA_RIVER_MAX_Y),
      false,
    );
  }
}
