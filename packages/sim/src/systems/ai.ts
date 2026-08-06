import { mul } from '../math/fixed.js';
import { distSq, normalize, turnToward, vec } from '../math/vec2.js';
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
    } else {
      unit.state = UnitState.Seek;
    }

    normalize(desiredFacing, target.pos.x - unit.pos.x, target.pos.y - unit.pos.y);
    if (desiredFacing.x !== 0 || desiredFacing.y !== 0) {
      turnToward(unit.facing, unit.facing, desiredFacing.x, desiredFacing.y, TURN_RATE);
    }
  }
}

/** 停下来时顺手丢掉旧路径，下次重新进入 Seek 会按当时的局面重新算 */
function clearPath(unit: Unit): void {
  unit.path.length = 0;
  unit.pathIndex = 0;
  unit.repathIn = 0;
}
