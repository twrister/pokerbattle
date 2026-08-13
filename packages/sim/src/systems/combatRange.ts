import { type Fx, abs, div, fromFloat, max, mul } from '../math/fixed.js';
import { type Vec2, distSq, set } from '../math/vec2.js';
import { isBuildingConfig } from '../config/units.js';
import { ENGAGEMENT_SLOT_INSET } from '../config/tuning.js';
import { ARENA_HEIGHT, ARENA_WIDTH, clampToArena } from '../config/arena.js';
import type { Unit } from '../entity/unit.js';

/**
 * 圆心到建筑占地 AABB 最近点的距离平方；圆心落在矩形内则为 0。
 * 建筑碰撞/寻路是方形，近战射程必须用同一几何，否则贴四角会按内切圆算超距。
 */
export function distSqToBuildingFootprint(px: Fx, py: Fx, building: Unit): Fx {
  const half = fromFloat(building.config.footprint / 2);
  const minX = building.pos.x - half;
  const maxX = building.pos.x + half;
  const minY = building.pos.y - half;
  const maxY = building.pos.y + half;
  const closestX = px < minX ? minX : px > maxX ? maxX : px;
  const closestY = py < minY ? minY : py > maxY ? maxY : py;
  return distSq(px, py, closestX, closestY);
}

/** 投放炸弹：不可被索敌锁定，也不吃普攻/近战范围结算。炸弹兵可被正常锁定。 */
export function isUntargetableBomb(unit: Unit): boolean {
  const id = unit.typeId;
  return id === 'giant_bomb' || id === 'small_bomb';
}

/**
 * 攻击层规则：近战/近战范围打不到空中；投放炸弹不可锁定；远程默认可打地/空。
 * 索敌与战斗结算共用，避免规则漂移。
 */
export function canAttackTarget(attacker: Unit, target: Unit): boolean {
  if (isUntargetableBomb(target)) return false;
  return canThreatenTarget(attacker, target);
}

/**
 * 推家威胁判定：只看攻击层，忽略目标「不可锁定」。
 * 投放炸弹自身不可被锁定，若用 canAttackTarget 反查会永远判无威胁。
 */
export function canThreatenTarget(attacker: Unit, target: Unit): boolean {
  const kind = attacker.config.attack.kind;
  if ((kind === 'melee' || kind === 'melee_aoe') && target.config.movementLayer === 'air') {
    return false;
  }
  return true;
}

/**
 * 攻击者是否够得着目标（未超出最大射程）。
 * 单位：圆心距 vs range + 双方半径；
 * 建筑：圆心到占地表面距 vs range + 自身半径（与方形挤出一致）。
 * reachBonus 用于退出迟滞 / 出手容差。
 */
export function isWithinAttackReach(attacker: Unit, target: Unit, reachBonus: Fx = 0): boolean {
  if (isBuildingConfig(target.config)) {
    const reach = attacker.stats.range + attacker.config.radius + reachBonus;
    return distSqToBuildingFootprint(attacker.pos.x, attacker.pos.y, target) <= mul(reach, reach);
  }
  const reach =
    attacker.stats.range + attacker.config.radius + target.config.radius + reachBonus;
  return distSq(attacker.pos.x, attacker.pos.y, target.pos.x, target.pos.y) <= mul(reach, reach);
}

/**
 * 目标是否仍在最小射程之外（边缘距 ≥ minRange）。
 * minRange=0 时恒为 true；口径与最大射程一致（单位圆 / 建筑占地表面）。
 */
export function isOutsideMinAttackRange(attacker: Unit, target: Unit): boolean {
  const minRange = attacker.config.minRange;
  if (minRange <= 0) return true;
  if (isBuildingConfig(target.config)) {
    const minReach = minRange + attacker.config.radius;
    return distSqToBuildingFootprint(attacker.pos.x, attacker.pos.y, target) >= mul(minReach, minReach);
  }
  const minReach = minRange + attacker.config.radius + target.config.radius;
  return distSq(attacker.pos.x, attacker.pos.y, target.pos.x, target.pos.y) >= mul(minReach, minReach);
}

/**
 * 是否落在可攻击射程带内：未超出最大射程，且未贴进最小射程。
 * reachBonus 只放大最大射程一侧（与 Attack 退出迟滞一致）。
 */
export function isInAttackRangeBand(attacker: Unit, target: Unit, reachBonus: Fx = 0): boolean {
  return isWithinAttackReach(attacker, target, reachBonus) && isOutsideMinAttackRange(attacker, target);
}

/** ≈ 1/√2；对角槽把 expand 压到 expand/√2，使角外表面距回到 expand（不超出射程） */
const INV_SQRT2: Fx = 46341;

/**
 * 建筑攻击环：把单位停在「占地向外扩大 clearance」的方形外缘上。
 * 对角槽落在角外，避免圆形环目标点掉进 footprint 被 A* 挤到角上够不着。
 * 对角方向表面距本为 expand·√2，需把 expand 缩到 expand/√2，否则远程会停在射程外永久 Seek。
 */
export function computeBuildingEngageGoal(
  attacker: Unit,
  building: Unit,
  dir: Readonly<Vec2>,
  out: Vec2,
): Vec2 {
  // 与圆形环一致：优先略进入射程；近战 range 被 inset 吃光时贴碰撞外缘
  let stopGap = attacker.stats.range - ENGAGEMENT_SLOT_INSET;
  if (stopGap < 0) stopGap = 0;
  let expand = attacker.config.radius + stopGap;

  // 从中心沿 dir 打到扩大 AABB 边界：t = halfExt / max(|dx|,|dy|)
  const ax = abs(dir.x);
  const ay = abs(dir.y);
  // 对角角点到占地表面距 = expand·√2；压 expand 使表面距回到 expand ≤ reach - inset
  if (ax > 0 && ay > 0) {
    expand = mul(expand, INV_SQRT2);
  }
  const halfExt = fromFloat(building.config.footprint / 2) + expand;
  const denom = max(ax, ay);
  const t = denom > 0 ? div(halfExt, denom) : halfExt;
  const x = building.pos.x + mul(dir.x, t);
  const y = building.pos.y + mul(dir.y, t);
  return set(
    out,
    clampToArena(x, ARENA_WIDTH, attacker.config.radius),
    clampToArena(y, ARENA_HEIGHT, attacker.config.radius),
  );
}
