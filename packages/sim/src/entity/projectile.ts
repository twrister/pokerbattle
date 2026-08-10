import type { Fx } from '../math/fixed.js';
import { type Vec2, vec } from '../math/vec2.js';
import type { Faction } from './unit.js';

/**
 * 远程单位发射的追踪弹。
 * MVP 里是「必中」的追踪弹：只要目标还活着就一直飞向它，飞到就结算伤害。
 * 抛物线、溅射、可闪避的直线弹都可以在这个结构上加字段扩展。
 */
export interface Projectile {
  readonly id: number;
  readonly faction: Faction;
  pos: Vec2;
  targetId: number;
  /** 目标最后一次有效位置；范围弹在目标提前死亡后仍飞向这里。 */
  impactPos: Vec2;
  /** 命中判定沿用发射时目标碰撞圈，目标移除后也能稳定落地。 */
  targetRadius: Fx;
  damage: Fx;
  /** 大于 0 时不造成单体直伤，改为在 impactPos 结算范围伤害。 */
  aoeRadius: Fx;
  /** 当前渲染离地高度，飞行中在 start/end 之间插值。 */
  height: number;
  /** 发射点高度（如巨龙头 2.5）。 */
  startHeight: number;
  /** 目标点高度：地面单位为 0，空中单位与出生高度对齐。 */
  endHeight: number;
  /** 发射瞬间到目标的水平距离，用于高度插值进度。 */
  startDist: Fx;
  /** 飞行速度，单位/秒 */
  speed: Fx;
  dead: boolean;
}

export function createProjectile(
  id: number,
  faction: Faction,
  x: Fx,
  y: Fx,
  targetId: number,
  targetX: Fx,
  targetY: Fx,
  targetRadius: Fx,
  damage: Fx,
  speed: Fx,
  aoeRadius: Fx,
  startHeight: number,
  endHeight: number,
  startDist: Fx,
): Projectile {
  return {
    id,
    faction,
    pos: vec(x, y),
    targetId,
    impactPos: vec(targetX, targetY),
    targetRadius,
    damage,
    aoeRadius,
    height: startHeight,
    startHeight,
    endHeight,
    startDist,
    speed,
    dead: false,
  };
}
