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
  readonly intervalTicks: number;
  ticksUntilNextDamage: number;
  remainingTicks: number;
  readonly totalTicks: number;
}
