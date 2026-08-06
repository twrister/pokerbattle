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
  damage: Fx;
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
  damage: Fx,
  speed: Fx,
): Projectile {
  return { id, faction, pos: vec(x, y), targetId, damage, speed, dead: false };
}
