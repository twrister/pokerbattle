import { type Fx, mul } from '../math/fixed.js';
import { distSq } from '../math/vec2.js';
import { canBuildingAttack, isBuildingConfig, isCastleId, isMechanicalUnit } from '../config/units.js';
import { Faction, NO_TARGET, type Unit, isAlive } from '../entity/unit.js';
import type { World } from '../world.js';
import { NO_ENGAGE_SLOT, assignEngageSlot } from './engagement.js';
import { canAttackTarget, canThreatenTarget, isWithinAttackReach } from './combatRange.js';

/** 按 world.units 原序拆出的存活列表，避免每次索敌重复跳过死亡单位 */
const liveBlue: Unit[] = [];
const liveRed: Unit[] = [];
/** 建筑远少于单位，单独缓存供视野内推家判断 */
const buildingsBlue: Unit[] = [];
const buildingsRed: Unit[] = [];
/** 本帧是否还有存活城堡；无敌方城堡时圈外敌军也纳入，避免沙盒对局原地待命 */
let hasCastleBlue = false;
let hasCastleRed = false;

/**
 * 选敌策略：
 * - 交战中（已够得着）粘性不换火。
 * - 地面：够不着时若有搜索范围内威胁则改火；远距有建筑时跳过「打不到自己」的单位以保推家。
 * - 飞行：非建筑目标一出攻击射程立刻放弃；追建筑时若射程内出现己方可打敌军（含近战地面）则打断改火。
 *   重索时优先锁已进攻击射程的可打敌军，否则再按推家过滤找远敌。
 * - preferAir：射程内空中优先于射程内地面，视野内同理；打地面时射程内出现空中则打断粘性。
 * - preferBuildings：候选里有建筑则锁最近建筑（远距建筑可压过已进射程的单位）；
 *   打非建筑时出现建筑候选则打断；追/打建筑不被附近单位拉开。
 * - 城堡无视索敌距离：圈内无敌军时仍可直接锁上并推家；有城堡时箭塔/单位仍要在圈内。
 *   无敌方城堡（牌型验证混编 / 阵型对拆）则圈外敌军也纳入，否则双方会原地 Idle。
 *
 * 有治疗技能的单位友军优先：全场残血友军先锁并寻路治疗；
 * 无伤员时才锁已进入攻击射程的敌军，否则跟随最近友军，不追圈外远敌、不跨图推城堡。
 *
 * spawnUnit 时按 id 打散了首次索敌倒计时（retargetIn），避免同批出场挤在同一帧全场扫描。
 * 新锁定敌军时立刻分配攻击环槽位；治疗友军不占槽位。
 */
export function updateTargeting(world: World): void {
  collectLiveFactions(world);

  for (const unit of world.units) {
    if (unit.dead) continue;
    // 无攻击能力的建筑不索敌；仍可作为敌军目标被其它单位选中
    if (isBuildingConfig(unit.config) && !canBuildingAttack(unit.config)) continue;

    // 仅用于出生错峰；锁定后不再周期重置
    if (unit.retargetIn > 0) {
      unit.retargetIn--;
      continue;
    }

    // 治疗单位不走敌军粘性/追远敌，避免地面粘性在够不着时把人拖去 Seek
    if (unit.config.heal) {
      updateHealUnitTargeting(world, unit);
      continue;
    }

    const current = world.getUnit(unit.targetId);
    // 敌军粘性：已能出手则咬住；够不着时按空/地规则决定是否打断
    // 不可打目标（如投放炸弹）立即放弃，避免粘性卡住
    if (isAlive(current) && current.faction !== unit.faction && canAttackTarget(unit, current)) {
      // 建筑优先：追/打建筑始终粘住，避免被小兵拉开
      if (unit.config.preferBuildings && isBuildingConfig(current.config)) {
        continue;
      }
      // 建筑优先：正在打单位时候选里出现建筑则打断换火
      if (unit.config.preferBuildings && hasBuildingCandidate(unit)) {
        // fall through
      } else if (isWithinAttackReach(unit, current)) {
        // 对空优先：打地面时射程内出现空中则打断粘性换火
        if (!(unit.config.preferAir && current.config.movementLayer !== 'air' && hasInReachAir(unit))) {
          continue;
        }
      } else if (unit.config.movementLayer === 'air') {
        // 非建筑出距立刻弃；建筑出距仅被射程内可打敌军打断
        if (isBuildingConfig(current.config) && !hasInReachAttackable(unit, current)) {
          continue;
        }
        // fall through
      } else if (!hasInSightEnemyThreat(unit, current)) {
        continue;
      }
    }

    const enemyId = findNearestEnemy(unit);
    if (enemyId !== NO_TARGET) {
      // 重索到同一目标时保留槽位，避免无意义换槽抖路径
      if (enemyId === unit.targetId) continue;
      unit.targetId = enemyId;
      const target = world.getUnit(enemyId);
      unit.engageSlot = target ? assignEngageSlot(unit, target) : NO_ENGAGE_SLOT;
      continue;
    }

    unit.targetId = NO_TARGET;
    unit.engageSlot = NO_ENGAGE_SLOT;
  }
}

/**
 * 治疗单位索敌：全场残血友军优先；无伤员才打射程内敌军；再否则跟随最近友军。
 * 从敌军切到友军时清普攻前摇——结算读 targetId 且不验阵营，否则会误伤友军。
 */
function updateHealUnitTargeting(world: World, unit: Unit): void {
  const current = world.getUnit(unit.targetId);

  // 当前受伤友军仍有效则继续跟着走，避免每帧换最近目标导致抖路径；建筑不可作为治疗寻路目标
  if (isValidInjuredAlly(unit, current)) {
    unit.engageSlot = NO_ENGAGE_SLOT;
    return;
  }

  const injuredId = findNearestInjuredAlly(unit);
  if (injuredId !== NO_TARGET) {
    lockHealAllyTarget(unit, current, injuredId);
    return;
  }

  // 无伤员才打已进入射程的敌军；出距立即放弃，不用粘性迟滞（否则 AI 会改成追击）
  if (
    isAlive(current)
    && current.faction !== unit.faction
    && canAttackTarget(unit, current)
    && isWithinAttackReach(unit, current)
  ) {
    return;
  }

  const enemyId = findNearestInReachEnemy(unit);
  if (enemyId !== NO_TARGET) {
    if (enemyId === unit.targetId) return;
    unit.targetId = enemyId;
    const target = world.getUnit(enemyId);
    unit.engageSlot = target ? assignEngageSlot(unit, target) : NO_ENGAGE_SLOT;
    return;
  }

  // 无近敌则跟上当前友军；没有粘性目标再锁全场最近友军，避免孤立停走
  if (isValidFollowAlly(unit, current)) {
    unit.engageSlot = NO_ENGAGE_SLOT;
    return;
  }

  const followId = findNearestAlly(unit);
  if (followId !== NO_TARGET) {
    lockHealAllyTarget(unit, current, followId);
    return;
  }

  unit.targetId = NO_TARGET;
  unit.engageSlot = NO_ENGAGE_SLOT;
}

/** 切到友军寻路目标：若上一帧锁的是敌军则清普攻前摇，避免结算误伤。 */
function lockHealAllyTarget(unit: Unit, current: Unit | undefined, allyId: number): void {
  if (isAlive(current) && current.faction !== unit.faction) {
    unit.windupLeft = 0;
  }
  unit.targetId = allyId;
  unit.engageSlot = NO_ENGAGE_SLOT;
}

/** 跟随粘性：活着、同阵营、非自身、非建筑（满血也算）。 */
function isValidFollowAlly(unit: Unit, current: Unit | undefined): boolean {
  return (
    isAlive(current)
    && current.faction === unit.faction
    && current.id !== unit.id
    && !isBuildingConfig(current.config)
  );
}

/** 治疗寻路粘性：在跟随条件上再要求未满血、非机械。不做成类型谓词，避免失败时把敌军收窄成 never。 */
function isValidInjuredAlly(unit: Unit, current: Unit | undefined): boolean {
  return (
    isValidFollowAlly(unit, current)
    && !!current
    && !isMechanicalUnit(current.config)
    && current.hp < current.stats.maxHp
  );
}

/** 按 world.units 原序拆阵营，保证等距选 id 时遍历顺序与全场扫描一致。 */
function collectLiveFactions(world: World): void {
  liveBlue.length = 0;
  liveRed.length = 0;
  buildingsBlue.length = 0;
  buildingsRed.length = 0;
  hasCastleBlue = false;
  hasCastleRed = false;
  for (const unit of world.units) {
    if (unit.dead) continue;
    if (unit.faction === Faction.Blue) {
      liveBlue.push(unit);
      if (isBuildingConfig(unit.config)) buildingsBlue.push(unit);
      if (isCastleId(unit.typeId)) hasCastleBlue = true;
    } else {
      liveRed.push(unit);
      if (isBuildingConfig(unit.config)) buildingsRed.push(unit);
      if (isCastleId(unit.typeId)) hasCastleRed = true;
    }
  }
}

/** 对方是否还有可推的城堡；没有时索敌不能只靠视野，否则沙盒对局无人可锁。 */
function enemyHasCastle(unit: Unit): boolean {
  return unit.faction === Faction.Blue ? hasCastleRed : hasCastleBlue;
}

function enemiesOf(unit: Unit): readonly Unit[] {
  return unit.faction === Faction.Blue ? liveRed : liveBlue;
}

function alliesOf(unit: Unit): readonly Unit[] {
  return unit.faction === Faction.Blue ? liveBlue : liveRed;
}

function enemyBuildingsOf(unit: Unit): readonly Unit[] {
  return unit.faction === Faction.Blue ? buildingsRed : buildingsBlue;
}

/**
 * 是否存在「已进入攻击射程且己方可打」的其它敌军（不要求对方能打到自己）。
 * 供飞行单位打断推家粘性，避免贴脸地面兵被推家过滤漏掉。
 */
function hasInReachAttackable(unit: Unit, current: Unit): boolean {
  for (const other of enemiesOf(unit)) {
    if (other.id === current.id) continue;
    if (!canAttackTarget(unit, other)) continue;
    if (isWithinAttackReach(unit, other)) return true;
  }
  return false;
}

/**
 * 地面追击中是否存在「已进入搜索范围」的其它敌军（含推家威胁过滤）。
 * 够不着当前目标时，圈内近敌即可打断粘性，不必等贴进攻击射程。
 */
function hasInSightEnemyThreat(unit: Unit, current: Unit): boolean {
  const sightSq = mul(unit.config.sightRange, unit.config.sightRange);
  const buildingInSight = hasEnemyBuildingInSight(unit, sightSq);

  for (const other of enemiesOf(unit)) {
    if (other.id === current.id) continue;
    if (!isEnemyTargetCandidate(unit, other, buildingInSight)) continue;
    const d = distSq(unit.pos.x, unit.pos.y, other.pos.x, other.pos.y);
    if (d <= sightSq) return true;
  }
  return false;
}

/**
 * 射程内是否存在空中敌军。供 preferAir 打断地面粘性。
 */
function hasInReachAir(unit: Unit): boolean {
  for (const other of enemiesOf(unit)) {
    if (other.config.movementLayer !== 'air') continue;
    if (!canAttackTarget(unit, other)) continue;
    if (isWithinAttackReach(unit, other)) return true;
  }
  return false;
}

/**
 * 是否存在可作为索敌候选的敌方建筑（含圈外城堡）。
 * 供 preferBuildings 打断非建筑粘性，口径与 findNearestEnemy 远敌纳入规则一致。
 */
function hasBuildingCandidate(unit: Unit): boolean {
  const sightSq = mul(unit.config.sightRange, unit.config.sightRange);
  for (const other of enemyBuildingsOf(unit)) {
    if (!canAttackTarget(unit, other)) continue;
    const d = distSq(unit.pos.x, unit.pos.y, other.pos.x, other.pos.y);
    if (d > sightSq && !isCastleId(other.typeId) && enemyHasCastle(unit)) continue;
    return true;
  }
  return false;
}

/**
 * 单次扫敌军：同时维护「最近已进射程」与「最近远敌」。
 * 有近距可打目标时仍优先返回近距，规则与原先三次全扫相同。
 * preferAir 时同一桶内空中优先于地面，同层仍取最近、等距取 id 小。
 * preferBuildings 时同一桶内建筑优先于单位；返回时远距建筑可压过已进射程的单位。
 * 城堡（building_base）无视索敌距离，圈外仍可纳入远敌候选。
 * 无敌方城堡时圈外单位/箭塔同样纳入，保证混编对局能对冲。
 *
 * 这里刻意不用空间哈希：索敌半径覆盖整个场地，按半径查哈希等于把所有格子
 * 都遍历一遍，反而比直接扫单位数组更慢。等以后出现「短视野」兵种再按需切换。
 */
function findNearestEnemy(unit: Unit): number {
  const sightSq = mul(unit.config.sightRange, unit.config.sightRange);
  const buildingInSight = hasEnemyBuildingInSight(unit, sightSq);
  let inReachId = NO_TARGET;
  let inReachDistSq: Fx = 0;
  let inReachAir = false;
  let inReachBuilding = false;
  let farId = NO_TARGET;
  let farDistSq: Fx = 0;
  let farAir = false;
  let farBuilding = false;

  for (const other of enemiesOf(unit)) {
    const d = distSq(unit.pos.x, unit.pos.y, other.pos.x, other.pos.y);
    if (canAttackTarget(unit, other) && isWithinAttackReach(unit, other)) {
      if (isBetterTarget(unit, other, d, inReachId, inReachDistSq, inReachAir, inReachBuilding)) {
        inReachId = other.id;
        inReachDistSq = d;
        inReachAir = other.config.movementLayer === 'air';
        inReachBuilding = isBuildingConfig(other.config);
      }
    }
    if (!isEnemyTargetCandidate(unit, other, buildingInSight)) continue;
    // 城堡无视索敌圈；有城堡可推时箭塔/单位仍要在圈内
    if (d > sightSq && !isCastleId(other.typeId) && enemyHasCastle(unit)) continue;
    if (isBetterTarget(unit, other, d, farId, farDistSq, farAir, farBuilding)) {
      farId = other.id;
      farDistSq = d;
      farAir = other.config.movementLayer === 'air';
      farBuilding = isBuildingConfig(other.config);
    }
  }

  // 建筑优先跨桶：远距建筑压过已进射程的单位，避免贴脸小兵挡住推塔
  if (unit.config.preferBuildings) {
    if (inReachId !== NO_TARGET && inReachBuilding) return inReachId;
    if (farId !== NO_TARGET && farBuilding) return farId;
  }
  return inReachId !== NO_TARGET ? inReachId : farId;
}

/**
 * 同桶比选：preferBuildings 时建筑压过单位，preferAir 时空中压过地面，再比距离，等距取 id 小。
 */
function isBetterTarget(
  unit: Unit,
  candidate: Unit,
  candidateDistSq: Fx,
  bestId: number,
  bestDistSq: Fx,
  bestIsAir: boolean,
  bestIsBuilding: boolean,
): boolean {
  if (bestId === NO_TARGET) return true;
  if (unit.config.preferBuildings) {
    const candidateBuilding = isBuildingConfig(candidate.config);
    if (candidateBuilding !== bestIsBuilding) return candidateBuilding;
  }
  if (unit.config.preferAir) {
    const candidateAir = candidate.config.movementLayer === 'air';
    if (candidateAir !== bestIsAir) return candidateAir;
  }
  if (candidateDistSq !== bestDistSq) return candidateDistSq < bestDistSq;
  return candidate.id < bestId;
}

/**
 * 视野内是否存在敌方建筑。有建筑时进入「威胁过滤」模式，避免被无威胁单位引离推家。
 */
function hasEnemyBuildingInSight(unit: Unit, sightSq: Fx): boolean {
  for (const other of enemyBuildingsOf(unit)) {
    const d = distSq(unit.pos.x, unit.pos.y, other.pos.x, other.pos.y);
    if (d <= sightSq) return true;
  }
  return false;
}

/**
 * 远距索敌候选：必须能打到对方；有敌方建筑在视野时，额外只保留建筑或能威胁到自己的单位。
 * 威胁用 canThreatenTarget（忽略投放炸弹的不可锁定），使炸弹兵与骷髅兵在推家过滤下选敌一致。
 */
function isEnemyTargetCandidate(unit: Unit, other: Unit, buildingInSight: boolean): boolean {
  if (!canAttackTarget(unit, other)) return false;
  if (!buildingInSight) return true;
  return isBuildingConfig(other.config) || canThreatenTarget(other, unit);
}

/** 只扫已进入攻击射程的可打敌军，治疗单位用此避免追远敌。 */
function findNearestInReachEnemy(unit: Unit): number {
  let bestId = NO_TARGET;
  let bestDistSq: Fx = 0;

  for (const other of enemiesOf(unit)) {
    if (!canAttackTarget(unit, other) || !isWithinAttackReach(unit, other)) continue;
    const d = distSq(unit.pos.x, unit.pos.y, other.pos.x, other.pos.y);
    if (bestId === NO_TARGET || d < bestDistSq || (d === bestDistSq && other.id < bestId)) {
      bestId = other.id;
      bestDistSq = d;
    }
  }
  return bestId;
}

/** 全场最近的受伤友军（排除自身、建筑与机械），不受 sightRange 限制。 */
function findNearestInjuredAlly(unit: Unit): number {
  return findNearestAlly(unit, true);
}

/**
 * 全场最近友军（排除自身与建筑）。injuredOnly 时只收可治疗残血（再排除机械）；
 * 否则满血/机械也算，供无伤员时跟随，避免女王孤立停走。
 */
function findNearestAlly(unit: Unit, injuredOnly = false): number {
  let bestId = NO_TARGET;
  let bestDistSq: Fx = 0;

  for (const other of alliesOf(unit)) {
    if (other.id === unit.id) continue;
    if (isBuildingConfig(other.config)) continue;
    if (injuredOnly && isMechanicalUnit(other.config)) continue;
    if (injuredOnly && other.hp >= other.stats.maxHp) continue;
    const d = distSq(unit.pos.x, unit.pos.y, other.pos.x, other.pos.y);
    if (bestId === NO_TARGET || d < bestDistSq || (d === bestDistSq && other.id < bestId)) {
      bestId = other.id;
      bestDistSq = d;
    }
  }
  return bestId;
}
