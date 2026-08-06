import { type Fx, HALF, clamp, fromInt } from '../math/fixed.js';

/** 场地宽（横向格数），沿用王室战争的 18 x 32 比例 */
export const ARENA_WIDTH: Fx = fromInt(18);
/** 场地高（纵向格数） */
export const ARENA_HEIGHT: Fx = fromInt(32);

/** 导航网格分辨率：半格一个 cell，够细也不至于让 A* 节点数爆炸 */
export const NAV_CELL_SIZE: Fx = HALF;

/** 把坐标夹回场地内，留出 margin（一般传单位半径）避免模型半个身子出界 */
export function clampToArena(value: Fx, axisSize: Fx, margin: Fx): Fx {
  return clamp(value, margin, axisSize - margin);
}
