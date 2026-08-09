import { type Fx, div, mul, toFloat } from '../math/fixed.js';
import { distSq, lengthOf } from '../math/vec2.js';
import { TICK_RATE_FX } from '../config/tuning.js';
import { isAlive, type Faction } from '../entity/unit.js';
import type { Projectile } from '../entity/projectile.js';
import type { World } from '../world.js';

/** 复用范围弹查询结果，避免爆炸时创建临时数组。 */
const neighbors: number[] = [];

/**
 * 追踪弹推进。
 *
 * MVP 里弹道必中：只要目标还活着就一路追过去，飞到就结算。
 * 之后要做可闪避的直线弹，只需把「每帧重新朝目标」改成发射时固定方向。
 */
export function updateProjectiles(world: World): void {
  for (const projectile of world.projectiles) {
    if (projectile.dead) continue;

    const target = world.getUnit(projectile.targetId);
    if (isAlive(target)) {
      projectile.impactPos.x = target.pos.x;
      projectile.impactPos.y = target.pos.y;
      projectile.targetRadius = target.config.radius;
    } else if (projectile.aoeRadius <= 0) {
      // 普通追踪弹保持原行为：目标途中死亡后直接消失，不转火。
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
      if (projectile.aoeRadius > 0) {
        resolveProjectileAoe(
          world,
          projectile.impactPos.x,
          projectile.impactPos.y,
          projectile.aoeRadius,
          projectile.damage,
          projectile.faction,
        );
      } else if (target) {
        target.hp -= projectile.damage;
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

/** 用发射时总距与当前剩余距换算进度，把渲染高度从起点插到落点。 */
function updateProjectileHeight(projectile: Projectile, remaining: Fx): void {
  const startDist = toFloat(projectile.startDist);
  if (startDist <= 0) {
    projectile.height = projectile.endHeight;
    return;
  }
  const left = Math.max(0, toFloat(remaining));
  const t = Math.min(1, Math.max(0, 1 - left / startDist));
  projectile.height =
    projectile.startHeight + (projectile.endHeight - projectile.startHeight) * t;
}

/**
 * 在弹着点按单位中心结算敌方范围伤害，并生成与近战范围一致的地面反馈。
 * 不额外处理主目标，因此主目标只会作为范围内单位受伤一次。
 */
function resolveProjectileAoe(
  world: World,
  x: Fx,
  y: Fx,
  radius: Fx,
  damage: Fx,
  faction: Faction,
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
  world.spawnAoePulse('melee_ring', x, y, radius);
}
