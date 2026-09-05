import {
  canBuildingAttack,
  isBuildingConfig,
  listDeathSpawnEntries,
  UNIT_CONFIGS,
} from '../config/units.js';
import { Faction, isAlive, opposingFaction, type Unit } from '../entity/unit.js';
import {
  type Fx,
  ONE,
  div,
  floorToInt,
  fromInt,
  max,
  mul,
} from '../math/fixed.js';
import { distSqToBuildingFootprint, isWithinAttackReach } from '../systems/combatRange.js';
import type { World } from '../world.js';

/** 伤害上限累加封顶，避免 Q16.16 溢出后变成负数误判可追平。 */
const THREAT_CAP: Fx = 0x7fffffff;

/**
 * 结算剩余时间内，该阵营还能打到敌方主堡的伤害上限（定点，刻意高估）。
 * 只用于「已经不可能改写血量胜负」的提前结束，低估会错杀仍能翻盘的对局。
 */
export function estimateCastleThreat(world: World, faction: Faction, remainingTicks: number): Fx {
  if (remainingTicks <= 0) return 0;

  const enemies = livingCastles(world, opposingFaction(faction));
  if (enemies.length === 0) return 0;

  const timeScale = world.unitTimeScale;
  let threat: Fx = 0;

  for (const unit of world.units) {
    if (unit.faction !== faction || !isAlive(unit)) continue;
    threat = addThreat(threat, unitCastleThreat(unit, enemies, remainingTicks, timeScale));
    if (threat === THREAT_CAP) return THREAT_CAP;
  }

  for (const projectile of world.projectiles) {
    if (projectile.faction !== faction || projectile.dead) continue;
    threat = addThreat(threat, projectile.damage);
    if (projectile.groundBurn) {
      threat = addThreat(
        threat,
        scaleThreat(
          projectile.groundBurn.damage,
          hazardPulses(projectile.groundBurn.durationTicks, projectile.groundBurn.intervalTicks),
        ),
      );
    }
    if (threat === THREAT_CAP) return THREAT_CAP;
  }

  for (const hazard of world.groundHazards) {
    if (hazard.faction !== faction || hazard.remainingTicks <= 0) continue;
    if (!hazardHitsCastle(hazard.x, hazard.y, hazard.radius, enemies)) continue;
    threat = addThreat(
      threat,
      scaleThreat(hazard.damage, hazardPulses(hazard.remainingTicks, hazard.intervalTicks)),
    );
    if (threat === THREAT_CAP) return THREAT_CAP;
  }

  return threat;
}

/** 建筑够不着主堡就计 0：箭塔/主堡自己不会走过去。可移动单位按剩余时间打满。 */
function unitCastleThreat(
  unit: Unit,
  enemies: readonly Unit[],
  remainingTicks: number,
  timeScale: Fx,
): Fx {
  if (isBuildingConfig(unit.config)) {
    if (!canBuildingAttack(unit.config) || !canReachAnyCastle(unit, enemies)) return 0;
    return attackThreat(unit.stats.damage, unit.stats.attackInterval, remainingTicks, timeScale);
  }

  let threat = attackThreat(unit.stats.damage, unit.stats.attackInterval, remainingTicks, timeScale);
  if (unit.config.detonate) {
    threat = addThreat(threat, unit.stats.damage);
  }
  const charge = unit.config.charge;
  if (charge) {
    threat = addThreat(
      threat,
      attackThreat(charge.hitDamage, charge.cooldown, remainingTicks, timeScale),
    );
  }
  const burn = unit.config.groundBurn;
  if (burn) {
    threat = addThreat(
      threat,
      scaleThreat(
        burn.damage,
        hazardPulses(floorToInt(burn.durationTicks), floorToInt(burn.intervalTicks)),
      ),
    );
  }
  const summon = unit.config.summon;
  if (summon) {
    const child = UNIT_CONFIGS[summon.unitTypeId];
    const summons = attackCount(summon.cooldown, remainingTicks, timeScale);
    threat = addThreat(
      threat,
      scaleThreat(attackThreat(child.damage, child.attackInterval, remainingTicks, timeScale), summons),
    );
    if (child.detonate) {
      threat = addThreat(threat, scaleThreat(child.damage, summons));
    }
  }
  if (unit.config.deathSpawn) {
    for (const entry of listDeathSpawnEntries(unit.config.deathSpawn)) {
      const child = UNIT_CONFIGS[entry.unitTypeId];
      threat = addThreat(
        threat,
        scaleThreat(
          attackThreat(child.damage, child.attackInterval, remainingTicks, timeScale),
          entry.count,
        ),
      );
    }
  }
  return threat;
}

/**
 * 按剩余逻辑时间打满的伤害上限。
 * 间隔按 2 倍攻速高估，覆盖国王光环等加速，避免把仍能追平的局提前判死。
 */
function attackThreat(damage: Fx, attackInterval: Fx, remainingTicks: number, timeScale: Fx): Fx {
  return scaleThreat(damage, attackCount(attackInterval, remainingTicks, timeScale));
}

function attackCount(interval: Fx, remainingTicks: number, timeScale: Fx): number {
  const hasteInterval = max(div(interval, fromInt(2)), ONE);
  const scaled = mul(fromInt(remainingTicks), timeScale);
  return floorToInt(div(scaled, hasteInterval)) + 1;
}

function canReachAnyCastle(unit: Unit, enemies: readonly Unit[]): boolean {
  for (const castle of enemies) {
    if (isWithinAttackReach(unit, castle)) return true;
  }
  return false;
}

function livingCastles(world: World, faction: Faction): Unit[] {
  const castles: Unit[] = [];
  for (const unit of world.units) {
    if (unit.typeId !== 'building_base' || unit.faction !== faction) continue;
    if (!isAlive(unit) || unit.hp <= 0) continue;
    castles.push(unit);
  }
  return castles;
}

function hazardHitsCastle(
  x: Fx,
  y: Fx,
  radius: Fx,
  enemies: readonly Unit[],
): boolean {
  const radiusSq = mul(radius, radius);
  for (const castle of enemies) {
    if (distSqToBuildingFootprint(x, y, castle) <= radiusSq) return true;
  }
  return false;
}

function hazardPulses(remainingTicks: number, intervalTicks: number): number {
  const interval = Math.max(1, intervalTicks);
  if (remainingTicks <= 0) return 0;
  return Math.floor((remainingTicks + interval - 1) / interval);
}

function scaleThreat(damage: Fx, count: number): Fx {
  if (count <= 0 || damage <= 0) return 0;
  if (count > 1 && damage > Math.floor(THREAT_CAP / count)) return THREAT_CAP;
  return damage * count;
}

function addThreat(left: Fx, right: Fx): Fx {
  if (right <= 0) return left;
  if (left >= THREAT_CAP - right) return THREAT_CAP;
  return left + right;
}
