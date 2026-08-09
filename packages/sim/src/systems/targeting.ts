import { type Fx, mul } from '../math/fixed.js';
import { distSq } from '../math/vec2.js';
import { isBuildingConfig } from '../config/units.js';
import { NO_TARGET, type Unit, isAlive } from '../entity/unit.js';
import type { World } from '../world.js';
import { NO_ENGAGE_SLOT, assignEngageSlot } from './engagement.js';

/**
 * 选敌：锁定最近敌人后，目标存活期间不再换敌；只有目标死亡/消失才重新索敌。
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
    // 建筑本期不索敌；仍可作为敌军目标被其它单位选中
    if (isBuildingConfig(unit.config)) continue;

    // 仅用于出生错峰；锁定后不再周期重置
    if (unit.retargetIn > 0) {
      unit.retargetIn--;
      continue;
    }

    const current = world.getUnit(unit.targetId);
    // 只对敌军粘性锁定；友军治疗目标随时可被新敌军打断
    if (isAlive(current) && current.faction !== unit.faction) continue;

    const enemyId = findNearestEnemy(world, unit);
    if (enemyId !== NO_TARGET) {
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
 * 全场线性扫描找最近的敌人。
 *
 * 这里刻意不用空间哈希：索敌半径覆盖整个场地，按半径查哈希等于把所有格子
 * 都遍历一遍，反而比直接扫单位数组更慢。等以后出现「短视野」兵种再按需切换。
 */
function findNearestEnemy(world: World, unit: Unit): number {
  const sightSq = mul(unit.config.sightRange, unit.config.sightRange);
  let bestId = NO_TARGET;
  let bestDistSq: Fx = 0;

  // 近战/冲刺够不着飞行层，索敌时直接跳过，避免贴脸空挥
  const meleeOnly = unit.config.attack.kind === 'melee' || unit.config.attack.kind === 'melee_aoe';

  for (const other of world.units) {
    if (other.dead || other.faction === unit.faction) continue;
    if (meleeOnly && other.config.movementLayer === 'air') continue;
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
