import { mul } from '../math/fixed.js';
import { distSq } from '../math/vec2.js';
import type { GroundHazard } from '../entity/groundHazard.js';
import { applyCombatDamage, isAlive } from '../entity/unit.js';
import type { World } from '../world.js';

/** 复用范围查询结果，避免每跳灼烧创建临时数组。 */
const neighbors: number[] = [];

/**
 * 推进地面燃烧区：先扣间隔再结算，落地当帧不伤（避免与爆炸伤叠在同一帧）。
 * 持续 40 / 间隔 10 时，在第 10/20/30/40 tick 各跳一次。
 */
export function updateGroundHazards(world: World): void {
  if (world.groundHazards.length === 0) return;
  world.ensureUnitGrid();
  for (let i = world.groundHazards.length - 1; i >= 0; i--) {
    const hazard = world.groundHazards[i]!;
    hazard.ticksUntilNextDamage--;
    hazard.remainingTicks--;
    if (hazard.ticksUntilNextDamage <= 0) {
      resolveGroundBurn(world, hazard);
      hazard.ticksUntilNextDamage = hazard.intervalTicks;
    }
    if (hazard.remainingTicks <= 0) world.groundHazards.splice(i, 1);
  }
}

/** 对燃烧半径内敌方地面单位造成一次范围伤害；空中单位免疫。 */
function resolveGroundBurn(world: World, hazard: GroundHazard): void {
  world.unitGrid.query(hazard.x, hazard.y, hazard.radius, neighbors);
  const radiusSq = mul(hazard.radius, hazard.radius);
  for (let i = 0; i < neighbors.length; i++) {
    const unit = world.units[neighbors[i]!]!;
    if (!isAlive(unit) || unit.faction === hazard.faction) continue;
    if (unit.config.movementLayer === 'air') continue;
    if (distSq(hazard.x, hazard.y, unit.pos.x, unit.pos.y) > radiusSq) continue;
    applyCombatDamage(unit, hazard.damage, true);
  }
}
