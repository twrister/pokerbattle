import { type Fx, fromFloat, toFloat } from '../math/fixed.js';

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

/**
 * 人类可读的浮点草稿。调试面板编辑、localStorage 持久化都用这套，
 * 写入模拟前再 fromFloat，避免在 UI 层直接碰定点。
 */
export interface UnitConfigDraft {
  id: UnitTypeId;
  name: string;
  radius: number;
  mass: number;
  maxHp: number;
  damage: number;
  attackInterval: number;
  attackWindup: number;
  range: number;
  moveSpeed: number;
  sightRange: number;
  attackKind: 'melee' | 'projectile';
  /** 仅 attackKind === 'projectile' 时有意义 */
  projectileSpeed: number;
}

/** 大于场地对角线（约 36.7），索敌时等价于全场搜索 */
const FULL_FIELD_SIGHT = fromFloat(40);

function createDefaultConfigs(): Record<UnitTypeId, UnitConfig> {
  return {
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
}

/** 深拷贝一份配置，attack 联合类型单独处理以免共享引用 */
function cloneConfig(config: UnitConfig): UnitConfig {
  return {
    ...config,
    attack:
      config.attack.kind === 'melee'
        ? { kind: 'melee' }
        : { kind: 'projectile', speed: config.attack.speed },
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
  target.mass = source.mass;
  target.maxHp = source.maxHp;
  target.damage = source.damage;
  target.attackInterval = source.attackInterval;
  target.attackWindup = source.attackWindup;
  target.range = source.range;
  target.moveSpeed = source.moveSpeed;
  target.sightRange = source.sightRange;
  target.attack =
    source.attack.kind === 'melee'
      ? { kind: 'melee' }
      : { kind: 'projectile', speed: source.attack.speed };
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
    target.mass = fromFloat(draft.mass);
    target.maxHp = fromFloat(draft.maxHp);
    target.damage = fromFloat(draft.damage);
    target.attackInterval = fromFloat(draft.attackInterval);
    target.attackWindup = fromFloat(draft.attackWindup);
    target.range = fromFloat(draft.range);
    target.moveSpeed = fromFloat(draft.moveSpeed);
    target.sightRange = fromFloat(draft.sightRange);
    target.attack =
      draft.attackKind === 'melee'
        ? { kind: 'melee' }
        : { kind: 'projectile', speed: fromFloat(draft.projectileSpeed) };
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
