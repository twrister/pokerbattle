import { type Fx, div, mul } from '../math/fixed.js';
import { lengthOf } from '../math/vec2.js';
import { ARENA_HEIGHT, ARENA_WIDTH, clampToArena } from '../config/arena.js';
import { isBuildingConfig } from '../config/units.js';
import { TICK_RATE_FX, WAYPOINT_ARRIVE_DIST } from '../config/tuning.js';
import { UnitState } from '../entity/unit.js';
import type { World } from '../world.js';

/**
 * 沿路径推进位置。
 *
 * 一个 tick 的位移可能跨过好几个路点（路径被拉直后相邻拐点可以很近），
 * 所以用「剩余步长」循环消耗，而不是一帧只走一个路点，否则转角处会明显减速。
 */
export function updateMovement(world: World): void {
  for (const unit of world.units) {
    if (unit.dead || unit.state !== UnitState.Seek) continue;
    if (isBuildingConfig(unit.config)) continue;
    // 普攻/技能前摇期间站定，不能边走边抬手（冲刺走 cavalry 系统，不会进 Seek）
    if (
      unit.windupLeft > 0
      || unit.healWindupLeft > 0
      || unit.summonWindupLeft > 0
      || unit.detonateWindupLeft > 0
    ) {
      continue;
    }

    let remaining: Fx = div(unit.stats.moveSpeed, TICK_RATE_FX);

    while (remaining > 0 && unit.pathIndex < unit.path.length) {
      const waypoint = unit.path[unit.pathIndex]!;
      const dx = waypoint.x - unit.pos.x;
      const dy = waypoint.y - unit.pos.y;
      const gap = lengthOf(dx, dy);

      if (gap <= WAYPOINT_ARRIVE_DIST) {
        unit.pathIndex++;
        continue;
      }
      if (gap <= remaining) {
        unit.pos.x = waypoint.x;
        unit.pos.y = waypoint.y;
        remaining -= gap;
        unit.pathIndex++;
        continue;
      }
      unit.pos.x += mul(div(dx, gap), remaining);
      unit.pos.y += mul(div(dy, gap), remaining);
      remaining = 0;
    }

    unit.pos.x = clampToArena(unit.pos.x, ARENA_WIDTH, unit.config.radius);
    unit.pos.y = clampToArena(unit.pos.y, ARENA_HEIGHT, unit.config.radius);
  }
}
