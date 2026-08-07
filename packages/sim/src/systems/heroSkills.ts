import { type Fx, ONE, mul } from '../math/fixed.js';
import { distSq } from '../math/vec2.js';
import { BuffOp, type Buff } from '../stats/buff.js';
import type { Unit } from '../entity/unit.js';
import type { World } from '../world.js';

const neighbors: number[] = [];

/**
 * 维护英雄专属技能。
 * 光环先移除失效来源再重新覆盖，确保单位离开国王范围时属性会立刻还原。
 */
export function updateHeroSkills(world: World): void {
  tickHealEffects(world);
  removeExpiredInspires(world);
  updateKingInspires(world);
  updateQueenHeals(world);
}

/** 推进表现事件，不影响任何战斗属性。 */
function tickHealEffects(world: World): void {
  for (let i = world.healEffects.length - 1; i >= 0; i--) {
    const effect = world.healEffects[i]!;
    effect.remainingTicks--;
    if (effect.remainingTicks <= 0) world.healEffects.splice(i, 1);
  }
}

/** 移除死亡、离场或不再生效的国王提供的振奋 Buff。 */
function removeExpiredInspires(world: World): void {
  for (const unit of world.units) {
    let changed = false;
    for (let i = unit.buffs.length - 1; i >= 0; i--) {
      const buff = unit.buffs[i]!;
      const source = world.getUnit(buff.sourceId);
      if (
        isInspireBuff(source, buff)
        && (!source || source.dead || !isInInspireRange(source, unit))
      ) {
        unit.buffs.splice(i, 1);
        changed = true;
      }
    }
    if (changed) unit.statsDirty = true;
  }
}

/** 对每名国王附近的友军施加不叠加的持续振奋。 */
function updateKingInspires(world: World): void {
  for (let index = 0; index < world.units.length; index++) {
    const king = world.units[index]!;
    const inspire = king.config.inspire;
    if (king.dead || !inspire) continue;

    world.unitGrid.query(king.pos.x, king.pos.y, inspire.radius, neighbors);
    for (const neighborIndex of neighbors) {
      const target = world.units[neighborIndex]!;
      if (target.dead || target.id === king.id || target.faction !== king.faction) continue;
      if (!isInInspireRange(king, target)) continue;
      if (hasInspire(world, target)) continue;

      target.buffs.push(
        createInspireBuff(king.id, 'attackInterval', inspire.attackIntervalMul - ONE),
        createInspireBuff(king.id, 'moveSpeed', inspire.moveSpeedMul - ONE),
      );
      target.statsDirty = true;
    }
  }
}

/** CD 就绪时治疗女王周边生命比例最低的友军及其附近单位。 */
function updateQueenHeals(world: World): void {
  for (const queen of world.units) {
    const heal = queen.config.heal;
    if (queen.dead || !heal) continue;
    if (queen.healCooldown > 0) {
      queen.healCooldown = Math.max(0, queen.healCooldown - ONE);
      continue;
    }

    const center = findLowestHpAlly(world, queen, heal.targetRange);
    if (!center) continue;

    world.unitGrid.query(center.pos.x, center.pos.y, heal.radius, neighbors);
    let healed = false;
    const radiusSq = mul(heal.radius, heal.radius);
    for (const neighborIndex of neighbors) {
      const target = world.units[neighborIndex]!;
      if (target.dead || target.faction !== queen.faction) continue;
      if (distSq(center.pos.x, center.pos.y, target.pos.x, target.pos.y) > radiusSq) continue;
      if (target.hp >= target.stats.maxHp) continue;
      target.hp = Math.min(target.stats.maxHp, target.hp + heal.amount);
      healed = true;
    }
    if (!healed) continue;

    queen.healCooldown = heal.cooldown;
    world.spawnHealEffect(center.pos.x, center.pos.y, heal.radius);
  }
}

/** 按生命比例、再按实体 id 选出治疗圆心，保证所有端作出相同决定。 */
function findLowestHpAlly(world: World, queen: Unit, range: Fx): Unit | undefined {
  const rangeSq = mul(range, range);
  let selected: Unit | undefined;
  for (const ally of world.units) {
    if (ally.dead || ally.faction !== queen.faction || ally.hp >= ally.stats.maxHp) continue;
    if (distSq(queen.pos.x, queen.pos.y, ally.pos.x, ally.pos.y) > rangeSq) continue;
    if (!selected || isLowerHpRatio(ally, selected)) selected = ally;
  }
  return selected;
}

/** 交叉相乘比较生命比例，避免 tick 内引入浮点数。 */
function isLowerHpRatio(candidate: Unit, current: Unit): boolean {
  const left = candidate.hp * current.stats.maxHp;
  const right = current.hp * candidate.stats.maxHp;
  return left < right || (left === right && candidate.id < current.id);
}

function isInInspireRange(king: Unit, target: Unit): boolean {
  const inspire = king.config.inspire!;
  return distSq(king.pos.x, king.pos.y, target.pos.x, target.pos.y) <= mul(inspire.radius, inspire.radius);
}

function hasInspire(world: World, unit: Unit): boolean {
  return unit.buffs.some((buff) => isInspireBuff(world.getUnit(buff.sourceId), buff));
}

function isInspireBuff(source: Unit | undefined, buff: Buff): boolean {
  return buff.id === -buff.sourceId
    && (buff.stat === 'attackInterval' || buff.stat === 'moveSpeed')
    && (source === undefined || source.config.inspire !== undefined);
}

function createInspireBuff(
  sourceId: number,
  stat: 'attackInterval' | 'moveSpeed',
  value: Fx,
): Buff {
  return { id: -sourceId, sourceId, stat, op: BuffOp.Mul, value, remainingTicks: -1 };
}
