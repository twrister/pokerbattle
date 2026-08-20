import { type Fx, fromFloat, toFloat } from '../math/fixed.js';
import rawUnitConfigs from './units.json';

export type UnitTypeId =
  | 'melee_grunt'
  | 'melee_guard'
  | 'melee_golem'
  | 'ranged_archer'
  | 'ranged_ballista'
  | 'ranged_chariot'
  | 'melee_charge_wagon'
  | 'giant_bomb'
  | 'small_bomb'
  | 'melee_cavalry'
  | 'hero_king'
  | 'hero_queen'
  | 'hero_mage'
  | 'hero_archmage'
  | 'dragon'
  | 'summoned_skeleton'
  | 'summoned_bomber'
  | 'building_base'
  | 'building_tower'
  | 'building_tower_advanced'
  | 'building_tower_triple';

export type MovementLayer = 'ground' | 'air';

/** 攻击方式：近战单体、近战范围、远程追踪弹、落点范围弹 */
export type AttackKind =
  | { kind: 'melee' }
  | { kind: 'melee_aoe' }
  | { kind: 'projectile'; speed: Fx }
  | { kind: 'projectile_aoe'; speed: Fx; aoeRadius: Fx };

/** 冲刺技能参数。只有皇家骑士等具备冲锋的兵种才填写。 */
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

/** 女王自动单体治疗的选目标距离与冷却参数。 */
export interface HealConfig {
  cooldown: Fx;
  /** 可治疗友军的中心距上限（格） */
  targetRange: Fx;
  amount: Fx;
}

/** 法师自动召唤单位的类型与冷却参数。 */
export interface SummonConfig {
  cooldown: Fx;
  unitTypeId: UnitTypeId;
}

/** 炸弹兵接近目标后的引信与爆炸范围。 */
export interface DetonateConfig {
  /** 引信时长（tick），20 tick = 1 秒 */
  fuse: Fx;
  /** 爆炸伤害半径（格），圆心距判定 */
  aoeRadius: Fx;
}

/** 阵亡时在原地生成指定兵种。count 为整数人数。 */
export interface DeathSpawnConfig {
  unitTypeId: UnitTypeId;
  count: number;
}

/**
 * 兵种配置。所有数值都是定点数，扩到 10 个兵种只是往 UNIT_CONFIGS 里加行，
 * 不需要新增任何类或分支逻辑（有技能的兵种除外，需接对应系统）。
 */
export interface UnitConfig {
  id: UnitTypeId;
  name: string;
  /** 卡组按钮角标；仅当阵型只含本兵种且非空时显示。 */
  tag: string;
  /** 碰撞半径（推挤 / 射程 / 场地夹紧），与显示体型无关 */
  radius: Fx;
  /**
   * 显示体型倍率，与碰撞半径解耦。
   * 1 = 民兵基准（显示半径 = BODY_SCALE_REFERENCE），不影响碰撞。
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
  /** 最大射程，按边缘到边缘算，不含双方半径 */
  range: Fx;
  /**
   * 最小射程（边缘到边缘）。目标贴得比这更近则无法出手；0 表示无近距限制。
   * 不进 Attributes，不可被 Buff。
   */
  minRange: Fx;
  /** 移动速度，单位/秒 */
  moveSpeed: Fx;
  /** 索敌半径。默认给到能覆盖全场；城堡不受此限制，圈外仍可锁定 */
  sightRange: Fx;
  /** 移动碰撞层；空中与地面单位互不推挤。 */
  movementLayer: MovementLayer;
  /**
   * 能否锁定并攻击空中单位。
   * 近战默认 false，远程默认 true；战车等地面炮可单独关掉。
   */
  canAttackAir: boolean;
  /**
   * 索敌时是否优先空中单位。
   * 射程内空中 > 射程内地面 > 视野内空中 > 视野内地面；缺省 false。
   */
  preferAir: boolean;
  /**
   * 索敌与普攻是否只以建筑为合法目标。
   * 缺省 false；攻城单位写出 true。
   */
  targetsBuildingsOnly: boolean;
  attack: AttackKind;
  /**
   * 占地边长（整数格）。> 0 表示建筑：不移动、不索敌，碰撞按方形处理。
   * 用整数而非定点，便于格子吸附与占格表运算。
   */
  footprint: number;
  /** 可选冲刺技能；有此字段的兵种由 cavalry 系统驱动 */
  charge?: ChargeConfig;
  /** 可选振奋光环；有此字段的兵种由 heroSkills 系统驱动 */
  inspire?: InspireConfig;
  /** 可选自动单体治疗；有此字段的兵种由 heroSkills 系统驱动 */
  heal?: HealConfig;
  /** 可选自动召唤技能；有此字段的兵种由 heroSkills 系统驱动 */
  summon?: SummonConfig;
  /** 可选自爆技能；有此字段的兵种由 detonate 系统驱动，不走普攻 */
  detonate?: DetonateConfig;
  /** 可选阵亡生成；有此字段的兵种由 cleanup 在死亡点生成新单位 */
  deathSpawn?: DeathSpawnConfig;
}

/** 冲刺技能浮点草稿（与 JSON / 面板往返一致） */
export interface ChargeConfigDraft {
  cooldown: number;
  windup: number;
  distance: number;
  speedMul: number;
  triggerMin: number;
  triggerMax: number;
  hitDamage: number;
  knockback: number;
  aoeRadius: number;
}

/** 振奋光环浮点草稿 */
export interface InspireConfigDraft {
  radius: number;
  attackIntervalMul: number;
  moveSpeedMul: number;
}

/** 治疗技能浮点草稿 */
export interface HealConfigDraft {
  cooldown: number;
  targetRange: number;
  amount: number;
}

/** 召唤技能浮点草稿 */
export interface SummonConfigDraft {
  cooldown: number;
  unitTypeId: UnitTypeId;
}

/** 自爆技能浮点草稿 */
export interface DetonateConfigDraft {
  fuse: number;
  aoeRadius: number;
}

/** 阵亡生成浮点草稿（count 保持整数，不走定点） */
export interface DeathSpawnConfigDraft {
  unitTypeId: UnitTypeId;
  count: number;
}

/**
 * 人类可读的浮点草稿。调试面板与 units.json 都用这套，
 * 写入模拟前再 fromFloat，避免在 UI 层直接碰定点。
 */
export interface UnitConfigDraft {
  id: UnitTypeId;
  name: string;
  /** 卡组角标；空或缺省表示不显示 */
  tag?: string;
  radius: number;
  bodyScale: number;
  mass: number;
  maxHp: number;
  damage: number;
  attackInterval: number;
  attackWindup: number;
  range: number;
  /** 最小射程；缺省或非法按 0 */
  minRange?: number;
  moveSpeed: number;
  sightRange: number;
  movementLayer: MovementLayer;
  /** 缺省时按攻击方式推断：近战 false，远程 true */
  canAttackAir?: boolean;
  /** 缺省 false；仅对空优先兵种写出 true */
  preferAir?: boolean;
  /** 缺省 false；仅攻城单位写出 true */
  targetsBuildingsOnly?: boolean;
  attackKind: 'melee' | 'melee_aoe' | 'projectile' | 'projectile_aoe';
  /** 仅弹道攻击时有意义 */
  projectileSpeed: number;
  /** 仅范围弹道攻击时有意义 */
  aoeRadius: number;
  /** 占地边长（整数格）；缺省或 0 表示普通单位 */
  footprint?: number;
  /** 有则随 JSON 往返，保存时不得丢失 */
  charge?: ChargeConfigDraft;
  inspire?: InspireConfigDraft;
  heal?: HealConfigDraft;
  summon?: SummonConfigDraft;
  detonate?: DetonateConfigDraft;
  deathSpawn?: DeathSpawnConfigDraft;
}

/**
 * 体型=1 时的显示半径（场景单位），取民兵出厂碰撞半径作基准。
 * 渲染：显示半径 = BODY_SCALE_REFERENCE × bodyScale，与各兵种 radius 无关。
 */
export const BODY_SCALE_REFERENCE = 0.45;

/** 深拷贝攻击方式，避免共享引用 */
function cloneAttack(attack: AttackKind): AttackKind {
  if (attack.kind === 'projectile') return { kind: 'projectile', speed: attack.speed };
  if (attack.kind === 'projectile_aoe') {
    return { kind: 'projectile_aoe', speed: attack.speed, aoeRadius: attack.aoeRadius };
  }
  return { kind: attack.kind };
}

/** 深拷贝一份配置，attack / 技能块单独处理以免共享引用 */
function cloneConfig(config: UnitConfig): UnitConfig {
  return {
    ...config,
    footprint: config.footprint,
    attack: cloneAttack(config.attack),
    charge: config.charge ? { ...config.charge } : undefined,
    inspire: config.inspire ? { ...config.inspire } : undefined,
    heal: config.heal ? { ...config.heal } : undefined,
    summon: config.summon ? { ...config.summon } : undefined,
    detonate: config.detonate ? { ...config.detonate } : undefined,
    deathSpawn: config.deathSpawn ? { ...config.deathSpawn } : undefined,
  };
}

/** 深拷贝整张配置表，避免调试面板编辑污染默认快照。 */
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
  target.tag = source.tag;
  target.radius = source.radius;
  target.bodyScale = source.bodyScale;
  target.mass = source.mass;
  target.maxHp = source.maxHp;
  target.damage = source.damage;
  target.attackInterval = source.attackInterval;
  target.attackWindup = source.attackWindup;
  target.range = source.range;
  target.minRange = source.minRange;
  target.moveSpeed = source.moveSpeed;
  target.sightRange = source.sightRange;
  target.movementLayer = source.movementLayer;
  target.canAttackAir = source.canAttackAir;
  target.preferAir = source.preferAir;
  target.targetsBuildingsOnly = source.targetsBuildingsOnly;
  target.footprint = source.footprint;
  target.attack = cloneAttack(source.attack);
  target.charge = source.charge ? { ...source.charge } : undefined;
  target.inspire = source.inspire ? { ...source.inspire } : undefined;
  target.heal = source.heal ? { ...source.heal } : undefined;
  target.summon = source.summon ? { ...source.summon } : undefined;
  target.detonate = source.detonate ? { ...source.detonate } : undefined;
  target.deathSpawn = source.deathSpawn ? { ...source.deathSpawn } : undefined;
}

/** 把草稿里的攻击方式还原成运行时 AttackKind */
function attackFromDraft(draft: UnitConfigDraft): AttackKind {
  if (draft.attackKind === 'projectile') {
    return { kind: 'projectile', speed: fromFloat(draft.projectileSpeed) };
  }
  if (draft.attackKind === 'projectile_aoe') {
    return {
      kind: 'projectile_aoe',
      speed: fromFloat(draft.projectileSpeed),
      aoeRadius: fromFloat(draft.aoeRadius),
    };
  }
  if (draft.attackKind === 'melee_aoe') return { kind: 'melee_aoe' };
  return { kind: 'melee' };
}

/** 浮点冲刺草稿 → 定点 */
function chargeFromDraft(draft: ChargeConfigDraft): ChargeConfig {
  return {
    cooldown: fromFloat(draft.cooldown),
    windup: fromFloat(draft.windup),
    distance: fromFloat(draft.distance),
    speedMul: fromFloat(draft.speedMul),
    triggerMin: fromFloat(draft.triggerMin),
    triggerMax: fromFloat(draft.triggerMax),
    hitDamage: fromFloat(draft.hitDamage),
    knockback: fromFloat(draft.knockback),
    aoeRadius: fromFloat(draft.aoeRadius),
  };
}

/** 浮点振奋草稿 → 定点 */
function inspireFromDraft(draft: InspireConfigDraft): InspireConfig {
  return {
    radius: fromFloat(draft.radius),
    attackIntervalMul: fromFloat(draft.attackIntervalMul),
    moveSpeedMul: fromFloat(draft.moveSpeedMul),
  };
}

/** 浮点治疗草稿 → 定点 */
function healFromDraft(draft: HealConfigDraft): HealConfig {
  return {
    cooldown: fromFloat(draft.cooldown),
    targetRange: fromFloat(draft.targetRange),
    amount: fromFloat(draft.amount),
  };
}

/** 浮点召唤草稿 → 定点 */
function summonFromDraft(draft: SummonConfigDraft): SummonConfig {
  return {
    cooldown: fromFloat(draft.cooldown),
    unitTypeId: draft.unitTypeId,
  };
}

/** 浮点自爆草稿 → 定点 */
function detonateFromDraft(draft: DetonateConfigDraft): DetonateConfig {
  return {
    fuse: fromFloat(draft.fuse),
    aoeRadius: fromFloat(draft.aoeRadius),
  };
}

/** 阵亡生成草稿：人数取非负整数，非法回落为 0（不生成）。 */
function deathSpawnFromDraft(draft: DeathSpawnConfigDraft): DeathSpawnConfig {
  return {
    unitTypeId: draft.unitTypeId,
    count: normalizeDeathSpawnCount(draft.count),
  };
}

/** 单条浮点草稿转运行时定点配置 */
function configFromDraft(draft: UnitConfigDraft): UnitConfig {
  return {
    id: draft.id,
    name: draft.name,
    tag: normalizeUnitTag(draft.tag),
    radius: fromFloat(draft.radius),
    bodyScale: fromFloat(
      Number.isFinite(draft.bodyScale) && draft.bodyScale > 0 ? draft.bodyScale : 1,
    ),
    mass: fromFloat(draft.mass),
    maxHp: fromFloat(draft.maxHp),
    damage: fromFloat(draft.damage),
    attackInterval: fromFloat(draft.attackInterval),
    attackWindup: fromFloat(draft.attackWindup),
    range: fromFloat(draft.range),
    minRange: fromFloat(normalizeMinRange(draft.minRange)),
    moveSpeed: fromFloat(draft.moveSpeed),
    sightRange: fromFloat(draft.sightRange),
    movementLayer: draft.movementLayer === 'air' ? 'air' : 'ground',
    canAttackAir: resolveCanAttackAir(draft.attackKind, draft.canAttackAir),
    preferAir: draft.preferAir === true,
    targetsBuildingsOnly: draft.targetsBuildingsOnly === true,
    footprint: normalizeFootprint(draft.footprint),
    attack: attackFromDraft(draft),
    charge: draft.charge ? chargeFromDraft(draft.charge) : undefined,
    inspire: draft.inspire ? inspireFromDraft(draft.inspire) : undefined,
    heal: draft.heal ? healFromDraft(draft.heal) : undefined,
    summon: draft.summon ? summonFromDraft(draft.summon) : undefined,
    detonate: draft.detonate ? detonateFromDraft(draft.detonate) : undefined,
    deathSpawn: draft.deathSpawn ? deathSpawnFromDraft(draft.deathSpawn) : undefined,
  };
}

/** 标签只保留可见文本；空/空白视为未配置。 */
function normalizeUnitTag(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 近战默认不对空；远程默认可对空。 */
function defaultCanAttackAir(attackKind: AttackKind['kind']): boolean {
  return attackKind === 'projectile' || attackKind === 'projectile_aoe';
}

/** JSON 显式覆盖优先，否则按攻击方式给默认值。 */
function resolveCanAttackAir(
  attackKind: AttackKind['kind'],
  override: boolean | undefined,
): boolean {
  if (typeof override === 'boolean') return override;
  return defaultCanAttackAir(attackKind);
}

/** 最小射程缺省/非法回落为 0（无近距限制）。 */
function normalizeMinRange(value: number | undefined): number {
  if (!Number.isFinite(value) || (value as number) < 0) return 0;
  return value as number;
}

/** 占地必须是正整数；缺省/非法回落为 0（普通单位）。 */
function normalizeFootprint(value: number | undefined): number {
  if (!Number.isFinite(value) || (value as number) <= 0) return 0;
  return Math.floor(value as number);
}

/** 阵亡生成人数：缺省/非法回落为 0，避免负人数或小数。 */
function normalizeDeathSpawnCount(value: number | undefined): number {
  if (!Number.isFinite(value) || (value as number) <= 0) return 0;
  return Math.floor(value as number);
}

/** 有占地即为建筑：不移动、碰撞按方形处理；是否索敌/出手见 canBuildingAttack */
export function isBuildingConfig(config: UnitConfig): boolean {
  return config.footprint > 0;
}

/** 有攻击参数的建筑才参与索敌/出手；无伤害或无射程的建筑仍跳过 */
export function canBuildingAttack(config: UnitConfig): boolean {
  return isBuildingConfig(config) && config.damage > 0 && config.range > 0;
}

/** 三座箭塔共用塔顶弹道高度与箭矢视觉；基地单独判断 */
export function isArcherTowerId(id: UnitTypeId): boolean {
  return id === 'building_tower'
    || id === 'building_tower_advanced'
    || id === 'building_tower_triple';
}

/** 城堡（基地）：索敌时无视 sightRange，圈外仍可锁定 */
export function isCastleId(id: UnitTypeId): boolean {
  return id === 'building_base';
}

/** 弓手、连弩车、箭塔、基地共用箭矢弹道视觉与 explode4 命中。 */
export function usesArrowVisual(id: UnitTypeId): boolean {
  return id === 'ranged_archer'
    || id === 'ranged_ballista'
    || isArcherTowerId(id)
    || id === 'building_base';
}

/** 从 units.json 加载全部兵种并转成定点配置表。 */
function loadConfigsFromJson(): Record<UnitTypeId, UnitConfig> {
  const drafts = rawUnitConfigs as Record<UnitTypeId, UnitConfigDraft>;
  const out = {} as Record<UnitTypeId, UnitConfig>;
  for (const id of Object.keys(drafts) as UnitTypeId[]) {
    out[id] = configFromDraft({ ...drafts[id], id });
  }
  return out;
}

/** 按兵种索引的运行时配置表。 */
export const UNIT_CONFIGS: Record<UnitTypeId, UnitConfig> = loadConfigsFromJson();

/** 模块加载时冻结的出厂默认值，供「重置」对照；保存写回 JSON 后可再 capture */
let DEFAULT_UNIT_CONFIGS: Record<UnitTypeId, UnitConfig> = cloneConfigs(UNIT_CONFIGS);

export const UNIT_TYPE_IDS = Object.keys(UNIT_CONFIGS) as UnitTypeId[];

/** 全兵种最大半径。空间哈希的格子大小以它为准；改配置后需 recompute。 */
export let MAX_UNIT_RADIUS: Fx = 0;

/** 按当前 UNIT_CONFIGS 重算最大半径；建筑不进空间哈希，跳过以免格子过大。 */
export function recomputeMaxUnitRadius(): void {
  MAX_UNIT_RADIUS = UNIT_TYPE_IDS.reduce((acc, id) => {
    const config = UNIT_CONFIGS[id];
    if (isBuildingConfig(config)) return acc;
    return Math.max(acc, config.radius);
  }, 0);
}

recomputeMaxUnitRadius();

/** 查询兵种配置。 */
export function getUnitConfig(typeId: UnitTypeId): UnitConfig {
  return UNIT_CONFIGS[typeId];
}

/** 把定点配置导出成浮点草稿，供面板展示 / 写回 JSON。 */
export function toUnitConfigDraft(config: UnitConfig): UnitConfigDraft {
  const draft: UnitConfigDraft = {
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
    minRange: toFloat(config.minRange),
    moveSpeed: toFloat(config.moveSpeed),
    sightRange: toFloat(config.sightRange),
    movementLayer: config.movementLayer,
    attackKind: config.attack.kind,
    projectileSpeed:
      config.attack.kind === 'projectile' || config.attack.kind === 'projectile_aoe'
        ? toFloat(config.attack.speed)
        : 9,
    aoeRadius: config.attack.kind === 'projectile_aoe' ? toFloat(config.attack.aoeRadius) : 0,
  };
  // 只写出与攻击方式默认值不同的覆盖，避免每个近战都带 false
  if (config.canAttackAir !== defaultCanAttackAir(config.attack.kind)) {
    draft.canAttackAir = config.canAttackAir;
  }
  if (config.preferAir) draft.preferAir = true;
  if (config.targetsBuildingsOnly) draft.targetsBuildingsOnly = true;
  if (config.tag) draft.tag = config.tag;
  if (config.footprint > 0) draft.footprint = config.footprint;
  if (config.charge) {
    draft.charge = {
      cooldown: toFloat(config.charge.cooldown),
      windup: toFloat(config.charge.windup),
      distance: toFloat(config.charge.distance),
      speedMul: toFloat(config.charge.speedMul),
      triggerMin: toFloat(config.charge.triggerMin),
      triggerMax: toFloat(config.charge.triggerMax),
      hitDamage: toFloat(config.charge.hitDamage),
      knockback: toFloat(config.charge.knockback),
      aoeRadius: toFloat(config.charge.aoeRadius),
    };
  }
  if (config.inspire) {
    draft.inspire = {
      radius: toFloat(config.inspire.radius),
      attackIntervalMul: toFloat(config.inspire.attackIntervalMul),
      moveSpeedMul: toFloat(config.inspire.moveSpeedMul),
    };
  }
  if (config.heal) {
    draft.heal = {
      cooldown: toFloat(config.heal.cooldown),
      targetRange: toFloat(config.heal.targetRange),
      amount: toFloat(config.heal.amount),
    };
  }
  if (config.summon) {
    draft.summon = {
      cooldown: toFloat(config.summon.cooldown),
      unitTypeId: config.summon.unitTypeId,
    };
  }
  if (config.detonate) {
    draft.detonate = {
      fuse: toFloat(config.detonate.fuse),
      aoeRadius: toFloat(config.detonate.aoeRadius),
    };
  }
  if (config.deathSpawn) {
    draft.deathSpawn = {
      unitTypeId: config.deathSpawn.unitTypeId,
      count: config.deathSpawn.count,
    };
  }
  return draft;
}

/** 导出全部兵种的浮点草稿。 */
export function dumpUnitConfigDrafts(): Record<UnitTypeId, UnitConfigDraft> {
  return dumpConfigDrafts(UNIT_CONFIGS);
}

/** 导出指定配置表的浮点草稿。 */
function dumpConfigDrafts(source: Record<UnitTypeId, UnitConfig>): Record<UnitTypeId, UnitConfigDraft> {
  const out = {} as Record<UnitTypeId, UnitConfigDraft>;
  for (const id of UNIT_TYPE_IDS) {
    out[id] = toUnitConfigDraft(source[id]);
  }
  return out;
}

/** 导出厂默认浮点草稿（重置面板表单用） */
export function dumpDefaultUnitConfigDrafts(): Record<UnitTypeId, UnitConfigDraft> {
  return dumpConfigDrafts(DEFAULT_UNIT_CONFIGS);
}

/** 用草稿覆盖运行时配置表，并刷新最大半径。 */
export function applyUnitConfigDrafts(drafts: Record<UnitTypeId, UnitConfigDraft>): void {
  for (const id of UNIT_TYPE_IDS) {
    const draft = drafts[id];
    if (!draft) continue;
    // 已上场单位持有 UNIT_CONFIGS 引用，始终原地更新而非替换。
    copyConfigInto(UNIT_CONFIGS[id], configFromDraft({ ...draft, id }));
  }
  recomputeMaxUnitRadius();
}

/** 把全部兵种恢复到出厂默认值（以最近一次 capture / 模块加载时的快照为准） */
export function resetUnitConfigsToDefault(): void {
  for (const id of UNIT_TYPE_IDS) {
    copyConfigInto(UNIT_CONFIGS[id], DEFAULT_UNIT_CONFIGS[id]);
  }
  recomputeMaxUnitRadius();
}

/** 把当前运行时配置记为新的出厂快照（保存写回 units.json 成功后调用） */
export function captureUnitConfigsAsDefault(): void {
  DEFAULT_UNIT_CONFIGS = cloneConfigs(UNIT_CONFIGS);
}
