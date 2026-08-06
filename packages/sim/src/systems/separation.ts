import { type Fx, ONE, div, mul, sqrt } from '../math/fixed.js';
import { ARENA_HEIGHT, ARENA_WIDTH, clampToArena } from '../config/arena.js';
import { MAX_UNIT_RADIUS } from '../config/units.js';
import { SEPARATION_ITERATIONS, SEPARATION_STRENGTH } from '../config/tuning.js';
import { UnitState } from '../entity/unit.js';
import type { World } from '../world.js';

/** 复用的邻居缓冲，避免每帧每单位都新建数组 */
const neighbors: number[] = [];

/**
 * 圆形软碰撞：单位互相挤开而不是硬性阻挡。
 *
 * 硬碰撞在密集队形里极易把单位卡死，王室战争这类游戏一律用软碰撞，
 * 表现上就是「挤过去」而不是「撞墙」。推开的位移按质量反比分配，
 * 所以大体型能把小体型顶开，自己几乎不动。
 */
export function resolveSeparation(world: World): void {
  const units = world.units;
  const grid = world.unitGrid;

  for (let iter = 0; iter < SEPARATION_ITERATIONS; iter++) {
    // 上一轮已经改过位置，每轮都要重建哈希
    grid.clear();
    for (let i = 0; i < units.length; i++) {
      const unit = units[i]!;
      if (unit.dead) continue;
      grid.insert(i, unit.pos.x, unit.pos.y);
      unit.push.x = 0;
      unit.push.y = 0;
    }

    for (let i = 0; i < units.length; i++) {
      const a = units[i]!;
      if (a.dead) continue;
      grid.query(a.pos.x, a.pos.y, a.config.radius + MAX_UNIT_RADIUS, neighbors);

      for (let k = 0; k < neighbors.length; k++) {
        const j = neighbors[k]!;
        // 只处理 i < j 的一半配对，既去重又让遍历顺序完全由下标决定
        if (j <= i) continue;
        const b = units[j]!;
        if (b.dead) continue;

        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const minDist = a.config.radius + b.config.radius;
        const gapSq = mul(dx, dx) + mul(dy, dy);
        if (gapSq >= mul(minDist, minDist)) continue;

        const gap = sqrt(gapSq);
        let nx: Fx;
        let ny: Fx;
        if (gap <= 0) {
          // 两个单位完全重合时没有可用的分离方向，
          // 按 id 派生四个固定方向之一，避免整堆单位被推成一条直线
          const dir = (a.id + b.id) & 3;
          nx = dir === 0 ? ONE : dir === 1 ? -ONE : 0;
          ny = dir === 2 ? ONE : dir === 3 ? -ONE : 0;
        } else {
          nx = div(dx, gap);
          ny = div(dy, gap);
        }

        const correction = mul(minDist - gap, SEPARATION_STRENGTH);
        const totalMass = a.config.mass + b.config.mass;
        const aShare = div(b.config.mass, totalMass);
        const bShare = ONE - aShare;

        a.push.x -= mul(mul(nx, correction), aShare);
        a.push.y -= mul(mul(ny, correction), aShare);
        b.push.x += mul(mul(nx, correction), bShare);
        b.push.y += mul(mul(ny, correction), bShare);
      }
    }

    for (let i = 0; i < units.length; i++) {
      const unit = units[i]!;
      if (unit.dead) continue;
      // 冲刺中不受软碰撞推挤，保证直线冲锋不被挤歪
      if (unit.state === UnitState.Charge) continue;
      unit.pos.x = clampToArena(unit.pos.x + unit.push.x, ARENA_WIDTH, unit.config.radius);
      unit.pos.y = clampToArena(unit.pos.y + unit.push.y, ARENA_HEIGHT, unit.config.radius);
    }
  }
}
