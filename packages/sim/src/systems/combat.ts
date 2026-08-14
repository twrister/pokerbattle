import { ONE } from '../math/fixed.js';
import { MAX_UNIT_RADIUS, canBuildingAttack, isBuildingConfig } from '../config/units.js';
import { ATTACK_RANGE_TOLERANCE } from '../config/tuning.js';
import { type Unit, UnitState, isAlive } from '../entity/unit.js';
import type { World } from '../world.js';
import {
  canAttackTarget,
  isInAttackRangeBand,
  isOutsideMinAttackRange,
  isWithinAttackReach,
} from './combatRange.js';

/** 复用邻居缓冲，避免每帧分配 */
const neighbors: number[] = [];

/**
 * 攻击节奏：冷却到期 -> 起手前摇 -> 结算伤害。
 *
 * 冷却和前摇并行倒计时（而不是前摇结束才开始转冷却），
 * 这样一轮完整攻击恰好等于 attackInterval，DPS 才等于 damage / interval。
 */
export function updateCombat(world: World): void {
  world.ensureUnitGrid();
  for (const unit of world.units) {
    if (unit.dead) continue;
    // 无攻击能力的建筑跳过；基地/防御塔等走下方普攻节奏
    if (isBuildingConfig(unit.config) && !canBuildingAttack(unit.config)) continue;
    // 炸弹兵只走自爆系统，不走普攻前摇
    if (unit.config.detonate) continue;
    // 冲刺中不普攻，冷却仍照常走，避免落地瞬间连砍
    if (unit.state === UnitState.Charge) {
      if (unit.attackCooldown > 0) unit.attackCooldown -= ONE;
      continue;
    }
    // 英雄技能前摇期间不普攻，避免与技能动作和结算重叠
    if (unit.healWindupLeft > 0 || unit.summonWindupLeft > 0) {
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

    // 贴进最小射程时不起手，避免战车等空转冷却；最大射程仍在结算时校验（保持旧节奏）
    const windupTarget = world.getUnit(unit.targetId);
    if (!isAlive(windupTarget) || !canAttackTarget(unit, windupTarget)) continue;
    if (!isOutsideMinAttackRange(unit, windupTarget)) continue;

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
  // 近战够不着飞行单位，前摇打空但不退冷却
  if (!canAttackTarget(unit, target)) return;

  // 最大射程可带出手容差；最小射程贴身则整击落空
  if (!isInAttackRangeBand(unit, target, ATTACK_RANGE_TOLERANCE)) return;

  if (attack.kind === 'melee') {
    target.hp -= unit.stats.damage;
    return;
  }
  // 对空只打单体：范围弹道打到空中目标时关掉落地爆炸
  let aoeRadius = attack.kind === 'projectile_aoe' ? attack.aoeRadius : 0;
  if (aoeRadius > 0 && target.config.movementLayer === 'air') aoeRadius = 0;
  world.spawnProjectile(unit, target, unit.stats.damage, attack.speed, aoeRadius);
}

/**
 * 近战范围攻击：攻击范围内所有敌方都吃到普攻伤害。
 * 主目标若不在射程内则整次落空（与单体近战一致）。
 */
function resolveMeleeAoe(world: World, unit: Unit): void {
  const target = world.getUnit(unit.targetId);
  if (!isAlive(target)) return;
  // 主目标在空中则整次近战范围落空
  if (!canAttackTarget(unit, target)) return;

  if (!isWithinAttackReach(unit, target, ATTACK_RANGE_TOLERANCE)) return;

  // 查询半径取「自身射程 + 双方最大半径 + 容差」，再按每个敌人各自 reach 过滤
  const queryRadius =
    unit.stats.range + unit.config.radius + MAX_UNIT_RADIUS + ATTACK_RANGE_TOLERANCE;
  world.unitGrid.query(unit.pos.x, unit.pos.y, queryRadius, neighbors);

  let hitAny = false;
  for (let k = 0; k < neighbors.length; k++) {
    const other = world.units[neighbors[k]!]!;
    if (!isAlive(other)) continue;
    if (other.faction === unit.faction) continue;
    if (other.id === unit.id) continue;
    // 近战范围砍不到飞行单位
    if (!canAttackTarget(unit, other)) continue;

    if (!isWithinAttackReach(unit, other, ATTACK_RANGE_TOLERANCE)) continue;

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
