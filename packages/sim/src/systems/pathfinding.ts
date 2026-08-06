import { mul } from '../math/fixed.js';
import { distSq } from '../math/vec2.js';
import { REPATH_GOAL_TOLERANCE, REPATH_INTERVAL } from '../config/tuning.js';
import { UnitState, isAlive } from '../entity/unit.js';
import type { World } from '../world.js';

/**
 * 给处于 Seek 状态的单位算路。
 *
 * A* 不便宜，所以只在「没路可走 / 间隔到期 / 目标跑远了」三种情况下重算，
 * 平时沿着已有路点走就行。空旷场地下 PathFinder 内部还有一条直连捷径，
 * 实际几乎不会真的进网格搜索。
 */
export function updatePaths(world: World): void {
  const goalToleranceSq = mul(REPATH_GOAL_TOLERANCE, REPATH_GOAL_TOLERANCE);

  for (const unit of world.units) {
    if (unit.dead || unit.state !== UnitState.Seek) continue;

    const target = world.getUnit(unit.targetId);
    if (!isAlive(target)) continue;

    if (unit.repathIn > 0) unit.repathIn--;

    const goalMoved =
      distSq(unit.pathGoal.x, unit.pathGoal.y, target.pos.x, target.pos.y) > goalToleranceSq;
    const pathExhausted = unit.pathIndex >= unit.path.length;
    if (!pathExhausted && unit.repathIn > 0 && !goalMoved) continue;

    const found = world.pathFinder.findPath(
      unit.pos.x,
      unit.pos.y,
      target.pos.x,
      target.pos.y,
      unit.path,
    );
    unit.pathIndex = 0;
    if (!found) unit.path.length = 0;
    unit.pathGoal.x = target.pos.x;
    unit.pathGoal.y = target.pos.y;
    unit.repathIn = REPATH_INTERVAL;
  }
}
