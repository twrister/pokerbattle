import { type Fx, ONE, div, mul } from '../math/fixed.js';
import { distSq, lengthOf, normalize, set, vec } from '../math/vec2.js';
import { ARENA_HEIGHT, ARENA_WIDTH, clampToArena } from '../config/arena.js';
import { MAX_UNIT_RADIUS, isBuildingConfig } from '../config/units.js';
import { TICK_RATE_FX } from '../config/tuning.js';
import { type Unit, UnitState, applyCombatDamage, isAlive } from '../entity/unit.js';
import type { World } from '../world.js';
import { evictUnitFromRiver, isGroundBlockedAt } from '../nav/riverEvict.js';
import { isUntargetableBomb } from './combatRange.js';

/** 复用邻居缓冲，避免每帧分配 */
const neighbors: number[] = [];
const lateral = vec();

/**
 * 皇家骑士冲刺：冷却倒计时、原地前摇、直线位移、接触后前方 AOE 击退伤害。
 *
 * 放在普通移动之后、软碰撞之前：冲刺者不被推挤，被击退者本帧仍可参与分离。
 */
export function updateCharge(world: World): void {
  // 冲刺位移会改坐标，命中查询前重建空间哈希
  world.rebuildUnitGrid();

  for (const unit of world.units) {
    if (unit.dead) continue;
    if (!unit.config.charge) continue;

    if (unit.chargeCooldown > 0) unit.chargeCooldown -= world.unitTimeScale;

    if (unit.state !== UnitState.Charge) continue;

    advanceCharge(world, unit);
  }
  world.markUnitGridDirty();
}

/** 沿锁定方向推进一段路程，并结算途经敌人 */
function advanceCharge(world: World, unit: Unit): void {
  // 原地前摇：站定蓄力，方向已在 AI 切入时锁定
  if (unit.chargeWindupLeft > 0) {
    unit.chargeWindupLeft -= world.unitTimeScale;
    return;
  }

  const charge = unit.config.charge!;
  const stepSpeed = mul(unit.stats.moveSpeed, charge.speedMul);
  let step: Fx = mul(div(stepSpeed, TICK_RATE_FX), world.unitTimeScale);
  if (step > unit.chargeRemaining) step = unit.chargeRemaining;

  const prevX = unit.pos.x;
  const prevY = unit.pos.y;
  unit.pos.x += mul(unit.chargeDir.x, step);
  unit.pos.y += mul(unit.chargeDir.y, step);
  unit.pos.x = clampToArena(unit.pos.x, ARENA_WIDTH, unit.config.radius);
  unit.pos.y = clampToArena(unit.pos.y, ARENA_HEIGHT, unit.config.radius);
  // 冲刺无视软碰撞，不拦河道就会直线冲进河里
  if (isGroundBlockedAt(world.nav, unit, unit.pos.x, unit.pos.y)) {
    unit.pos.x = prevX;
    unit.pos.y = prevY;
    endCharge(unit);
    resolveChargeHits(world, unit);
    return;
  }

  // 被边界卡住则提前结束冲刺
  const moved = lengthOf(unit.pos.x - prevX, unit.pos.y - prevY);
  unit.chargeRemaining -= moved;
  if (moved <= 0 || unit.chargeRemaining <= 0) {
    endCharge(unit);
  }

  resolveChargeHits(world, unit);
}

/**
 * 碰撞圈碰到任意敌人后，对前方 aoeRadius 内所有未命中敌人结算击退伤害。
 * 每段冲刺每个目标只结算一次。
 */
function resolveChargeHits(world: World, unit: Unit): void {
  const charge = unit.config.charge!;
  const grid = world.unitGrid;

  // 先确认本帧是否与敌方碰撞圈重叠（触发溅射的条件）
  if (!hasEnemyBodyContact(world, unit)) return;

  const aoeSq = mul(charge.aoeRadius, charge.aoeRadius);
  grid.query(unit.pos.x, unit.pos.y, charge.aoeRadius + MAX_UNIT_RADIUS, neighbors);

  // 仅首撞播扇形冲击波，后续途经溅射只靠受击标记
  const firstImpact = unit.chargeHits.length === 0;
  let hitAny = false;

  for (let k = 0; k < neighbors.length; k++) {
    const idx = neighbors[k]!;
    const other = world.units[idx]!;
    if (!isAlive(other)) continue;
    if (other.faction === unit.faction) continue;
    if (other.id === unit.id) continue;
    if (!canChargeAffect(other)) continue;
    if (unit.chargeHits.includes(other.id)) continue;

    const dx = other.pos.x - unit.pos.x;
    const dy = other.pos.y - unit.pos.y;
    if (distSq(unit.pos.x, unit.pos.y, other.pos.x, other.pos.y) > aoeSq) continue;

    // 前方半圆：相对位移与冲刺方向点积 ≥ 0
    const forward = mul(dx, unit.chargeDir.x) + mul(dy, unit.chargeDir.y);
    if (forward < 0) continue;

    applyCombatDamage(other, charge.hitDamage, true);
    applyLateralKnockback(world, unit, other, charge.knockback);
    unit.chargeHits.push(other.id);
    hitAny = true;
  }

  if (firstImpact && hitAny) {
    world.spawnAoePulse(
      'charge_fan',
      unit.pos.x,
      unit.pos.y,
      charge.aoeRadius,
      unit.chargeDir.x,
      unit.chargeDir.y,
    );
  }
}

/** 是否与任一敌方碰撞圈重叠 */
function hasEnemyBodyContact(world: World, unit: Unit): boolean {
  const grid = world.unitGrid;
  grid.query(unit.pos.x, unit.pos.y, unit.config.radius + MAX_UNIT_RADIUS, neighbors);

  for (let k = 0; k < neighbors.length; k++) {
    const idx = neighbors[k]!;
    const other = world.units[idx]!;
    if (!isAlive(other)) continue;
    if (other.faction === unit.faction) continue;
    if (other.id === unit.id) continue;
    // 建筑/飞行/投放炸弹不参与冲刺体碰，避免仅蹭到塔就触发溅射
    if (!canChargeAffect(other)) continue;

    const minDist = unit.config.radius + other.config.radius;
    if (distSq(unit.pos.x, unit.pos.y, other.pos.x, other.pos.y) < mul(minDist, minDist)) {
      return true;
    }
  }
  return false;
}

/** 冲锋只打地面可移动单位；建筑不受伤、不击退，也不作为体碰触发源。 */
function canChargeAffect(other: Unit): boolean {
  if (isBuildingConfig(other.config)) return false;
  if (other.config.movementLayer === 'air') return false;
  if (isUntargetableBomb(other)) return false;
  return true;
}

/**
 * 横向击退：垂直于冲刺方向。
 * 叉积 (dir × offset) 的符号决定推到左侧还是右侧，保证被撞单位往冲刺线外侧飞。
 */
function applyLateralKnockback(world: World, charger: Unit, victim: Unit, distance: Fx): void {
  const dx = victim.pos.x - charger.pos.x;
  const dy = victim.pos.y - charger.pos.y;
  // 2D 叉积 dir×offset：>0 表示受害者在冲刺方向左侧
  const cross = mul(charger.chargeDir.x, dy) - mul(charger.chargeDir.y, dx);

  // 左侧推 (-dy, dx) 的垂直方向，右侧推反方向；重合时默认推右
  if (cross >= 0) {
    set(lateral, -charger.chargeDir.y, charger.chargeDir.x);
  } else {
    set(lateral, charger.chargeDir.y, -charger.chargeDir.x);
  }
  normalize(lateral, lateral.x, lateral.y);
  if (lateral.x === 0 && lateral.y === 0) {
    // 退化：冲刺方向为零或完全重合，沿固定轴推开
    set(lateral, ONE, 0);
  }

  victim.pos.x += mul(lateral.x, distance);
  victim.pos.y += mul(lateral.y, distance);
  victim.pos.x = clampToArena(victim.pos.x, ARENA_WIDTH, victim.config.radius);
  victim.pos.y = clampToArena(victim.pos.y, ARENA_HEIGHT, victim.config.radius);
  evictUnitFromRiver(victim, world.nav);
}

function endCharge(unit: Unit): void {
  unit.chargeRemaining = 0;
  unit.chargeWindupLeft = 0;
  // 退出 Charge 后本帧不再 Seek/Attack，下一帧 AI 会按射程重判
  unit.state = UnitState.Idle;
}

