import { fromFloat, max } from '../math/fixed.js';
import type { World } from '../world.js';

/** 死亡 Explode4 的最小可视半径，避免小碰撞圈单位特效过小。 */
const MIN_DEATH_FX_RADIUS = fromFloat(0.8);

/** 结算死亡并把尸体移出实体列表。放在流水线最后，保证本 tick 内所有系统看到的是同一批单位。 */
export function cleanup(world: World): void {
  let unitDied = false;
  for (const unit of world.units) {
    if (unit.dead || unit.hp > 0) continue;
    unit.hp = 0;
    unit.dead = true;
    unitDied = true;
    // 炸弹兵自爆已播过爆炸序列，避免同帧再叠一层死亡特效
    if (!unit.detonated) {
      world.spawnExplosionEffect(
        unit.pos.x,
        unit.pos.y,
        max(unit.config.radius, MIN_DEATH_FX_RADIUS),
        'explode4',
      );
    }
  }

  let projectileEnded = false;
  for (const projectile of world.projectiles) {
    if (projectile.dead) projectileEnded = true;
  }

  if (unitDied) world.removeDeadUnits();
  if (projectileEnded) world.removeDeadProjectiles();
}
