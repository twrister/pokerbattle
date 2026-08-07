import { ONE, mul } from '../math/fixed.js';
import { distSq } from '../math/vec2.js';
import { MAX_UNIT_RADIUS } from '../config/units.js';
import { ATTACK_RANGE_TOLERANCE } from '../config/tuning.js';
import { type Unit, UnitState, isAlive } from '../entity/unit.js';
import type { World } from '../world.js';

/** 复用邻居缓冲，避免每帧分配 */
const neighbors: number[] = [];

/**
 * 攻击节奏：冷却到期 -> 起手前摇 -> 结算伤害。
 *
 * 冷却和前摇并行倒计时（而不是前摇结束才开始转冷却），
 * 这样一轮完整攻击恰好等于 attackInterval，DPS 才等于 damage / interval。
 */
export function updateCombat(world: World): void {
  for (const unit of world.units) {
    if (unit.dead) continue;
    // 冲刺中不普攻，冷却仍照常走，避免落地瞬间连砍
    if (unit.state === UnitState.Charge) {
      if (unit.attackCooldown > 0) unit.attackCooldown -= ONE;
      continue;
    }
    // 治疗施法前摇期间不普攻，避免与技能前摇抢动作
    if (unit.healWindupLeft > 0) {
      if (unit.attackCooldown > 0) unit.attackCooldown -= ONE;
      continue;
    }

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
  const attack = unit.config.attack;

  if (attack.kind === 'melee_aoe') {
    resolveMeleeAoe(world, unit);
    return;
  }

  const target = world.getUnit(unit.targetId);
  if (!isAlive(target)) return;

  const reach =
    unit.stats.range + unit.config.radius + target.config.radius + ATTACK_RANGE_TOLERANCE;
  if (distSq(unit.pos.x, unit.pos.y, target.pos.x, target.pos.y) > mul(reach, reach)) return;

  if (attack.kind === 'melee') {
    target.hp -= unit.stats.damage;
    return;
  }
  world.spawnProjectile(unit, target.id, unit.stats.damage, attack.speed);
}

/**
 * 近战范围攻击：攻击范围内所有敌方都吃到普攻伤害。
 * 主目标若不在射程内则整次落空（与单体近战一致）。
 */
function resolveMeleeAoe(world: World, unit: Unit): void {
  const target = world.getUnit(unit.targetId);
  if (!isAlive(target)) return;

  const primaryReach =
    unit.stats.range + unit.config.radius + target.config.radius + ATTACK_RANGE_TOLERANCE;
  if (distSq(unit.pos.x, unit.pos.y, target.pos.x, target.pos.y) > mul(primaryReach, primaryReach)) {
    return;
  }

  // 查询半径取「自身射程 + 双方最大半径 + 容差」，再按每个敌人各自 reach 过滤
  const queryRadius =
    unit.stats.range + unit.config.radius + MAX_UNIT_RADIUS + ATTACK_RANGE_TOLERANCE;
  world.unitGrid.clear();
  for (let i = 0; i < world.units.length; i++) {
    const u = world.units[i]!;
    if (u.dead) continue;
    world.unitGrid.insert(i, u.pos.x, u.pos.y);
  }
  world.unitGrid.query(unit.pos.x, unit.pos.y, queryRadius, neighbors);

  let hitAny = false;
  for (let k = 0; k < neighbors.length; k++) {
    const other = world.units[neighbors[k]!]!;
    if (!isAlive(other)) continue;
    if (other.faction === unit.faction) continue;
    if (other.id === unit.id) continue;

    const reach =
      unit.stats.range + unit.config.radius + other.config.radius + ATTACK_RANGE_TOLERANCE;
    if (distSq(unit.pos.x, unit.pos.y, other.pos.x, other.pos.y) > mul(reach, reach)) continue;

    other.hp -= unit.stats.damage;
    // 标记范围受击，渲染层据此同步加强闪红
    other.aoeHitFxLeft = 2;
    hitAny = true;
  }

  if (hitAny) {
    // 地面环取自身攻击包络（不含对方半径），一眼可读「砍一圈」
    const pulseRadius = unit.stats.range + unit.config.radius + ATTACK_RANGE_TOLERANCE;
    world.spawnAoePulse('melee_ring', unit.pos.x, unit.pos.y, pulseRadius);
  }
}
