import { type Fx, mul } from '../math/fixed.js';
import { distSq } from '../math/vec2.js';
import { canBuildingAttack, isBuildingConfig } from '../config/units.js';
import { NO_TARGET, type Unit, isAlive } from '../entity/unit.js';
import type { World } from '../world.js';
import { NO_ENGAGE_SLOT, assignEngageSlot } from './engagement.js';
import { canAttackTarget, isWithinAttackReach } from './combatRange.js';

/**
 * 选敌策略：
 * - 交战中（已够得着）粘性不换火。
 * - 地面：够不着时若有射程内威胁则改火；远距有建筑时跳过「打不到自己」的单位以保推家。
 * - 飞行：非建筑目标一出攻击射程立刻放弃；追建筑时若射程内出现己方可打敌军（含近战地面）则打断改火。
 *   重索时优先锁已进攻击射程的可打敌军，否则再按推家过滤找远敌。
 *
 * 有治疗技能的单位在无敌军时，会改锁最近受伤友军以便寻路过治疗半径；
 * 友军目标不粘性挡敌——每帧仍优先扫描敌军，保证敌方入场后立刻切回进攻。
 *
 * spawnUnit 时按 id 打散了首次索敌倒计时（retargetIn），避免同批出场挤在同一帧全场扫描。
 * 新锁定敌军时立刻分配攻击环槽位；治疗友军不占槽位。
 */
export function updateTargeting(world: World): void {
  for (const unit of world.units) {
    if (unit.dead) continue;
    // 无攻击能力的建筑不索敌；仍可作为敌军目标被其它单位选中
    if (isBuildingConfig(unit.config) && !canBuildingAttack(unit.config)) continue;

    // 仅用于出生错峰；锁定后不再周期重置
    if (unit.retargetIn > 0) {
      unit.retargetIn--;
      continue;
    }

    const current = world.getUnit(unit.targetId);
    // 敌军粘性：已能出手则咬住；够不着时按空/地规则决定是否打断
    // 不可打目标（如炸弹）立即放弃，避免粘性卡住
    if (isAlive(current) && current.faction !== unit.faction && canAttackTarget(unit, current)) {
      if (isWithinAttackReach(unit, current)) continue;

      if (unit.config.movementLayer === 'air') {
        // 非建筑出距立刻弃；建筑出距仅被射程内可打敌军打断
        if (isBuildingConfig(current.config) && !hasInReachAttackable(world, unit, current)) {
          continue;
        }
        // fall through
      } else if (!hasInReachEnemyThreat(world, unit, current)) {
        continue;
      }
    }

    const enemyId = findNearestEnemy(world, unit);
    if (enemyId !== NO_TARGET) {
      // 重索到同一目标时保留槽位，避免无意义换槽抖路径
      if (enemyId === unit.targetId) continue;
      unit.targetId = enemyId;
      const target = world.getUnit(enemyId);
      unit.engageSlot = target ? assignEngageSlot(unit, target) : NO_ENGAGE_SLOT;
      continue;
    }

    if (unit.config.heal) {
      // 当前受伤友军仍有效则继续跟着走，避免每帧换最近目标导致抖路径
      if (
        isAlive(current)
        && current.faction === unit.faction
        && current.id !== unit.id
        && current.hp < current.stats.maxHp
      ) {
        unit.engageSlot = NO_ENGAGE_SLOT;
        continue;
      }

      unit.targetId = findNearestInjuredAlly(world, unit);
      unit.engageSlot = NO_ENGAGE_SLOT;
      continue;
    }

    unit.targetId = NO_TARGET;
    unit.engageSlot = NO_ENGAGE_SLOT;
  }
}

/**
 * 是否存在「已进入攻击射程且己方可打」的其它敌军（不要求对方能打到自己）。
 * 供飞行单位打断推家粘性，避免贴脸地面兵被推家过滤漏掉。
 */
function hasInReachAttackable(world: World, unit: Unit, current: Unit): boolean {
  for (const other of world.units) {
    if (other.dead || other.faction === unit.faction || other.id === current.id) continue;
    if (!canAttackTarget(unit, other)) continue;
    if (isWithinAttackReach(unit, other)) return true;
  }
  return false;
}

/**
 * 地面追击中是否存在「已进入攻击射程」的其它敌军（含推家威胁过滤）。
 */
function hasInReachEnemyThreat(world: World, unit: Unit, current: Unit): boolean {
  const sightSq = mul(unit.config.sightRange, unit.config.sightRange);
  const buildingInSight = hasEnemyBuildingInSight(world, unit, sightSq);

  for (const other of world.units) {
    if (other.dead || other.faction === unit.faction || other.id === current.id) continue;
    if (!isEnemyTargetCandidate(unit, other, buildingInSight)) continue;
    const d = distSq(unit.pos.x, unit.pos.y, other.pos.x, other.pos.y);
    if (d > sightSq) continue;
    if (isWithinAttackReach(unit, other)) return true;
  }
  return false;
}

/**
 * 全场线性扫描找最近的敌人。
 * 优先锁已进攻击射程的可打敌军（保证飞行贴脸改火能真正锁上近战）；
 * 否则按视野 + 推家过滤选远敌。
 *
 * 这里刻意不用空间哈希：索敌半径覆盖整个场地，按半径查哈希等于把所有格子
 * 都遍历一遍，反而比直接扫单位数组更慢。等以后出现「短视野」兵种再按需切换。
 */
function findNearestEnemy(world: World, unit: Unit): number {
  const inReachId = findNearestInReachAttackable(world, unit);
  if (inReachId !== NO_TARGET) return inReachId;

  const sightSq = mul(unit.config.sightRange, unit.config.sightRange);
  const buildingInSight = hasEnemyBuildingInSight(world, unit, sightSq);
  let bestId = NO_TARGET;
  let bestDistSq: Fx = 0;

  for (const other of world.units) {
    if (other.dead || other.faction === unit.faction) continue;
    if (!isEnemyTargetCandidate(unit, other, buildingInSight)) continue;
    const d = distSq(unit.pos.x, unit.pos.y, other.pos.x, other.pos.y);
    if (d > sightSq) continue;
    // 等距时取 id 小的，保证任何机器上选出的都是同一个目标
    if (bestId === NO_TARGET || d < bestDistSq || (d === bestDistSq && other.id < bestId)) {
      bestId = other.id;
      bestDistSq = d;
    }
  }
  return bestId;
}

/** 最近的已进攻击射程且己方可打的敌军（不受推家威胁过滤）。 */
function findNearestInReachAttackable(world: World, unit: Unit): number {
  let bestId = NO_TARGET;
  let bestDistSq: Fx = 0;

  for (const other of world.units) {
    if (other.dead || other.faction === unit.faction) continue;
    if (!canAttackTarget(unit, other)) continue;
    if (!isWithinAttackReach(unit, other)) continue;
    const d = distSq(unit.pos.x, unit.pos.y, other.pos.x, other.pos.y);
    if (bestId === NO_TARGET || d < bestDistSq || (d === bestDistSq && other.id < bestId)) {
      bestId = other.id;
      bestDistSq = d;
    }
  }
  return bestId;
}

/**
 * 视野内是否存在敌方建筑。有建筑时进入「威胁过滤」模式，避免被无威胁单位引离推家。
 */
function hasEnemyBuildingInSight(world: World, unit: Unit, sightSq: Fx): boolean {
  for (const other of world.units) {
    if (other.dead || other.faction === unit.faction) continue;
    if (!isBuildingConfig(other.config)) continue;
    const d = distSq(unit.pos.x, unit.pos.y, other.pos.x, other.pos.y);
    if (d <= sightSq) return true;
  }
  return false;
}

/**
 * 远距索敌候选：必须能打到对方；有敌方建筑在视野时，额外只保留建筑或能打到自己的威胁。
 */
function isEnemyTargetCandidate(unit: Unit, other: Unit, buildingInSight: boolean): boolean {
  if (!canAttackTarget(unit, other)) return false;
  if (!buildingInSight) return true;
  return isBuildingConfig(other.config) || canAttackTarget(other, unit);
}

/** 全场扫描最近的受伤友军（排除自身），供治疗单位在无敌军时寻路接近。 */
function findNearestInjuredAlly(world: World, unit: Unit): number {
  const sightSq = mul(unit.config.sightRange, unit.config.sightRange);
  let bestId = NO_TARGET;
  let bestDistSq: Fx = 0;

  for (const other of world.units) {
    if (other.dead || other.id === unit.id || other.faction !== unit.faction) continue;
    if (other.hp >= other.stats.maxHp) continue;
    const d = distSq(unit.pos.x, unit.pos.y, other.pos.x, other.pos.y);
    if (d > sightSq) continue;
    if (bestId === NO_TARGET || d < bestDistSq || (d === bestDistSq && other.id < bestId)) {
      bestId = other.id;
      bestDistSq = d;
    }
  }
  return bestId;
}
