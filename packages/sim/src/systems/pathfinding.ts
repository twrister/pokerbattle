import { mul } from '../math/fixed.js';
import { distSq, set, vec } from '../math/vec2.js';
import { ARENA_HEIGHT, ARENA_WIDTH, clampToArena } from '../config/arena.js';
import { isBuildingConfig } from '../config/units.js';
import { REPATH_GOAL_TOLERANCE, REPATH_INTERVAL } from '../config/tuning.js';
import { UnitState, isAlive } from '../entity/unit.js';
import type { World } from '../world.js';
import { computeEngageGoal } from './engagement.js';

/** 复用缓冲，避免每帧为每个 Seek 单位分配临时 Vec2 */
const engageGoal = vec();

/**
 * 给处于 Seek 状态的单位算路。
 *
 * 敌军终点是攻击环槽位；治疗寻路则直奔友军位置，由 AI 在治疗半径内停步。
 * A* 不便宜，所以只在「没路可走 / 间隔到期 / 槽位目标跑远了」三种情况下重算；
 * 空旷场地下 PathFinder 内部还有一条直连捷径，实际几乎不会真的进网格搜索。
 */
export function updatePaths(world: World): void {
  const goalToleranceSq = mul(REPATH_GOAL_TOLERANCE, REPATH_GOAL_TOLERANCE);

  for (const unit of world.units) {
    if (unit.dead || unit.state !== UnitState.Seek) continue;
    if (isBuildingConfig(unit.config)) continue;

    const target = world.getUnit(unit.targetId);
    if (!isAlive(target)) continue;

    if (unit.repathIn > 0) unit.repathIn--;

    // 治疗接近友军：目标中心即可，不走攻击环
    if (unit.config.heal && target.faction === unit.faction) {
      set(
        engageGoal,
        clampToArena(target.pos.x, ARENA_WIDTH, unit.config.radius),
        clampToArena(target.pos.y, ARENA_HEIGHT, unit.config.radius),
      );
    } else {
      computeEngageGoal(unit, target, engageGoal);
    }

    const goalMoved =
      distSq(unit.pathGoal.x, unit.pathGoal.y, engageGoal.x, engageGoal.y) > goalToleranceSq;
    const pathExhausted = unit.pathIndex >= unit.path.length;

    // 空军不受河道和建筑导航阻挡，直接飞向交战目标。
    if (unit.config.movementLayer === 'air') {
      if (!pathExhausted && unit.repathIn > 0 && !goalMoved) continue;
      unit.path.length = 0;
      unit.path.push(vec(engageGoal.x, engageGoal.y));
      unit.pathIndex = 0;
      unit.pathGoal.x = engageGoal.x;
      unit.pathGoal.y = engageGoal.y;
      unit.repathIn = REPATH_INTERVAL;
      continue;
    }

    if (!pathExhausted && unit.repathIn > 0 && !goalMoved) continue;

    const found = world.pathFinder.findPath(
      unit.pos.x,
      unit.pos.y,
      engageGoal.x,
      engageGoal.y,
      unit.path,
    );
    unit.pathIndex = 0;
    if (!found) unit.path.length = 0;
    unit.pathGoal.x = engageGoal.x;
    unit.pathGoal.y = engageGoal.y;
    unit.repathIn = REPATH_INTERVAL;
  }
}
