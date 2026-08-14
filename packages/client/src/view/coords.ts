import * as THREE from 'three';
import { ARENA_HEIGHT, ARENA_WIDTH, toFloat } from '@pb/sim';

/** 场地尺寸的浮点版本，渲染层用；apply 场景配置后须调用 syncArenaCoords。 */
export let ARENA_W = toFloat(ARENA_WIDTH);
export let ARENA_H = toFloat(ARENA_HEIGHT);

/** 把客户端缓存的场地宽高同步到当前 sim 常量，供下一局/预览使用。 */
export function syncArenaCoords(): void {
  ARENA_W = toFloat(ARENA_WIDTH);
  ARENA_H = toFloat(ARENA_HEIGHT);
}

/**
 * sim 用左下角为原点的 (x, y) 平面坐标，Three 用以场地中心为原点的 (x, z)。
 * Y 轴取反：sim +Y（朝敌方）→ scene -Z，这样镜头在 +Z 侧时蓝方半场在画面下方。
 * 所有坐标转换都收敛到这几个函数，别的地方不要自己算偏移。
 */

/**
 * 画面近端（己方 / 画面下方）在 scene Z 上的符号，与 applySoloCameraPose 的 towardNear 一致。
 * 斜视读 camera.position.z；正上俯视 position.z≈0，改用 up.z（近端与画面上方相反）。
 */
export function viewNearSign(camera: THREE.Camera): number {
  if (Math.abs(camera.position.z) > 1e-3) return Math.sign(camera.position.z);
  if (Math.abs(camera.up.z) > 1e-3) return -Math.sign(camera.up.z);
  return 1;
}

export function toSceneX(simX: number): number {
  return simX - toFloat(ARENA_WIDTH) / 2;
}

export function toSceneZ(simY: number): number {
  return toFloat(ARENA_HEIGHT) / 2 - simY;
}

export function toSimX(sceneX: number): number {
  return sceneX + toFloat(ARENA_WIDTH) / 2;
}

export function toSimY(sceneZ: number): number {
  return toFloat(ARENA_HEIGHT) / 2 - sceneZ;
}

/** sim 平面朝向的 Y 分量转到场景 Z；与 toSceneZ 同向取反。 */
export function toSceneFacingZ(simFacingY: number): number {
  return -simFacingY;
}
