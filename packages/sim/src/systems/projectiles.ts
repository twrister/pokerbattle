import { type Fx, div, fromFloat, max, mul, toFloat } from '../math/fixed.js';
import { distSq, lengthOf } from '../math/vec2.js';
import { TICK_RATE_FX } from '../config/tuning.js';
import { isBuildingConfig } from '../config/units.js';
import type { ExplosionEffect } from '../entity/effect.js';
import { isAlive, type Faction, type Unit } from '../entity/unit.js';
import type { Projectile } from '../entity/projectile.js';
import type { World } from '../world.js';
import { distSqToBuildingFootprint } from './combatRange.js';

/** 单体弹道命中爆炸的最小可视半径，避免目标碰撞圈过小看不清。 */
const MIN_SINGLE_IMPACT_RADIUS = fromFloat(0.8);

/**
 * 弓箭/女王等弹道命中爆炸序列帧总开关。
 * false 时不生成 explode2/4 命中特效；explode1（战车/龙/小炸弹）与巨型炸弹、死亡、自爆不受影响。
 */
const PROJECTILE_EXPLOSION_FX_ENABLED = false;

/**
 * 将弹道落地反馈映射为爆炸序列帧 kind；脉冲或不启用时返回 null。
 * explosion 固定走 explode1；Explode2/4 打在非建筑上统一改 Blood3，打建筑仍用原爆炸帧。
 */
function explosionKindFromImpact(
  impactFx: Projectile['impactFx'],
  hitBuilding: boolean,
): ExplosionEffect['kind'] | null {
  if (impactFx === 'explosion') return 'normal';
  if (!PROJECTILE_EXPLOSION_FX_ENABLED) return null;
  if (impactFx === 'explode2' || impactFx === 'explode4') {
    return hitBuilding ? impactFx : 'blood3';
  }
  return null;
}


/** 复用范围弹查询结果，避免爆炸时创建临时数组。 */
const neighbors: number[] = [];

/**
 * 弹道推进。
 *
 * 追踪弹（homing）必中：目标存活就每帧更新落点并飞过去。
 * 非追踪弹（龙/战车）落点在发射时锁定，目标走开则打空。
 */
export function updateProjectiles(world: World): void {
  for (const projectile of world.projectiles) {
    if (projectile.dead) continue;

    const target = world.getUnit(projectile.targetId);
    if (!projectile.fuseBombKind && projectile.homing && isAlive(target)) {
      // 仅追踪弹每帧把落点同步到目标当前位置
      projectile.impactPos.x = target.pos.x;
      projectile.impactPos.y = target.pos.y;
      projectile.targetRadius = target.config.radius;
    } else if (projectile.homing && projectile.aoeRadius <= 0 && !isAlive(target)) {
      // 追踪单体：目标途中死亡后直接消失，不转火。
      projectile.dead = true;
      continue;
    }

    const step: Fx = div(projectile.speed, TICK_RATE_FX);
    const dx = projectile.impactPos.x - projectile.pos.x;
    const dy = projectile.impactPos.y - projectile.pos.y;
    const gap = lengthOf(dx, dy);

    // 这一帧能飞进目标的碰撞圈就算命中，避免高速弹穿过目标
    if (gap <= step + projectile.targetRadius) {
      projectile.height = projectile.endHeight;
      if (projectile.fuseBombKind) {
        // 大小炸弹落地即爆，不再等待 attackInterval 引信
        resolveFuseBomb(world, projectile);
        projectile.dead = true;
        continue;
      }
      // 主目标是否建筑决定 Explode↔Blood；目标已死时按配置足迹判断
      const hitBuilding = !!target && isBuildingConfig(target.config);
      if (projectile.aoeRadius > 0) {
        resolveProjectileAoe(
          world,
          projectile.impactPos.x,
          projectile.impactPos.y,
          projectile.aoeRadius,
          projectile.damage,
          projectile.faction,
          projectile.impactFx,
          hitBuilding,
        );
      } else {
        resolveSingleImpact(world, projectile, target, hitBuilding);
      }
      projectile.dead = true;
      continue;
    }

    projectile.pos.x += mul(div(dx, gap), step);
    projectile.pos.y += mul(div(dy, gap), step);
    // 按剩余水平距离插值高度：打地面时从出生高度落到 0
    updateProjectileHeight(projectile, gap - step);
  }
}

/**
 * 单体弹落地：追踪弹按 targetId 直伤；非追踪弹仅当目标仍在锁定点碰撞圈内才命中。
 * miss 时仍在落点播爆炸（龙打空视觉落地）。
 */
function resolveSingleImpact(
  world: World,
  projectile: Projectile,
  target: Unit | undefined,
  hitBuilding: boolean,
): void {
  const inLockRadius =
    isAlive(target) &&
    distSq(projectile.impactPos.x, projectile.impactPos.y, target.pos.x, target.pos.y)
      <= mul(projectile.targetRadius, projectile.targetRadius);
  const hits = projectile.homing ? !!target : inLockRadius;
  if (hits && target) target.hp -= projectile.damage;
  // 追踪弹仅在打到目标时播特效；非追踪弹无论命中都在锁定点落地
  if (!hits && projectile.homing) return;
  const kind = explosionKindFromImpact(projectile.impactFx, hitBuilding);
  if (kind) {
    world.spawnExplosionEffect(
      projectile.impactPos.x,
      projectile.impactPos.y,
      max(projectile.targetRadius, MIN_SINGLE_IMPACT_RADIUS),
      kind,
    );
  }
}

/** 引信炸弹落地当帧对半径内敌军单位和建筑造成伤害（不伤己方）。 */
function resolveFuseBomb(world: World, projectile: Projectile): void {
  const radiusSq = mul(projectile.aoeRadius, projectile.aoeRadius);
  for (const unit of world.units) {
    if (!isAlive(unit) || unit.faction === projectile.faction) continue;
    const inside = isBuildingConfig(unit.config)
      ? distSqToBuildingFootprint(projectile.impactPos.x, projectile.impactPos.y, unit) <= radiusSq
      : distSq(projectile.impactPos.x, projectile.impactPos.y, unit.pos.x, unit.pos.y) <= radiusSq;
    if (!inside) continue;
    unit.hp -= projectile.damage;
    unit.aoeHitFxLeft = 2;
  }
  // 巨型炸弹用专用大爆炸帧；小炸弹复用普通爆炸序列，不走弹道命中特效开关
  const kind = projectile.fuseBombKind === 'giant_bomb' ? 'giant_bomb' : 'normal';
  world.spawnExplosionEffect(
    projectile.impactPos.x,
    projectile.impactPos.y,
    projectile.aoeRadius,
    kind,
  );
}

/**
 * 用发射时总距与当前剩余距换算进度，把渲染高度从起点插到落点。
 * arcApex>0 时再叠加 4·apex·t·(1-t)，形成中点最高的抛物线。
 */
function updateProjectileHeight(projectile: Projectile, remaining: Fx): void {
  const startDist = toFloat(projectile.startDist);
  if (startDist <= 0) {
    projectile.height = projectile.endHeight;
    return;
  }
  const left = Math.max(0, toFloat(remaining));
  const t = Math.min(1, Math.max(0, 1 - left / startDist));
  const base = projectile.startHeight + (projectile.endHeight - projectile.startHeight) * t;
  const arc = projectile.arcApex > 0 ? 4 * projectile.arcApex * t * (1 - t) : 0;
  projectile.height = base + arc;
}

/**
 * 在弹着点按单位中心结算敌方范围伤害，并按弹道配置播放地面反馈。
 * 不额外处理主目标，因此主目标只会作为范围内单位受伤一次。
 */
function resolveProjectileAoe(
  world: World,
  x: Fx,
  y: Fx,
  radius: Fx,
  damage: Fx,
  faction: Faction,
  impactFx: Projectile['impactFx'],
  hitBuilding: boolean,
): void {
  world.unitGrid.clear();
  for (let i = 0; i < world.units.length; i++) {
    const unit = world.units[i]!;
    if (!isAlive(unit)) continue;
    world.unitGrid.insert(i, unit.pos.x, unit.pos.y);
  }
  world.unitGrid.query(x, y, radius, neighbors);

  const radiusSq = mul(radius, radius);
  for (let i = 0; i < neighbors.length; i++) {
    const unit = world.units[neighbors[i]!]!;
    if (!isAlive(unit) || unit.faction === faction) continue;
    // 落地爆炸只伤地面单位，空中单位需被直接锁定才吃单体弹
    if (unit.config.movementLayer === 'air') continue;
    if (distSq(x, y, unit.pos.x, unit.pos.y) > radiusSq) continue;
    unit.hp -= damage;
    unit.aoeHitFxLeft = 2;
  }
  // 仅 pulse 播地面环；爆炸类在关闭开关或无映射时不回退成脉冲
  if (impactFx === 'pulse') {
    world.spawnAoePulse('melee_ring', x, y, radius);
    return;
  }
  const kind = explosionKindFromImpact(impactFx, hitBuilding);
  if (kind) {
    world.spawnExplosionEffect(x, y, radius, kind);
  }
}
