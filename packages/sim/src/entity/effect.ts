import type { Fx } from '../math/fixed.js';

/**
 * 单体受疗短寿命反馈，不参与任何战斗判定。
 * radius 仅供渲染按受疗单位体型缩放，不再表示群体治疗范围。
 */
export interface HealEffect {
  readonly id: number;
  readonly x: Fx;
  readonly y: Fx;
  readonly radius: Fx;
  remainingTicks: number;
  readonly totalTicks: number;
}

/** 伤害范围脉冲形状：整圆普攻圈 / 冲刺前方扇形 */
export type AoePulseKind = 'melee_ring' | 'charge_fan';

/**
 * 近战范围伤害或冲刺溅射的短寿命地面脉冲。
 * dir 仅扇形有意义；整圆时可为 0。
 */
export interface AoePulseEffect {
  readonly id: number;
  readonly kind: AoePulseKind;
  readonly x: Fx;
  readonly y: Fx;
  readonly radius: Fx;
  readonly dirX: Fx;
  readonly dirY: Fx;
  remainingTicks: number;
  readonly totalTicks: number;
}
