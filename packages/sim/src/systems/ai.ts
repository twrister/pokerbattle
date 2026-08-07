import { mul } from '../math/fixed.js';
import { copy, distSq, normalize, turnToward, vec } from '../math/vec2.js';
import { TURN_RATE } from '../config/tuning.js';
import { NO_TARGET, type Unit, UnitState, isAlive } from '../entity/unit.js';
import type { World } from '../world.js';

const desiredFacing = vec();

/**
 * 单位行为决策。
 *
 * 只负责「决定这一帧要干什么」并写回状态与朝向，具体的移动、伤害结算
 * 分别由后面的系统执行。之后要换成行为树，替换这个文件即可，
 * 数据结构和其它系统都不用动。
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

    const target = world.getUnit(unit.targetId);
    if (!isAlive(target)) {
      // 场上没有可打的目标就原地待命，不做任何游走
      unit.targetId = NO_TARGET;
      unit.state = UnitState.Idle;
      clearPath(unit);
      continue;
    }

    // 射程按边缘到边缘算，所以要把双方的碰撞半径都加上，
    // 否则大体型单位会因为半径撑开而永远够不到对方
    const reach = unit.stats.range + unit.config.radius + target.config.radius;
    const gapSq = distSq(unit.pos.x, unit.pos.y, target.pos.x, target.pos.y);

    if (gapSq <= mul(reach, reach)) {
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
 * CD 就绪、非普攻前摇、目标中心距落在触发窗时进入冲刺（先原地前摇再起动）。
 * 返回 true 表示本帧已切入 Charge。
 */
function tryStartCharge(unit: Unit, target: Unit, gapSq: ReturnType<typeof distSq>): boolean {
  const charge = unit.config.charge;
  if (!charge) return false;
  if (unit.chargeCooldown > 0) return false;
  if (unit.windupLeft > 0) return false;

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
