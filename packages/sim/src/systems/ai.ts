import { mul } from '../math/fixed.js';
import { copy, distSq, normalize, turnToward, vec } from '../math/vec2.js';
import { ATTACK_EXIT_HYSTERESIS, TURN_RATE } from '../config/tuning.js';
import { NO_TARGET, type Unit, UnitState, isAlive } from '../entity/unit.js';
import type { World } from '../world.js';
import { NO_ENGAGE_SLOT } from './engagement.js';

const desiredFacing = vec();

/**
 * 单位行为决策。
 *
 * 只负责「决定这一帧要干什么」并写回状态与朝向，具体的移动、伤害结算
 * 分别由后面的系统执行。之后要换成行为树，替换这个文件即可，
 * 数据结构和其它系统都不用动。
 *
 * Attack 使用进入/退出双阈值：进来用正常射程，退出多留一段迟滞，
 * 避免被软碰撞轻微挤开后立刻改回 Seek 再挤回来。
 *
 * 治疗单位锁友军时只 Seek 到治疗半径内再 Idle，绝不 Attack/Charge，
 * 避免把友军当成普攻目标。
 */
export function updateAi(world: World): void {
  for (const unit of world.units) {
    if (unit.dead) continue;

    // 冲刺中锁定状态，只把朝向对齐冲刺方向
    if (unit.state === UnitState.Charge) {
      if (unit.chargeDir.x !== 0 || unit.chargeDir.y !== 0) {
        turnToward(unit.facing, unit.facing, unit.chargeDir.x, unit.chargeDir.y, TURN_RATE);
      }
      continue;
    }

    // 英雄技能前摇期间站定蓄力；治疗会额外朝锁定的受疗友军转向
    if (unit.healWindupLeft > 0 || unit.summonWindupLeft > 0) {
      unit.state = UnitState.Idle;
      clearPath(unit);
      const aim = world.getUnit(unit.healCastTargetId) ?? world.getUnit(unit.targetId);
      if (isAlive(aim)) {
        normalize(desiredFacing, aim.pos.x - unit.pos.x, aim.pos.y - unit.pos.y);
        if (desiredFacing.x !== 0 || desiredFacing.y !== 0) {
          turnToward(unit.facing, unit.facing, desiredFacing.x, desiredFacing.y, TURN_RATE);
        }
      }
      continue;
    }

    const target = world.getUnit(unit.targetId);
    if (!isAlive(target)) {
      // 场上没有可打/可治的目标就原地待命，不做任何游走
      unit.targetId = NO_TARGET;
      unit.engageSlot = NO_ENGAGE_SLOT;
      unit.state = UnitState.Idle;
      clearPath(unit);
      continue;
    }

    // 友军治疗目标：只靠近，不进入攻击态
    if (target.faction === unit.faction) {
      updateHealSeek(unit, target);
      continue;
    }

    // 射程按边缘到边缘算，所以要把双方的碰撞半径都加上，
    // 否则大体型单位会因为半径撑开而永远够不到对方
    const contact = unit.config.radius + target.config.radius;
    const enterReach = unit.stats.range + contact;
    const exitReach = enterReach + ATTACK_EXIT_HYSTERESIS;
    const gapSq = distSq(unit.pos.x, unit.pos.y, target.pos.x, target.pos.y);

    const inEnter = gapSq <= mul(enterReach, enterReach);
    const inExit = gapSq <= mul(exitReach, exitReach);

    if (unit.state === UnitState.Attack ? inExit : inEnter) {
      unit.state = UnitState.Attack;
      clearPath(unit);
      normalize(desiredFacing, target.pos.x - unit.pos.x, target.pos.y - unit.pos.y);
    } else if (tryStartCharge(unit, target, gapSq)) {
      copy(desiredFacing, unit.chargeDir);
    } else {
      unit.state = UnitState.Seek;
      normalize(desiredFacing, target.pos.x - unit.pos.x, target.pos.y - unit.pos.y);
    }

    if (desiredFacing.x !== 0 || desiredFacing.y !== 0) {
      turnToward(unit.facing, unit.facing, desiredFacing.x, desiredFacing.y, TURN_RATE);
    }
  }
}

/**
 * 治疗寻路：进入 heal.targetRange 后站定，让 heroSkills 出手；
 * 够不着则 Seek。距离判定与选疗圆心一致（中心距，不含碰撞半径）。
 */
function updateHealSeek(unit: Unit, ally: Unit): void {
  const heal = unit.config.heal;
  if (!heal) {
    unit.targetId = NO_TARGET;
    unit.engageSlot = NO_ENGAGE_SLOT;
    unit.state = UnitState.Idle;
    clearPath(unit);
    return;
  }

  const reachSq = mul(heal.targetRange, heal.targetRange);
  const gapSq = distSq(unit.pos.x, unit.pos.y, ally.pos.x, ally.pos.y);
  normalize(desiredFacing, ally.pos.x - unit.pos.x, ally.pos.y - unit.pos.y);

  if (gapSq <= reachSq) {
    unit.state = UnitState.Idle;
    clearPath(unit);
  } else {
    unit.state = UnitState.Seek;
  }

  if (desiredFacing.x !== 0 || desiredFacing.y !== 0) {
    turnToward(unit.facing, unit.facing, desiredFacing.x, desiredFacing.y, TURN_RATE);
  }
}

/**
 * CD 就绪、非普攻前摇、目标中心距落在触发窗时进入冲刺（先原地前摇再起动）。
 * 返回 true 表示本帧已切入 Charge。
 */
function tryStartCharge(unit: Unit, target: Unit, gapSq: ReturnType<typeof distSq>): boolean {
  const charge = unit.config.charge;
  if (!charge) return false;
  // 冲刺是地面近战技，不对空中单位起手
  if (target.config.movementLayer === 'air') return false;
  if (unit.chargeCooldown > 0) return false;
  if (unit.windupLeft > 0 || unit.healWindupLeft > 0 || unit.summonWindupLeft > 0) return false;

  const minSq = mul(charge.triggerMin, charge.triggerMin);
  const maxSq = mul(charge.triggerMax, charge.triggerMax);
  if (gapSq < minSq || gapSq > maxSq) return false;

  normalize(desiredFacing, target.pos.x - unit.pos.x, target.pos.y - unit.pos.y);
  if (desiredFacing.x === 0 && desiredFacing.y === 0) return false;

  // 方向与路程在起手前锁定；前摇期间站定，由 cavalry 系统倒计时后再位移
  unit.state = UnitState.Charge;
  copy(unit.chargeDir, desiredFacing);
  unit.chargeWindupLeft = charge.windup;
  unit.chargeRemaining = charge.distance;
  unit.chargeCooldown = charge.cooldown;
  unit.chargeHits.length = 0;
  unit.windupLeft = 0;
  clearPath(unit);
  return true;
}

/** 停下来时顺手丢掉旧路径，下次重新进入 Seek 会按当时的局面重新算 */
function clearPath(unit: Unit): void {
  unit.path.length = 0;
  unit.pathIndex = 0;
  unit.repathIn = 0;
}
