import { type Fx, ONE, mul } from '../math/fixed.js';
import type { Attributes } from './attributes.js';

/** 可被 Buff 修改的属性名，与 Attributes 的字段一一对应 */
export const BUFF_STATS = [
  'maxHp',
  'damage',
  'attackInterval',
  'attackWindup',
  'moveSpeed',
  'range',
] as const;

export type BuffStat = (typeof BUFF_STATS)[number];

export const BuffOp = {
  /** 加法：value 是绝对增量 */
  Add: 0,
  /** 乘法：value 是增减比例，fromFloat(0.2) 表示 +20% */
  Mul: 1,
} as const;
export type BuffOp = (typeof BuffOp)[keyof typeof BuffOp];

export interface Buff {
  id: number;
  /** 施加者的实体 id，用于「同源不叠加」这类规则，MVP 暂不使用 */
  sourceId: number;
  stat: BuffStat;
  op: BuffOp;
  value: Fx;
  /** 剩余持续 tick，负数表示永久 */
  remainingTicks: number;
}

/**
 * 由基础属性和 Buff 列表算出最终属性。
 *
 * 结算顺序固定为「先加后乘」：final = (base + Σadd) * (1 + Σmul)。
 * 顺序写死是为了确定性——如果按 buff 添加顺序混合加乘，
 * 不同客户端的 buff 到达次序稍有差别就会算出不同结果。
 */
export function recomputeStats(base: Readonly<Attributes>, buffs: readonly Buff[], out: Attributes): void {
  for (const stat of BUFF_STATS) {
    let add: Fx = 0;
    let mulRatio: Fx = 0;
    for (const buff of buffs) {
      if (buff.stat !== stat) continue;
      if (buff.op === BuffOp.Add) add += buff.value;
      else mulRatio += buff.value;
    }
    out[stat] = mul(base[stat] + add, ONE + mulRatio);
  }
}

/**
 * 推进所有 Buff 的倒计时，返回是否有 Buff 到期。
 * 到期的直接从数组里就地移除，保持数组紧凑。
 */
export function tickBuffList(buffs: Buff[]): boolean {
  let changed = false;
  for (let i = buffs.length - 1; i >= 0; i--) {
    const buff = buffs[i]!;
    if (buff.remainingTicks < 0) continue;
    buff.remainingTicks--;
    if (buff.remainingTicks <= 0) {
      buffs.splice(i, 1);
      changed = true;
    }
  }
  return changed;
}
