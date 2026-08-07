import { type Fx, fromFloat, toFloat } from '../math/fixed.js';

export type UnitTypeId =
  | 'melee_grunt'
  | 'ranged_archer'
  | 'melee_cavalry'
  | 'hero_king'
  | 'hero_queen';

/** 攻击方式：近战单体、近战范围、远程追踪弹 */
export type AttackKind =
  | { kind: 'melee' }
  | { kind: 'melee_aoe' }
  | { kind: 'projectile'; speed: Fx };

/** 冲刺技能参数。只有骑兵等具备冲锋的兵种才填写。 */
export interface ChargeConfig {
  /** 技能冷却（tick），20 tick = 1 秒 */
  cooldown: Fx;
  /** 起冲前原地前摇（tick），20 tick = 1 秒 */
  windup: Fx;
  /** 直线冲刺总距离（格） */
  distance: Fx;
  /** 相对移速的倍率 */
  speedMul: Fx;
  /** 触发窗口下限：与目标中心距 ≥ 此值才可冲 */
  triggerMin: Fx;
  /** 触发窗口上限：与目标中心距 ≤ 此值才可冲 */
  triggerMax: Fx;
  /** 途经命中造成的少量伤害 */
  hitDamage: Fx;
  /** 横向击退距离（格） */
  knockback: Fx;
  /** 碰到敌人后，前方溅射半径（格） */
  aoeRadius: Fx;
}

/** 国王持续光环的属性和范围。 */
export interface InspireConfig {
  radius: Fx;
  /** 攻击间隔乘数，小于 1 即提升攻速。 */
  attackIntervalMul: Fx;
  moveSpeedMul: Fx;
}

/** 女王自动治疗的选点、范围与冷却参数。 */
export interface HealConfig {
  cooldown: Fx;
  targetRange: Fx;
  radius: Fx;
  amount: Fx;
}

/**
 * 兵种配置。所有数值都是定点数，扩到 10 个兵种只是往 UNIT_CONFIGS 里加行，
 * 不需要新增任何类或分支逻辑（有技能的兵种除外，需接对应系统）。
 */
export interface UnitConfig {
  id: UnitTypeId;
  name: string;
  /** 碰撞半径（推挤 / 射程 / 场地夹紧），与显示体型无关 */
  radius: Fx;
  /**
   * 显示体型倍率，与碰撞半径解耦。
   * 1 = 铁卫基准（显示半径 = BODY_SCALE_REFERENCE），不影响碰撞。
   */
  bodyScale: Fx;
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
  /** 可选冲刺技能；有此字段的兵种由 cavalry 系统驱动 */
  charge?: ChargeConfig;
  /** 可选振奋光环；有此字段的兵种由 heroSkills 系统驱动 */
  inspire?: InspireConfig;
  /** 可选自动范围治疗；有此字段的兵种由 heroSkills 系统驱动 */
  heal?: HealConfig;
}

/**
 * 人类可读的浮点草稿。调试面板编辑、localStorage 持久化都用这套，
 * 写入模拟前再 fromFloat，避免在 UI 层直接碰定点。
 */
export interface UnitConfigDraft {
  id: UnitTypeId;
  name: string;
  radius: number;
  bodyScale: number;
  mass: number;
  maxHp: number;
  damage: number;
  attackInterval: number;
  attackWindup: number;
  range: number;
  moveSpeed: number;
  sightRange: number;
  attackKind: 'melee' | 'melee_aoe' | 'projectile';
  /** 仅 attackKind === 'projectile' 时有意义 */
  projectileSpeed: number;
}

/** 大于场地对角线（约 36.7），索敌时等价于全场搜索 */
const FULL_FIELD_SIGHT = fromFloat(40);

/**
 * 体型=1 时的显示半径（场景单位），取铁卫出厂碰撞半径作基准。
 * 渲染：显示半径 = BODY_SCALE_REFERENCE × bodyScale，与各兵种 radius 无关。
 */
export const BODY_SCALE_REFERENCE = 0.45;

function createDefaultConfigs(): Record<UnitTypeId, UnitConfig> {
  return {
    melee_grunt: {
      id: 'melee_grunt',
      name: '铁卫（近战）',
      radius: fromFloat(0.45),
      // 铁卫即体型基准
      bodyScale: fromFloat(1),
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
      // 相对铁卫：0.3 / 0.45，保持解耦前的观感
      bodyScale: fromFloat(0.3 / BODY_SCALE_REFERENCE),
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
    melee_cavalry: {
      id: 'melee_cavalry',
      name: '骑兵（冲刺）',
      radius: fromFloat(0.45),
      bodyScale: fromFloat(1),
      mass: fromFloat(3.2),
      maxHp: fromFloat(520),
      damage: fromFloat(95),
      attackInterval: fromFloat(20),
      attackWindup: fromFloat(7),
      range: fromFloat(0.55),
      moveSpeed: fromFloat(2.2),
      sightRange: FULL_FIELD_SIGHT,
      attack: { kind: 'melee_aoe' },
      charge: {
        cooldown: fromFloat(100),
        // 0.5 秒原地蓄力后再直线冲出
        windup: fromFloat(10),
        distance: fromFloat(3),
        speedMul: fromFloat(2),
        triggerMin: fromFloat(2),
        triggerMax: fromFloat(2.5),
        hitDamage: fromFloat(30),
        knockback: fromFloat(1),
        aoeRadius: fromFloat(1.5),
      },
    },
    hero_king: {
      id: 'hero_king',
      name: '国王（振奋）',
      radius: fromFloat(0.62),
      bodyScale: fromFloat(0.62 / BODY_SCALE_REFERENCE),
      mass: fromFloat(5),
      maxHp: fromFloat(800),
      damage: fromFloat(100),
      attackInterval: fromFloat(20),
      attackWindup: fromFloat(7),
      range: fromFloat(0.15),
      moveSpeed: fromFloat(1.7),
      sightRange: FULL_FIELD_SIGHT,
      attack: { kind: 'melee' },
      inspire: {
        radius: fromFloat(3),
        attackIntervalMul: fromFloat(0.8),
        moveSpeedMul: fromFloat(1.2),
      },
    },
    hero_queen: {
      id: 'hero_queen',
      name: '女王（治疗）',
      radius: fromFloat(0.48),
      bodyScale: fromFloat(0.48 / BODY_SCALE_REFERENCE),
      mass: fromFloat(2.6),
      maxHp: fromFloat(400),
      damage: fromFloat(120),
      attackInterval: fromFloat(24),
      attackWindup: fromFloat(9),
      range: fromFloat(5),
      moveSpeed: fromFloat(1.4),
      sightRange: FULL_FIELD_SIGHT,
      attack: { kind: 'projectile', speed: fromFloat(9) },
      heal: {
        cooldown: fromFloat(100),
        targetRange: fromFloat(3),
        radius: fromFloat(1.5),
        amount: fromFloat(120),
      },
    },
  };
}

/** 深拷贝攻击方式，避免共享引用 */
function cloneAttack(attack: AttackKind): AttackKind {
  if (attack.kind === 'projectile') return { kind: 'projectile', speed: attack.speed };
  return { kind: attack.kind };
}

/** 深拷贝一份配置，attack / charge 单独处理以免共享引用 */
function cloneConfig(config: UnitConfig): UnitConfig {
  return {
    ...config,
    attack: cloneAttack(config.attack),
    charge: config.charge ? { ...config.charge } : undefined,
    inspire: config.inspire ? { ...config.inspire } : undefined,
    heal: config.heal ? { ...config.heal } : undefined,
  };
}

function cloneConfigs(source: Record<UnitTypeId, UnitConfig>): Record<UnitTypeId, UnitConfig> {
  const out = {} as Record<UnitTypeId, UnitConfig>;
  for (const id of Object.keys(source) as UnitTypeId[]) {
    out[id] = cloneConfig(source[id]);
  }
  return out;
}

/** 把源配置逐字段写回目标对象，保持 UNIT_CONFIGS 条目引用稳定（已上场单位仍挂着它） */
function copyConfigInto(target: UnitConfig, source: UnitConfig): void {
  target.name = source.name;
  target.radius = source.radius;
  target.bodyScale = source.bodyScale;
  target.mass = source.mass;
  target.maxHp = source.maxHp;
  target.damage = source.damage;
  target.attackInterval = source.attackInterval;
  target.attackWindup = source.attackWindup;
  target.range = source.range;
  target.moveSpeed = source.moveSpeed;
  target.sightRange = source.sightRange;
  target.attack = cloneAttack(source.attack);
  target.charge = source.charge ? { ...source.charge } : undefined;
  target.inspire = source.inspire ? { ...source.inspire } : undefined;
  target.heal = source.heal ? { ...source.heal } : undefined;
}

export const UNIT_CONFIGS: Record<UnitTypeId, UnitConfig> = createDefaultConfigs();

/** 模块加载时冻结的出厂默认值，供「重置」对照 */
const DEFAULT_UNIT_CONFIGS: Record<UnitTypeId, UnitConfig> = cloneConfigs(UNIT_CONFIGS);

export const UNIT_TYPE_IDS = Object.keys(UNIT_CONFIGS) as UnitTypeId[];

/** 全兵种最大半径。空间哈希的格子大小以它为准；改配置后需 recompute。 */
export let MAX_UNIT_RADIUS: Fx = 0;

/** 按当前 UNIT_CONFIGS 重算最大半径 */
export function recomputeMaxUnitRadius(): void {
  MAX_UNIT_RADIUS = UNIT_TYPE_IDS.reduce((acc, id) => Math.max(acc, UNIT_CONFIGS[id].radius), 0);
}

recomputeMaxUnitRadius();

export function getUnitConfig(typeId: UnitTypeId): UnitConfig {
  return UNIT_CONFIGS[typeId];
}

/** 把定点配置导出成浮点草稿，供面板展示 */
export function toUnitConfigDraft(config: UnitConfig): UnitConfigDraft {
  return {
    id: config.id,
    name: config.name,
    radius: toFloat(config.radius),
    bodyScale: toFloat(config.bodyScale),
    mass: toFloat(config.mass),
    maxHp: toFloat(config.maxHp),
    damage: toFloat(config.damage),
    attackInterval: toFloat(config.attackInterval),
    attackWindup: toFloat(config.attackWindup),
    range: toFloat(config.range),
    moveSpeed: toFloat(config.moveSpeed),
    sightRange: toFloat(config.sightRange),
    attackKind: config.attack.kind,
    projectileSpeed: config.attack.kind === 'projectile' ? toFloat(config.attack.speed) : 9,
  };
}

/** 把草稿里的攻击方式还原成运行时 AttackKind */
function attackFromDraft(draft: UnitConfigDraft): AttackKind {
  if (draft.attackKind === 'projectile') {
    return { kind: 'projectile', speed: fromFloat(draft.projectileSpeed) };
  }
  if (draft.attackKind === 'melee_aoe') return { kind: 'melee_aoe' };
  return { kind: 'melee' };
}

/** 导出全部兵种的浮点草稿 */
export function dumpUnitConfigDrafts(): Record<UnitTypeId, UnitConfigDraft> {
  const out = {} as Record<UnitTypeId, UnitConfigDraft>;
  for (const id of UNIT_TYPE_IDS) {
    out[id] = toUnitConfigDraft(UNIT_CONFIGS[id]);
  }
  return out;
}

/** 导出厂默认浮点草稿（重置面板表单用） */
export function dumpDefaultUnitConfigDrafts(): Record<UnitTypeId, UnitConfigDraft> {
  const out = {} as Record<UnitTypeId, UnitConfigDraft>;
  for (const id of UNIT_TYPE_IDS) {
    out[id] = toUnitConfigDraft(DEFAULT_UNIT_CONFIGS[id]);
  }
  return out;
}

/** 用浮点草稿覆盖运行时配置表，并刷新 MAX_UNIT_RADIUS */
export function applyUnitConfigDrafts(drafts: Record<UnitTypeId, UnitConfigDraft>): void {
  for (const id of UNIT_TYPE_IDS) {
    const draft = drafts[id];
    if (!draft) continue;
    const target = UNIT_CONFIGS[id];
    target.name = draft.name;
    target.radius = fromFloat(draft.radius);
    // 缺省或非法体型回落为铁卫基准 1，避免 NaN 把精灵缩成看不见
    target.bodyScale = fromFloat(
      Number.isFinite(draft.bodyScale) && draft.bodyScale > 0 ? draft.bodyScale : 1,
    );
    target.mass = fromFloat(draft.mass);
    target.maxHp = fromFloat(draft.maxHp);
    target.damage = fromFloat(draft.damage);
    target.attackInterval = fromFloat(draft.attackInterval);
    target.attackWindup = fromFloat(draft.attackWindup);
    target.range = fromFloat(draft.range);
    target.moveSpeed = fromFloat(draft.moveSpeed);
    target.sightRange = fromFloat(draft.sightRange);
    target.attack = attackFromDraft(draft);
  }
  recomputeMaxUnitRadius();
}

/** 把全部兵种恢复到出厂默认值 */
export function resetUnitConfigsToDefault(): void {
  for (const id of UNIT_TYPE_IDS) {
    copyConfigInto(UNIT_CONFIGS[id], DEFAULT_UNIT_CONFIGS[id]);
  }
  recomputeMaxUnitRadius();
}
