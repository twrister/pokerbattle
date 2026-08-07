import { type Fx, mul } from '../math/fixed.js';
import { distSq } from '../math/vec2.js';
import { NO_TARGET, type Unit, isAlive } from '../entity/unit.js';
import type { World } from '../world.js';

/**
 * 选敌：锁定最近敌人后，目标存活期间不再换敌；只有目标死亡/消失才重新索敌。
 *
 * spawnUnit 时按 id 打散了首次索敌倒计时（retargetIn），避免同批出场挤在同一帧全场扫描。
 */
export function updateTargeting(world: World): void {
  for (const unit of world.units) {
    if (unit.dead) continue;

    // 仅用于出生错峰；锁定后不再周期重置
    if (unit.retargetIn > 0) {
      unit.retargetIn--;
      continue;
    }

    if (isAlive(world.getUnit(unit.targetId))) continue;

    unit.targetId = findNearestEnemy(world, unit);
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

  for (const other of world.units) {
    if (other.dead || other.faction === unit.faction) continue;
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
