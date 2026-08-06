import { ONE, mul } from '../math/fixed.js';
import { distSq } from '../math/vec2.js';
import { ATTACK_RANGE_TOLERANCE } from '../config/tuning.js';
import { type Unit, UnitState, isAlive } from '../entity/unit.js';
import type { World } from '../world.js';

/**
 * 攻击节奏：冷却到期 -> 起手前摇 -> 结算伤害。
 *
 * 冷却和前摇并行倒计时（而不是前摇结束才开始转冷却），
 * 这样一轮完整攻击恰好等于 attackInterval，DPS 才等于 damage / interval。
 */
export function updateCombat(world: World): void {
  for (const unit of world.units) {
    if (unit.dead) continue;

    if (unit.attackCooldown > 0) unit.attackCooldown -= ONE;

    if (unit.windupLeft > 0) {
      unit.windupLeft -= ONE;
      if (unit.windupLeft <= 0) {
        unit.windupLeft = 0;
        resolveAttack(world, unit);
      }
      continue;
    }

    if (unit.state !== UnitState.Attack) continue;
    if (unit.attackCooldown > 0) continue;

    unit.attackCooldown = unit.stats.attackInterval;
    unit.windupLeft = unit.stats.attackWindup;
    // 前摇配成 0 的兵种当帧直接出伤害
    if (unit.windupLeft <= 0) resolveAttack(world, unit);
  }
}

/**
 * 前摇走完后的结算。目标可能在这几帧里死了或跑了，
 * 这时这一击就是落空——已经付出的冷却不退，这也是前摇存在的博弈意义。
 */
function resolveAttack(world: World, unit: Unit): void {
  const target = world.getUnit(unit.targetId);
  if (!isAlive(target)) return;

  const reach =
    unit.stats.range + unit.config.radius + target.config.radius + ATTACK_RANGE_TOLERANCE;
  if (distSq(unit.pos.x, unit.pos.y, target.pos.x, target.pos.y) > mul(reach, reach)) return;

  const attack = unit.config.attack;
  if (attack.kind === 'melee') {
    target.hp -= unit.stats.damage;
    return;
  }
  world.spawnProjectile(unit, target.id, unit.stats.damage, attack.speed);
}
