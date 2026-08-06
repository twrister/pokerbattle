import { type Fx, div, mul } from '../math/fixed.js';
import { lengthOf } from '../math/vec2.js';
import { TICK_RATE_FX } from '../config/tuning.js';
import { isAlive } from '../entity/unit.js';
import type { World } from '../world.js';

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
    // 目标在飞行途中就死了，这一发直接消失，不转火也不伤害别人
    if (!isAlive(target)) {
      projectile.dead = true;
      continue;
    }

    const step: Fx = div(projectile.speed, TICK_RATE_FX);
    const dx = target.pos.x - projectile.pos.x;
    const dy = target.pos.y - projectile.pos.y;
    const gap = lengthOf(dx, dy);

    // 这一帧能飞进目标的碰撞圈就算命中，避免高速弹穿过目标
    if (gap <= step + target.config.radius) {
      target.hp -= projectile.damage;
      projectile.dead = true;
      continue;
    }

    projectile.pos.x += mul(div(dx, gap), step);
    projectile.pos.y += mul(div(dy, gap), step);
  }
}
