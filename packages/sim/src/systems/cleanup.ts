import type { World } from '../world.js';

/** 结算死亡并把尸体移出实体列表。放在流水线最后，保证本 tick 内所有系统看到的是同一批单位。 */
export function cleanup(world: World): void {
  let unitDied = false;
  for (const unit of world.units) {
    if (unit.dead || unit.hp > 0) continue;
    unit.hp = 0;
    unit.dead = true;
    unitDied = true;
  }

  let projectileEnded = false;
  for (const projectile of world.projectiles) {
    if (projectile.dead) projectileEnded = true;
  }

  if (unitDied) world.removeDeadUnits();
  if (projectileEnded) world.removeDeadProjectiles();
}
