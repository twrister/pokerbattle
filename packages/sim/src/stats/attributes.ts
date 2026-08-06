import type { Fx } from '../math/fixed.js';
import type { UnitConfig } from '../config/units.js';

/**
 * 单位的可变属性。每个单位持有两份：
 * base 来自配置表且永不改动，stats 是叠完 Buff 的最终值，战斗逻辑一律读 stats。
 */
export interface Attributes {
  maxHp: Fx;
  damage: Fx;
  attackInterval: Fx;
  attackWindup: Fx;
  moveSpeed: Fx;
  range: Fx;
}

export function attributesFromConfig(config: UnitConfig): Attributes {
  return {
    maxHp: config.maxHp,
    damage: config.damage,
    attackInterval: config.attackInterval,
    attackWindup: config.attackWindup,
    moveSpeed: config.moveSpeed,
    range: config.range,
  };
}

export function copyAttributes(src: Readonly<Attributes>, out: Attributes): void {
  out.maxHp = src.maxHp;
  out.damage = src.damage;
  out.attackInterval = src.attackInterval;
  out.attackWindup = src.attackWindup;
  out.moveSpeed = src.moveSpeed;
  out.range = src.range;
}
