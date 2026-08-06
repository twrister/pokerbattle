import { type Fx, ONE } from '../math/fixed.js';
import { type Vec2, vec } from '../math/vec2.js';
import { type UnitConfig, type UnitTypeId, getUnitConfig } from '../config/units.js';
import { type Attributes, attributesFromConfig } from '../stats/attributes.js';
import type { Buff } from '../stats/buff.js';

export const Faction = {
  Blue: 0,
  Red: 1,
} as const;
export type Faction = (typeof Faction)[keyof typeof Faction];

export function opposingFaction(faction: Faction): Faction {
  return faction === Faction.Blue ? Faction.Red : Faction.Blue;
}

/** AI 状态机。目前只有四态，行为树接入时替换 systems/ai.ts 即可，数据结构不用动。 */
export const UnitState = {
  /** 场上没有敌人，原地待命 */
  Idle: 0,
  /** 有目标但够不着，寻路接近 */
  Seek: 1,
  /** 目标在射程内，停下输出 */
  Attack: 2,
  /** 骑兵直线冲刺中，位移与途中命中由 cavalry 系统处理 */
  Charge: 3,
} as const;
export type UnitState = (typeof UnitState)[keyof typeof UnitState];

/** 无目标时 targetId 的取值。实体 id 从 1 开始，0 天然可以当空值。 */
export const NO_TARGET = 0;

export interface Unit {
  readonly id: number;
  readonly typeId: UnitTypeId;
  readonly config: UnitConfig;
  readonly faction: Faction;

  pos: Vec2;
  /** 归一化朝向，sim 内不存角度，避免用到三角函数 */
  facing: Vec2;
  hp: Fx;
  state: UnitState;

  targetId: number;
  /** 距离下次重新索敌还有几 tick */
  retargetIn: number;

  /** 攻击冷却剩余（tick，定点），每 tick 减 ONE */
  attackCooldown: Fx;
  /** 出手前摇剩余（tick，定点），> 0 表示正在挥手/拉弓 */
  windupLeft: Fx;

  /** 冲刺技能冷却剩余（tick）；无冲刺兵种恒为 0 */
  chargeCooldown: Fx;
  /** 本段冲刺剩余路程（格）；> 0 且 state=Charge 时正在冲 */
  chargeRemaining: Fx;
  /** 冲刺锁定方向（施放瞬间指向目标） */
  readonly chargeDir: Vec2;
  /** 本段冲刺已命中过的敌方 id，避免同一目标重复结算 */
  readonly chargeHits: number[];

  readonly base: Attributes;
  readonly stats: Attributes;
  readonly buffs: Buff[];
  /** buffs 变动后置位，下一帧重算 stats，避免每帧无谓地遍历 */
  statsDirty: boolean;

  /** A* 产出的剩余路点，pathIndex 指向当前要走的那个 */
  readonly path: Vec2[];
  pathIndex: number;
  repathIn: number;
  /** 上次算路时目标所在位置，用来判断目标是不是跑远了需要重算 */
  readonly pathGoal: Vec2;

  /** 本 tick 累计的碰撞推挤位移，分离系统结算后清零 */
  readonly push: Vec2;

  dead: boolean;
}

export function createUnit(id: number, typeId: UnitTypeId, faction: Faction, x: Fx, y: Fx): Unit {
  const config = getUnitConfig(typeId);
  const base = attributesFromConfig(config);
  return {
    id,
    typeId,
    config,
    faction,
    pos: vec(x, y),
    // 默认朝向对方半场，蓝方在下红方在上
    facing: vec(0, faction === Faction.Blue ? ONE : -ONE),
    hp: base.maxHp,
    state: UnitState.Idle,
    targetId: NO_TARGET,
    retargetIn: 0,
    attackCooldown: 0,
    windupLeft: 0,
    chargeCooldown: 0,
    chargeRemaining: 0,
    chargeDir: vec(0, faction === Faction.Blue ? ONE : -ONE),
    chargeHits: [],
    base,
    stats: attributesFromConfig(config),
    buffs: [],
    statsDirty: false,
    path: [],
    pathIndex: 0,
    repathIn: 0,
    pathGoal: vec(x, y),
    push: vec(0, 0),
    dead: false,
  };
}

export function isAlive(unit: Unit | undefined): unit is Unit {
  return unit !== undefined && !unit.dead && unit.hp > 0;
}
