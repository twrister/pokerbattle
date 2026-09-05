import type { Fx } from '../math/fixed.js';
import type { Faction } from './unit.js';

/**
 * 地面燃烧区：参与战斗判定，按间隔对半径内敌军造成伤害。
 * 与纯表现的 AoePulseEffect 分开，避免把伤害挂在短寿命特效上。
 */
export interface GroundHazard {
  readonly id: number;
  readonly x: Fx;
  readonly y: Fx;
  readonly radius: Fx;
  readonly damage: Fx;
  readonly faction: Faction;
  /** 铺火席位；2v2 灼烧伤害记到发射者而不是只认阵营。 */
  readonly ownerSlot: number;
  readonly intervalTicks: number;
  ticksUntilNextDamage: number;
  remainingTicks: number;
  readonly totalTicks: number;
}
