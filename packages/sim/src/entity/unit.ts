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
  /** 皇家骑士直线冲刺中，位移与途中命中由 cavalry 系统处理 */
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
  /** 出兵席位；1v1 下等于 faction，2v2 用来区分同队两人。 */
  readonly ownerSlot: number;

  pos: Vec2;
  /** 归一化朝向，sim 内不存角度，避免用到三角函数 */
  facing: Vec2;
  hp: Fx;
  state: UnitState;

  targetId: number;
  /**
   * 当前目标对应的攻击环槽位（0..7）；无目标时为 -1。
   * 锁定目标时一次性决定，存活期间不变，避免围攻时来回换边。
   */
  engageSlot: number;
  /** 出生错峰：> 0 时暂不索敌；锁定后不周期重置（换火由 targeting 射程打断/目标死亡驱动） */
  retargetIn: number;

  /** 攻击冷却剩余（tick，定点），每 tick 减 ONE */
  attackCooldown: Fx;
  /** 出手前摇剩余（tick，定点），> 0 表示正在挥手/拉弓 */
  windupLeft: Fx;

  /** 冲刺技能冷却剩余（tick）；无冲刺兵种恒为 0 */
  chargeCooldown: Fx;
  /** 冲刺原地前摇剩余（tick）；> 0 时 state=Charge 但尚未起动 */
  chargeWindupLeft: Fx;
  /** 本段冲刺剩余路程（格）；> 0 且 state=Charge 且前摇结束时正在冲 */
  chargeRemaining: Fx;
  /** 冲刺锁定方向（施放瞬间指向目标） */
  readonly chargeDir: Vec2;
  /** 本段冲刺已命中过的敌方 id，避免同一目标重复结算 */
  readonly chargeHits: number[];
  /** 女王单体治疗的冷却剩余（tick）；无治疗技能的单位恒为 0 */
  healCooldown: Fx;
  /**
   * 治疗施法前摇剩余（tick）；> 0 时站定蓄力，走完才结算治疗。
   * 时长复用 attackWindup，表现上与普攻前摇一致。
   */
  healWindupLeft: Fx;
  /** 本次治疗前摇锁定的友军 id；无施法时为 NO_TARGET */
  healCastTargetId: number;
  /** 法师召唤技能的冷却剩余（tick）；无召唤技能的单位恒为 0 */
  summonCooldown: Fx;
  /**
   * 召唤施法前摇剩余（tick）；时长复用 attackWindup，
   * 期间站定且不会同时进行普通攻击。
   */
  summonWindupLeft: Fx;
  /**
   * 炸弹兵引信剩余（tick）；> 0 时站定蓄力，走完后自爆。
   * 无自爆技能的单位恒为 0。
   */
  detonateWindupLeft: Fx;
  /** 本单位是否已结算过自爆，避免死亡与引信结束双重引爆 */
  detonated: boolean;
  /**
   * 施法特效剩余逻辑帧。仅驱动快照 `casting`，不参与战斗判定。
   * 皇家骑士冲刺前摇走 chargeWindupLeft，不占用本字段。
   */
  castFxLeft: number;
  /**
   * 刚吃到战斗伤害的表现剩余逻辑帧。仅驱动快照 `hit`，
   * 供渲染层区分「挨打」与箭塔自然掉血。
   */
  hitFxLeft: number;
  /**
   * 刚吃到范围伤害的表现剩余逻辑帧。仅驱动快照 `aoeHit`，
   * 供渲染层同步加强闪红与轻抖。
   */
  aoeHitFxLeft: number;

  readonly base: Attributes;
  readonly stats: Attributes;
  readonly buffs: Buff[];
  /** buffs 变动后置位，下一帧重算 stats，避免每帧无谓地遍历 */
  statsDirty: boolean;
  /** 国王振奋光环是否生效；由技能系统写入，快照只读此标记 */
  inspired: boolean;

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

export function createUnit(
  id: number,
  typeId: UnitTypeId,
  faction: Faction,
  x: Fx,
  y: Fx,
  ownerSlot: number = faction,
): Unit {
  const config = getUnitConfig(typeId);
  const base = attributesFromConfig(config);
  return {
    id,
    typeId,
    config,
    faction,
    ownerSlot,
    pos: vec(x, y),
    // 默认朝向对方半场，蓝方在下红方在上
    facing: vec(0, faction === Faction.Blue ? ONE : -ONE),
    hp: base.maxHp,
    state: UnitState.Idle,
    targetId: NO_TARGET,
    engageSlot: -1,
    retargetIn: 0,
    attackCooldown: 0,
    windupLeft: 0,
    chargeCooldown: 0,
    chargeWindupLeft: 0,
    chargeRemaining: 0,
    chargeDir: vec(0, faction === Faction.Blue ? ONE : -ONE),
    chargeHits: [],
    healCooldown: 0,
    healWindupLeft: 0,
    healCastTargetId: NO_TARGET,
    summonCooldown: 0,
    summonWindupLeft: 0,
    detonateWindupLeft: 0,
    detonated: false,
    castFxLeft: 0,
    hitFxLeft: 0,
    aoeHitFxLeft: 0,
    base,
    stats: attributesFromConfig(config),
    buffs: [],
    statsDirty: false,
    inspired: false,
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

/** 受击表现持续逻辑帧，与 aoeHitFxLeft 对齐，保证当帧快照能读到。 */
const HIT_FX_TICKS = 2;

/**
 * 战斗扣血并标记受击表现。
 * 箭塔自然掉血必须直接改 hp，不能走这里，否则客户端会误闪红。
 */
export function applyCombatDamage(unit: Unit, amount: Fx, aoe = false): void {
  unit.hp -= amount;
  unit.hitFxLeft = HIT_FX_TICKS;
  if (aoe) unit.aoeHitFxLeft = HIT_FX_TICKS;
}
