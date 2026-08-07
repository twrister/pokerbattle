import type { Fx } from '../math/fixed.js';

/** 仅用于快照渲染的短寿命战斗效果，不参与任何战斗判定。 */
export interface HealEffect {
  readonly id: number;
  readonly x: Fx;
  readonly y: Fx;
  readonly radius: Fx;
  remainingTicks: number;
  readonly totalTicks: number;
}
