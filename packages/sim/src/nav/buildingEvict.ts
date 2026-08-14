import { type Fx, abs } from '../math/fixed.js';
import { ARENA_HEIGHT, ARENA_WIDTH, clampToArena } from '../config/arena.js';

export interface EvictionDelta {
  dx: Fx;
  dy: Fx;
}

/**
 * 圆心与建筑 AABB 重叠时，计算能离开占地且不被场地边界顶回的轴向位移。
 *
 * 贴墙建筑（主堡贴底/顶、箭塔贴侧墙）上，最短轴常指向场外；
 * 推出后再 clampToArena 会把单位顶回 AABB，表现为卡在建筑里。
 * 四向候选先夹回场地，丢掉夹完仍重叠的方向，剩余里走最短位移；
 * 等距时左右优先于上下，与旧挤出顺序一致。
 */
export function evictionDeltaOutOfAabb(
  cx: Fx,
  cy: Fx,
  radius: Fx,
  minX: Fx,
  minY: Fx,
  maxX: Fx,
  maxY: Fx,
): EvictionDelta {
  const left = minX - radius;
  const right = maxX + radius;
  const bottom = minY - radius;
  const top = maxY + radius;
  // 贴边视为已在外，与 evictUnitsFromBuilding 的开区间判断一致
  if (cx <= left || cx >= right || cy <= bottom || cy >= top) {
    return { dx: 0, dy: 0 };
  }

  const leftX = clampToArena(left, ARENA_WIDTH, radius);
  const rightX = clampToArena(right, ARENA_WIDTH, radius);
  const bottomY = clampToArena(bottom, ARENA_HEIGHT, radius);
  const topY = clampToArena(top, ARENA_HEIGHT, radius);

  let bestDx = 0;
  let bestDy = 0;
  let bestDist = 0;
  let found = false;

  const tryCandidate = (nx: Fx, ny: Fx): void => {
    if (overlapsExpanded(nx, ny, left, right, bottom, top)) return;
    const dx = nx - cx;
    const dy = ny - cy;
    const dist = abs(dx) + abs(dy);
    // 先左右再上下，严格小于才替换，等距保留先写入的方向
    if (!found || dist < bestDist) {
      found = true;
      bestDist = dist;
      bestDx = dx;
      bestDy = dy;
    }
  };

  tryCandidate(leftX, cy);
  tryCandidate(rightX, cy);
  tryCandidate(cx, bottomY);
  tryCandidate(cx, topY);

  if (found) return { dx: bestDx, dy: bestDy };

  // 四面都被墙堵住时退回旧最短轴，避免完全不动
  return shortestAxisDelta(cx, cy, left, right, bottom, top);
}

/** 圆心是否仍深入扩大盒内部（贴边不算）。 */
function overlapsExpanded(
  x: Fx,
  y: Fx,
  left: Fx,
  right: Fx,
  bottom: Fx,
  top: Fx,
): boolean {
  return x > left && x < right && y > bottom && y < top;
}

/** 不考虑场地边界的旧最短轴位移，仅作四面皆堵时的兜底。 */
function shortestAxisDelta(
  cx: Fx,
  cy: Fx,
  left: Fx,
  right: Fx,
  bottom: Fx,
  top: Fx,
): EvictionDelta {
  const distLeft = cx - left;
  const distRight = right - cx;
  const distBottom = cy - bottom;
  const distTop = top - cy;
  if (distLeft <= distRight && distLeft <= distBottom && distLeft <= distTop) {
    return { dx: left - cx, dy: 0 };
  }
  if (distRight <= distBottom && distRight <= distTop) {
    return { dx: right - cx, dy: 0 };
  }
  if (distBottom <= distTop) {
    return { dx: 0, dy: bottom - cy };
  }
  return { dx: 0, dy: top - cy };
}
