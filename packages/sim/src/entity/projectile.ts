import type { Fx } from '../math/fixed.js';
import { type Vec2, vec } from '../math/vec2.js';
import type { Faction } from './unit.js';

/** 弹道落地反馈：地面环脉冲、普通爆炸或弹道 Explode2/4 序列帧 */
export type ProjectileImpactFx = 'pulse' | 'explosion' | 'explode2' | 'explode4';

/** 客户端弹道外观：彩色球、炸弹贴图或箭矢贴图 */
export type ProjectileVisual = 'orb' | 'bomb' | 'arrow';

/** 弹道落地后铺燃烧区的载荷；缺省表示不留火。 */
export interface ProjectileGroundBurn {
  durationTicks: number;
  intervalTicks: number;
  damage: Fx;
}

/**
 * 远程单位发射的弹道。
 * homing 为 true 时是必中追踪弹：目标存活就每帧飞向它。
 * homing 为 false（龙/战车）时落点在发射瞬间锁定，飞行中不再跟随。
 * 抛物线通过 arcApex 叠加二次高度；溅射由 aoeRadius 驱动。
 */
export interface Projectile {
  readonly id: number;
  readonly faction: Faction;
  pos: Vec2;
  targetId: number;
  /**
   * 弹着点。追踪弹跟随目标；非追踪弹/范围弹在发射时锁定，目标死亡后仍飞向这里。
   */
  impactPos: Vec2;
  /** 命中判定沿用发射时目标碰撞圈，目标移除后也能稳定落地。 */
  targetRadius: Fx;
  damage: Fx;
  /** 大于 0 时不造成单体直伤，改为在 impactPos 结算范围伤害。 */
  aoeRadius: Fx;
  /** 当前渲染离地高度，飞行中在 start/end 之间插值（可叠加抛物线）。 */
  height: number;
  /** 发射点高度（如巨龙头 2.5）。 */
  startHeight: number;
  /** 目标点高度：地面单位为 0，空中单位与出生高度对齐。 */
  endHeight: number;
  /** 发射瞬间到目标的水平距离，用于高度插值进度。 */
  startDist: Fx;
  /**
   * 抛物线额外顶点高度（场景单位）。
   * 0 = 纯线性起终点插值；>0 时在中点再抬高 4·apex·t·(1-t)。
   */
  arcApex: number;
  /** 落点范围伤时的地面反馈种类 */
  impactFx: ProjectileImpactFx;
  /** 客户端弹道外观 */
  visual: ProjectileVisual;
  /** 飞行速度，单位/秒 */
  speed: Fx;
  /**
   * 历史落地引信剩余帧；大小炸弹改为落地即爆后保持 0。
   */
  fuseTicks: number;
  /** 已抵达固定落点；落地即爆时不会置为 true。 */
  landed: boolean;
  /**
   * 主堡投放的引信炸弹种类；非 null 时固定落点、不追踪单位，
   * 落地当帧引爆并结算仅伤敌军的 AOE。
   */
  fuseBombKind: 'giant_bomb' | 'small_bomb' | null;
  /**
   * 是否每帧把落点同步到目标。
   * false 时（龙/战车）发射瞬间锁定 impactPos，目标可走开打空。
   */
  homing: boolean;
  /** 落地后在 impactPos 生成燃烧区；打空中目标时为 null。 */
  groundBurn: ProjectileGroundBurn | null;
  /** 发射席位；2v2 用来把延迟命中记到出兵者，而不是只认阵营。 */
  readonly ownerSlot: number;
  dead: boolean;
}

export function createProjectile(
  id: number,
  faction: Faction,
  x: Fx,
  y: Fx,
  targetId: number,
  targetX: Fx,
  targetY: Fx,
  targetRadius: Fx,
  damage: Fx,
  speed: Fx,
  aoeRadius: Fx,
  startHeight: number,
  endHeight: number,
  startDist: Fx,
  arcApex: number = 0,
  impactFx: ProjectileImpactFx = 'pulse',
  visual: ProjectileVisual = 'orb',
  fuseBombKind: 'giant_bomb' | 'small_bomb' | null = null,
  homing = true,
  groundBurn: ProjectileGroundBurn | null = null,
  ownerSlot: number = faction,
): Projectile {
  return {
    id,
    faction,
    pos: vec(x, y),
    targetId,
    impactPos: vec(targetX, targetY),
    targetRadius,
    damage,
    aoeRadius,
    height: startHeight,
    startHeight,
    endHeight,
    startDist,
    arcApex,
    impactFx,
    visual,
    speed,
    fuseTicks: 0,
    landed: false,
    fuseBombKind,
    homing,
    groundBurn,
    ownerSlot,
    dead: false,
  };
}
