import { fromFloat } from '../math/fixed.js';
import type { NavGrid } from '../nav/grid.js';
import { ARENA_WIDTH } from './arena.js';

/** 中线河道的下沿；两侧各保留 18×15 格场地。 */
export const ARENA_RIVER_MIN_Y = 15;
/** 中线河道的上沿（半开区间上界）。 */
export const ARENA_RIVER_MAX_Y = 16;

export interface ArenaBridge {
  minX: number;
  maxX: number;
}

/** 左右两座两格宽的桥，是地面单位跨河的唯一通道。 */
export const ARENA_BRIDGES: readonly ArenaBridge[] = [
  { minX: 3, maxX: 5 },
  { minX: 13, maxX: 15 },
];

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
