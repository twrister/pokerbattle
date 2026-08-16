import { type Fx, HALF, clamp, fromInt } from '../math/fixed.js';

/** 全场宽（横向格数，与单边宽相同）；可由场景配置草稿在运行时改写。 */
export let ARENA_WIDTH: Fx = fromInt(18);
/** 全场高：两边半场 + 中间河道；未加载配置时按单边 15 + 河宽 1。 */
export let ARENA_HEIGHT: Fx = fromInt(31);

/** 导航网格分辨率：半格一个 cell，够细也不至于让 A* 节点数爆炸 */
export const NAV_CELL_SIZE: Fx = HALF;

/** 把坐标夹回场地内，留出 margin（一般传单位半径）避免模型半个身子出界 */
export function clampToArena(value: Fx, axisSize: Fx, margin: Fx): Fx {
  return clamp(value, margin, axisSize - margin);
}

/** 用整数格数覆盖运行时场地尺寸；仅配置 apply 调用。 */
export function setArenaSize(width: number, height: number): void {
  ARENA_WIDTH = fromInt(width);
  ARENA_HEIGHT = fromInt(height);
}
