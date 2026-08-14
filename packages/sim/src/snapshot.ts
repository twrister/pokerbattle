import { toFloat } from './math/fixed.js';
import type { UnitTypeId } from './config/units.js';
import { UnitState, type Faction } from './entity/unit.js';
import type { AoePulseKind } from './entity/effect.js';
import type { World } from './world.js';

/**
 * 给渲染层看的只读世界切片。
 *
 * 这里是定点数与浮点数的唯一边界：越过这层之后随便用 float 做插值和三角函数，
 * 反过来渲染层拿不到任何 sim 内部对象的引用，不可能误改世界状态。
 */
export interface UnitSnapshot {
  id: number;
  typeId: UnitTypeId;
  /** 单位出生等级，供战场与调试视图展示。 */
  level: number;
  faction: Faction;
  state: UnitState;
  x: number;
  y: number;
  facingX: number;
  facingY: number;
  radius: number;
  /** 叠完 Buff 的攻击射程，供选中时画范围圈 */
  range: number;
  /** 占地边长（整数格）；0 表示普通单位 */
  footprint: number;
  hpRatio: number;
  /** 正在出手前摇，渲染层可以据此播放攻击动作 */
  attacking: boolean;
  /** 皇家骑士冲刺中，渲染层可以提高高亮 */
  charging: boolean;
  /** 受到国王振奋时，渲染层显示持续光环 */
  inspired: boolean;
  /** 正在施放技能（冲刺 / 治疗 / 召唤前摇），渲染层播放施法特效 */
  casting: boolean;
  /** 本帧刚吃到范围伤害，渲染层同步加强闪红与轻抖 */
  aoeHit: boolean;
}

export interface ProjectileSnapshot {
  id: number;
  faction: Faction;
  x: number;
  y: number;
  /** 离地高度，供渲染把弹道抬到发射点（如巨龙头） */
  height: number;
  /** 客户端弹道外观：彩色球、炸弹贴图或箭矢贴图 */
  visual: 'orb' | 'bomb' | 'arrow';
  /** 引信炸弹已落地，客户端显示闪烁。 */
  landed: boolean;
  /** 引信炸弹种类；客户端据此缩放弹体（巨型更大、小炸弹次之）。 */
  fuseBombKind: 'giant_bomb' | 'small_bomb' | null;
  /** 弹着点：引信炸弹/龙/战车为发射锁定点；追踪弹为当前瞄准点。 */
  impactX: number;
  impactY: number;
  /** 范围弹/炸弹爆炸半径；单体弹为 0。 */
  aoeRadius: number;
}

/** 女王单体治疗落在受疗单位上的反馈效果。 */
export interface HealEffectSnapshot {
  id: number;
  x: number;
  y: number;
  /** 受疗单位碰撞半径，供渲染缩放 */
  radius: number;
  progress: number;
}

/** 近战范围伤害 / 冲刺溅射的地面脉冲。 */
export interface AoePulseEffectSnapshot {
  id: number;
  kind: AoePulseKind;
  x: number;
  y: number;
  radius: number;
  dirX: number;
  dirY: number;
  progress: number;
}

/** 炸弹兵爆炸序列帧特效。 */
export interface ExplosionEffectSnapshot {
  id: number;
  x: number;
  y: number;
  radius: number;
  kind: 'normal' | 'giant_bomb' | 'explode2' | 'explode4' | 'blood3';
  progress: number;
}

export interface Snapshot {
  tick: number;
  units: UnitSnapshot[];
  projectiles: ProjectileSnapshot[];
  healEffects: HealEffectSnapshot[];
  aoePulseEffects: AoePulseEffectSnapshot[];
  explosionEffects: ExplosionEffectSnapshot[];
}

/**
 * 把当前世界写入只读快照。传入 out 时复用数组与元素槽位，供客户端双缓冲避免每 tick 全量 new。
 */
export function takeSnapshot(world: World, out?: Snapshot): Snapshot {
  const snap = out ?? emptySnapshot();
  snap.tick = world.tick;
  writeUnitSnapshots(world, snap.units);
  writeProjectileSnapshots(world, snap.projectiles);
  writeHealSnapshots(world, snap.healEffects);
  writeAoePulseSnapshots(world, snap.aoePulseEffects);
  writeExplosionSnapshots(world, snap.explosionEffects);
  return snap;
}

function writeUnitSnapshots(world: World, units: UnitSnapshot[]): void {
  let n = 0;
  for (const unit of world.units) {
    if (unit.dead) continue;
    const slot = units[n] ?? (units[n] = {} as UnitSnapshot);
    slot.id = unit.id;
    slot.typeId = unit.typeId;
    slot.level = unit.level;
    slot.faction = unit.faction;
    slot.state = unit.state;
    slot.x = toFloat(unit.pos.x);
    slot.y = toFloat(unit.pos.y);
    slot.facingX = toFloat(unit.facing.x);
    slot.facingY = toFloat(unit.facing.y);
    slot.radius = toFloat(unit.config.radius);
    slot.range = toFloat(unit.stats.range);
    slot.footprint = unit.config.footprint;
    slot.hpRatio = unit.stats.maxHp > 0 ? toFloat(unit.hp) / toFloat(unit.stats.maxHp) : 0;
    // 普攻与各类技能前摇共用同一套攻击蓄力姿势
    slot.attacking =
      unit.windupLeft > 0
      || unit.chargeWindupLeft > 0
      || unit.healWindupLeft > 0
      || unit.summonWindupLeft > 0
      || unit.detonateWindupLeft > 0;
    slot.charging = unit.state === UnitState.Charge && unit.chargeWindupLeft <= 0;
    slot.inspired = unit.inspired;
    // 冲刺前摇与英雄技能前摇共用同一施法表现通道（特效从前摇开始播）
    slot.casting = unit.chargeWindupLeft > 0 || unit.castFxLeft > 0 || unit.detonateWindupLeft > 0;
    slot.aoeHit = unit.aoeHitFxLeft > 0;
    n++;
  }
  units.length = n;
}

function writeProjectileSnapshots(world: World, projectiles: ProjectileSnapshot[]): void {
  let n = 0;
  for (const p of world.projectiles) {
    if (p.dead) continue;
    const slot = projectiles[n] ?? (projectiles[n] = {} as ProjectileSnapshot);
    slot.id = p.id;
    slot.faction = p.faction;
    slot.x = toFloat(p.pos.x);
    slot.y = toFloat(p.pos.y);
    slot.height = p.height;
    slot.visual = p.visual;
    slot.landed = p.landed;
    slot.fuseBombKind = p.fuseBombKind;
    slot.impactX = toFloat(p.impactPos.x);
    slot.impactY = toFloat(p.impactPos.y);
    slot.aoeRadius = toFloat(p.aoeRadius);
    n++;
  }
  projectiles.length = n;
}

function writeHealSnapshots(world: World, effects: HealEffectSnapshot[]): void {
  let n = 0;
  for (const effect of world.healEffects) {
    const slot = effects[n] ?? (effects[n] = {} as HealEffectSnapshot);
    slot.id = effect.id;
    slot.x = toFloat(effect.x);
    slot.y = toFloat(effect.y);
    slot.radius = toFloat(effect.radius);
    slot.progress = 1 - effect.remainingTicks / effect.totalTicks;
    n++;
  }
  effects.length = n;
}

function writeAoePulseSnapshots(world: World, effects: AoePulseEffectSnapshot[]): void {
  let n = 0;
  for (const effect of world.aoePulseEffects) {
    const slot = effects[n] ?? (effects[n] = {} as AoePulseEffectSnapshot);
    slot.id = effect.id;
    slot.kind = effect.kind;
    slot.x = toFloat(effect.x);
    slot.y = toFloat(effect.y);
    slot.radius = toFloat(effect.radius);
    slot.dirX = toFloat(effect.dirX);
    slot.dirY = toFloat(effect.dirY);
    slot.progress = 1 - effect.remainingTicks / effect.totalTicks;
    n++;
  }
  effects.length = n;
}

function writeExplosionSnapshots(world: World, effects: ExplosionEffectSnapshot[]): void {
  let n = 0;
  for (const effect of world.explosionEffects) {
    const slot = effects[n] ?? (effects[n] = {} as ExplosionEffectSnapshot);
    slot.id = effect.id;
    slot.x = toFloat(effect.x);
    slot.y = toFloat(effect.y);
    slot.radius = toFloat(effect.radius);
    slot.kind = effect.kind;
    slot.progress = 1 - effect.remainingTicks / effect.totalTicks;
    n++;
  }
  effects.length = n;
}

/** 空快照，供渲染层在第一帧之前占位 */
export function emptySnapshot(): Snapshot {
  return {
    tick: 0,
    units: [],
    projectiles: [],
    healEffects: [],
    aoePulseEffects: [],
    explosionEffects: [],
  };
}
