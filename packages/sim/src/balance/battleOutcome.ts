import { Faction, isAlive } from '../entity/unit.js';
import { toFloat } from '../math/fixed.js';
import { World } from '../world.js';

/** 双方都不再有存活单位，且场上没有未落地弹道，才算分出胜负。 */
export function isBattleSettled(world: World, factionA: Faction, factionB: Faction): boolean {
  if (world.projectiles.some((projectile) => !projectile.dead)) return false;
  const aliveA = countAlive(world, factionA);
  const aliveB = countAlive(world, factionB);
  return aliveA === 0 || aliveB === 0;
}

export function countAlive(world: World, faction: Faction): number {
  let n = 0;
  for (const unit of world.units) {
    if (unit.faction === faction && isAlive(unit)) n += 1;
  }
  return n;
}

export function remainingHp(world: World, faction: Faction): number {
  let hp = 0;
  for (const unit of world.units) {
    if (unit.faction === faction && isAlive(unit)) hp += toFloat(unit.hp);
  }
  return hp;
}

export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
