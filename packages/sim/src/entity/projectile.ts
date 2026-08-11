import type { Fx } from '../math/fixed.js';
import { type Vec2, vec } from '../math/vec2.js';
import type { Faction } from './unit.js';

/** 弹道落地反馈：地面环脉冲或炸弹爆炸序列帧 */
export type ProjectileImpactFx = 'pulse' | 'explosion';

/** 客户端弹道外观：彩色球、炸弹贴图或箭矢贴图 */
export type ProjectileVisual = 'orb' | 'bomb' | 'arrow';

/**
 * 远程单位发射的追踪弹。
 * MVP 里是「必中」的追踪弹：只要目标还活着就一直飞向它，飞到就结算伤害。
 * 抛物线通过 arcApex 叠加二次高度；溅射由 aoeRadius 驱动。
 */
export interface Projectile {
  readonly id: number;
  readonly faction: Faction;
  pos: Vec2;
  targetId: number;
  /** 目标最后一次有效位置；范围弹在目标提前死亡后仍飞向这里。 */
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
  /** 巨型炸弹落地后等待引爆的剩余逻辑帧；0 表示仍在飞行或无需引信。 */
  fuseTicks: number;
  /** 已抵达固定落点，渲染层据此显示落地闪烁。 */
  landed: boolean;
  /** 巨型炸弹固定落点弹道，不追踪单位目标。 */
  giantBomb: boolean;
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
  giantBomb: boolean = false,
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
    giantBomb,
    dead: false,
  };
}
