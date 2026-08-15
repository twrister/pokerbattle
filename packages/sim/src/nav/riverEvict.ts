import { riverBlockedRects } from '../config/arenaTerrain.js';
import { ARENA_HEIGHT, ARENA_WIDTH, clampToArena } from '../config/arena.js';
import { isBuildingConfig } from '../config/units.js';
import { type Unit } from '../entity/unit.js';
import { type Fx, EPSILON, fromFloat } from '../math/fixed.js';
import { evictionDeltaOutOfAabb } from './buildingEvict.js';
import type { NavGrid } from './grid.js';

/**
 * 地面单位圆心是否踩在 Nav 障碍上。
 * 空中单位飞越河道；沙盒没有障碍时短路，避免误用河道配置矩形。
 */
export function isGroundBlockedAt(nav: NavGrid, unit: Unit, x: Fx, y: Fx): boolean {
  if (unit.config.movementLayer === 'air') return false;
  if (!nav.hasObstacles) return false;
  return nav.isBlockedAt(x, y);
}

/**
 * 把地面单位圆心推出河道。
 *
 * 河道只写入了 Nav 格，没有建筑那样的物理 AABB；软推挤、阵型溢出、冲刺
 * 都能把圆心送进河心。河宽 ≥ 2 时周围全是障碍格，A* 无法展开，表现为卡死。
 * 只用「圆心是否在河段内」判断，岸边交战不被半径扩大盒推离水线。
 */
export function evictUnitFromRiver(unit: Unit, nav: NavGrid): boolean {
  if (unit.dead || isBuildingConfig(unit.config)) return false;
  if (unit.config.movementLayer === 'air') return false;
  if (!nav.hasObstacles) return false;
  if (!nav.isBlockedAt(unit.pos.x, unit.pos.y)) return false;

  let moved = false;
  const rects = riverBlockedRects();
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]!;
    // EPSILON：半开河段下沿恰好落在阻挡格线上，推到格线外才算离开 Nav 障碍
    const delta = evictionDeltaOutOfAabb(
      unit.pos.x,
      unit.pos.y,
      EPSILON,
      fromFloat(rect.minX),
      fromFloat(rect.minY),
      fromFloat(rect.maxX),
      fromFloat(rect.maxY),
    );
    if (delta.dx === 0 && delta.dy === 0) continue;
    unit.pos.x = clampToArena(unit.pos.x + delta.dx, ARENA_WIDTH, unit.config.radius);
    unit.pos.y = clampToArena(unit.pos.y + delta.dy, ARENA_HEIGHT, unit.config.radius);
    moved = true;
  }
  return moved;
}
