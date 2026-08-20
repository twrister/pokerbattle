import { type Fx, ONE, fromFloat, mul } from '../math/fixed.js';
import { distSq } from '../math/vec2.js';
import { getUnitConfig, isBuildingConfig, isMechanicalUnit } from '../config/units.js';
import { BuffOp, type Buff } from '../stats/buff.js';
import { NO_TARGET, type Unit, isAlive } from '../entity/unit.js';
import type { World } from '../world.js';

const neighbors: number[] = [];

/** 施法特效持续逻辑帧（约 0.8 秒），覆盖 Teleport 动画播放窗口。 */
const CAST_FX_TICKS = 16;
/** 召唤物与施法者碰撞圈之间留出少量空隙，避免出生帧完全重叠。 */
const SUMMON_SPAWN_GAP = fromFloat(0.1);

/**
 * 维护英雄专属技能。
 * 光环先移除失效来源再重新覆盖，确保单位离开国王范围时属性会立刻还原。
 */
export function updateHeroSkills(world: World): void {
  removeExpiredInspires(world);
  updateKingInspires(world);
  updateQueenHeals(world);
  updateMageSummons(world);
  world.markUnitGridDirty();
}

/**
 * 推进治疗环 / 伤害脉冲 / 施法与受击表现倒计时。
 * 放在 step 开头，避免本帧新产生的效果同帧被扣掉。
 */
export function tickPresentationFx(world: World): void {
  for (let i = world.healEffects.length - 1; i >= 0; i--) {
    const effect = world.healEffects[i]!;
    effect.remainingTicks--;
    if (effect.remainingTicks <= 0) world.healEffects.splice(i, 1);
  }
  for (let i = world.aoePulseEffects.length - 1; i >= 0; i--) {
    const effect = world.aoePulseEffects[i]!;
    effect.remainingTicks--;
    if (effect.remainingTicks <= 0) world.aoePulseEffects.splice(i, 1);
  }
  for (let i = world.explosionEffects.length - 1; i >= 0; i--) {
    const effect = world.explosionEffects[i]!;
    effect.remainingTicks--;
    if (effect.remainingTicks <= 0) world.explosionEffects.splice(i, 1);
  }
  for (const unit of world.units) {
    if (unit.castFxLeft > 0) unit.castFxLeft--;
    if (unit.hitFxLeft > 0) unit.hitFxLeft--;
    if (unit.aoeHitFxLeft > 0) unit.aoeHitFxLeft--;
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
    if (changed) {
      unit.statsDirty = true;
      syncInspiredFlag(unit);
    }
  }
}

/** 对每名国王附近的友军施加不叠加的持续振奋（常驻光环，无施法特效）。 */
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
      target.inspired = true;
    }
  }
}

/**
 * 女王单体治疗：冷却到期且范围内有伤员时进入前摇（与普攻同长），
 * 前摇开始即播施法特效并锁定目标；前摇走完再结算该目标。
 */
function updateQueenHeals(world: World): void {
  for (const queen of world.units) {
    const heal = queen.config.heal;
    if (queen.dead || !heal) continue;

    // 冷却与前摇并行倒计时，节奏对齐普攻（完整周期 ≈ cooldown）
    if (queen.healCooldown > 0) {
      queen.healCooldown = Math.max(0, queen.healCooldown - world.unitTimeScale);
    }

    if (queen.healWindupLeft > 0) {
      queen.healWindupLeft -= world.unitTimeScale;
      if (queen.healWindupLeft <= 0) {
        queen.healWindupLeft = 0;
        resolveQueenHeal(world, queen);
      }
      continue;
    }

    if (queen.healCooldown > 0) continue;

    const target = findLowestHpAlly(world, queen, heal.targetRange);
    if (!target) continue;

    queen.healCooldown = heal.cooldown;
    queen.healWindupLeft = queen.stats.attackWindup;
    queen.healCastTargetId = target.id;
    // 前摇一开始就播 Teleport，而不是等到结算帧
    queen.castFxLeft = CAST_FX_TICKS;
    // 打断进行中的普攻前摇，避免双前摇抢姿势
    queen.windupLeft = 0;
    if (queen.healWindupLeft <= 0) resolveQueenHeal(world, queen);
  }
}

/** 前摇结束后结算锁定目标；已死/离场/满血/超距则落空（CD 不退）。 */
function resolveQueenHeal(world: World, queen: Unit): void {
  const heal = queen.config.heal;
  const targetId = queen.healCastTargetId;
  queen.healCastTargetId = NO_TARGET;
  if (!heal) return;

  const target = world.getUnit(targetId);
  if (!isAlive(target) || target.faction !== queen.faction || target.id === queen.id) return;
  if (isBuildingConfig(target.config) || isMechanicalUnit(target.config)) return;
  if (target.hp >= target.stats.maxHp) return;

  const rangeSq = mul(heal.targetRange, heal.targetRange);
  if (distSq(queen.pos.x, queen.pos.y, target.pos.x, target.pos.y) > rangeSq) return;

  target.hp = Math.min(target.stats.maxHp, target.hp + heal.amount);
  // 特效落在受疗单位脚底，半径仅供渲染缩放
  world.spawnHealEffect(target.pos.x, target.pos.y, target.config.radius);
}

/**
 * 法师自动召唤：技能就绪后进入与普攻同长的施法前摇，
 * 前摇结束时在当前朝向前方生成一名同阵营骷髅兵。
 */
function updateMageSummons(world: World): void {
  for (const mage of world.units) {
    const summon = mage.config.summon;
    if (mage.dead || !summon) continue;

    if (mage.summonCooldown > 0) {
      mage.summonCooldown = Math.max(0, mage.summonCooldown - world.unitTimeScale);
    }

    if (mage.summonWindupLeft > 0) {
      mage.summonWindupLeft -= world.unitTimeScale;
      if (mage.summonWindupLeft <= 0) {
        mage.summonWindupLeft = 0;
        resolveMageSummon(world, mage);
      }
      continue;
    }

    if (mage.summonCooldown > 0) continue;

    mage.summonCooldown = summon.cooldown;
    mage.summonWindupLeft = mage.stats.attackWindup;
    mage.castFxLeft = CAST_FX_TICKS;
    // 技能起手打断普攻前摇，确保两套动作和结算不会重叠。
    mage.windupLeft = 0;
    if (mage.summonWindupLeft <= 0) resolveMageSummon(world, mage);
  }
}

/** 在法师面前生成召唤物；World 会负责将落点限制在场地内。 */
function resolveMageSummon(world: World, mage: Unit): void {
  const summon = mage.config.summon;
  if (!summon || mage.dead) return;

  const summonedConfig = getUnitConfig(summon.unitTypeId);
  const distance = mage.config.radius + summonedConfig.radius + SUMMON_SPAWN_GAP;
  const x = mage.pos.x + mul(mage.facing.x, distance);
  const y = mage.pos.y + mul(mage.facing.y, distance);
  world.spawnUnit(mage.faction, summon.unitTypeId, x, y, mage.ownerSlot);
}

/** 按生命比例、再按实体 id 选出单体治疗目标，保证所有端作出相同决定；排除自身、建筑与机械。 */
function findLowestHpAlly(world: World, queen: Unit, range: Fx): Unit | undefined {
  const rangeSq = mul(range, range);
  let selected: Unit | undefined;
  for (const ally of world.units) {
    if (ally.dead || ally.id === queen.id || ally.faction !== queen.faction) continue;
    // 建筑与机械单位不吃女王单体治疗
    if (isBuildingConfig(ally.config) || isMechanicalUnit(ally.config)) continue;
    if (ally.hp >= ally.stats.maxHp) continue;
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

/** 振奋 Buff 被摘掉后按剩余列表重算，避免快照每单位扫描 buffs。 */
function syncInspiredFlag(unit: Unit): void {
  for (const buff of unit.buffs) {
    if (buff.id === -buff.sourceId && buff.stat === 'moveSpeed') {
      unit.inspired = true;
      return;
    }
  }
  unit.inspired = false;
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
