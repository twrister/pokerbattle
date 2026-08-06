import { ARENA_HEIGHT, ARENA_WIDTH, toFloat } from '@pb/sim';

/** 场地尺寸的浮点版本，渲染层用 */
export const ARENA_W = toFloat(ARENA_WIDTH);
export const ARENA_H = toFloat(ARENA_HEIGHT);

/**
 * sim 用左下角为原点的 (x, y) 平面坐标，Three 用以场地中心为原点的 (x, z)。
 * 所有坐标转换都收敛到这四个函数，别的地方不要自己算偏移。
 */
export function toSceneX(simX: number): number {
  return simX - ARENA_W / 2;
}

export function toSceneZ(simY: number): number {
  return simY - ARENA_H / 2;
}

export function toSimX(sceneX: number): number {
  return sceneX + ARENA_W / 2;
}

export function toSimY(sceneZ: number): number {
  return sceneZ + ARENA_H / 2;
}
