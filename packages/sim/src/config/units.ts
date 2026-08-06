import { type Fx, fromFloat } from '../math/fixed.js';

export type UnitTypeId = 'melee_grunt' | 'ranged_archer';

/** 攻击方式：近战直接结算，远程生成一枚追踪弹 */
export type AttackKind = { kind: 'melee' } | { kind: 'projectile'; speed: Fx };

/**
 * 兵种配置。所有数值都是定点数，扩到 10 个兵种只是往 UNIT_CONFIGS 里加行，
 * 不需要新增任何类或分支逻辑。
 */
export interface UnitConfig {
  id: UnitTypeId;
  name: string;
  /** 碰撞半径，同时决定渲染体型 */
  radius: Fx;
  /** 推挤权重，体型越大越推不动 */
  mass: Fx;
  maxHp: Fx;
  damage: Fx;
  /** 两次出手的间隔（tick），20 tick = 1 秒 */
  attackInterval: Fx;
  /** 出手前摇（tick），走完前摇才结算伤害，给动画和「打断」留位置 */
  attackWindup: Fx;
  /** 射程，按边缘到边缘算，不含双方半径 */
  range: Fx;
  /** 移动速度，单位/秒 */
  moveSpeed: Fx;
  /** 索敌半径。默认给到能覆盖全场，等价于「攻击场上最近的敌人」 */
  sightRange: Fx;
  attack: AttackKind;
}

/** 大于场地对角线（约 36.7），索敌时等价于全场搜索 */
const FULL_FIELD_SIGHT = fromFloat(40);

export const UNIT_CONFIGS: Record<UnitTypeId, UnitConfig> = {
  melee_grunt: {
    id: 'melee_grunt',
    name: '铁卫（近战）',
    radius: fromFloat(0.45),
    mass: fromFloat(3.0),
    maxHp: fromFloat(620),
    damage: fromFloat(95),
    attackInterval: fromFloat(20),
    attackWindup: fromFloat(7),
    range: fromFloat(0.15),
    moveSpeed: fromFloat(1.7),
    sightRange: FULL_FIELD_SIGHT,
    attack: { kind: 'melee' },
  },
  ranged_archer: {
    id: 'ranged_archer',
    name: '弓手（远程）',
    radius: fromFloat(0.3),
    mass: fromFloat(1.4),
    maxHp: fromFloat(240),
    damage: fromFloat(65),
    attackInterval: fromFloat(24),
    attackWindup: fromFloat(9),
    range: fromFloat(5.0),
    moveSpeed: fromFloat(1.4),
    sightRange: FULL_FIELD_SIGHT,
    attack: { kind: 'projectile', speed: fromFloat(9.0) },
  },
};

export const UNIT_TYPE_IDS = Object.keys(UNIT_CONFIGS) as UnitTypeId[];

/** 全兵种最大半径。空间哈希的格子大小以它为准，保证 3x3 邻域不漏配对。 */
export const MAX_UNIT_RADIUS: Fx = UNIT_TYPE_IDS.reduce(
  (acc, id) => Math.max(acc, UNIT_CONFIGS[id].radius),
  0,
);

export function getUnitConfig(typeId: UnitTypeId): UnitConfig {
  return UNIT_CONFIGS[typeId];
}
