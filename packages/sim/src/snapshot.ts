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
  /** 巨型炸弹已落地引信中，客户端显示闪烁。 */
  landed: boolean;
  /** 巨型炸弹使用更大的弹体比例。 */
  giantBomb: boolean;
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
  kind: 'normal' | 'giant_bomb';
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

export function takeSnapshot(world: World): Snapshot {
  const units: UnitSnapshot[] = [];
  for (const unit of world.units) {
    if (unit.dead) continue;
    units.push({
      id: unit.id,
      typeId: unit.typeId,
      level: unit.level,
      faction: unit.faction,
      state: unit.state,
      x: toFloat(unit.pos.x),
      y: toFloat(unit.pos.y),
      facingX: toFloat(unit.facing.x),
      facingY: toFloat(unit.facing.y),
      radius: toFloat(unit.config.radius),
      footprint: unit.config.footprint,
      hpRatio: unit.stats.maxHp > 0 ? toFloat(unit.hp) / toFloat(unit.stats.maxHp) : 0,
      // 普攻与各类技能前摇共用同一套攻击蓄力姿势
      attacking:
        unit.windupLeft > 0
        || unit.chargeWindupLeft > 0
        || unit.healWindupLeft > 0
        || unit.summonWindupLeft > 0
        || unit.detonateWindupLeft > 0,
      charging: unit.state === UnitState.Charge && unit.chargeWindupLeft <= 0,
      inspired: unit.buffs.some((buff) => buff.id === -buff.sourceId && buff.stat === 'moveSpeed'),
      // 冲刺前摇与英雄技能前摇共用同一施法表现通道（特效从前摇开始播）
      casting: unit.chargeWindupLeft > 0 || unit.castFxLeft > 0 || unit.detonateWindupLeft > 0,
      aoeHit: unit.aoeHitFxLeft > 0,
    });
  }

  const projectiles: ProjectileSnapshot[] = [];
  for (const p of world.projectiles) {
    if (p.dead) continue;
    projectiles.push({
      id: p.id,
      faction: p.faction,
      x: toFloat(p.pos.x),
      y: toFloat(p.pos.y),
      height: p.height,
      visual: p.visual,
      landed: p.landed,
      giantBomb: p.giantBomb,
    });
  }

  const healEffects: HealEffectSnapshot[] = [];
  for (const effect of world.healEffects) {
    healEffects.push({
      id: effect.id,
      x: toFloat(effect.x),
      y: toFloat(effect.y),
      radius: toFloat(effect.radius),
      progress: 1 - effect.remainingTicks / effect.totalTicks,
    });
  }

  const aoePulseEffects: AoePulseEffectSnapshot[] = [];
  for (const effect of world.aoePulseEffects) {
    aoePulseEffects.push({
      id: effect.id,
      kind: effect.kind,
      x: toFloat(effect.x),
      y: toFloat(effect.y),
      radius: toFloat(effect.radius),
      dirX: toFloat(effect.dirX),
      dirY: toFloat(effect.dirY),
      progress: 1 - effect.remainingTicks / effect.totalTicks,
    });
  }

  const explosionEffects: ExplosionEffectSnapshot[] = [];
  for (const effect of world.explosionEffects) {
    explosionEffects.push({
      id: effect.id,
      x: toFloat(effect.x),
      y: toFloat(effect.y),
      radius: toFloat(effect.radius),
      kind: effect.kind,
      progress: 1 - effect.remainingTicks / effect.totalTicks,
    });
  }

  return { tick: world.tick, units, projectiles, healEffects, aoePulseEffects, explosionEffects };
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
