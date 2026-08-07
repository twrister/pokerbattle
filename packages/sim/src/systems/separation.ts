import { type Fx, ONE, div, mul, sqrt } from '../math/fixed.js';
import { lengthOf } from '../math/vec2.js';
import { ARENA_HEIGHT, ARENA_WIDTH, clampToArena } from '../config/arena.js';
import { MAX_UNIT_RADIUS } from '../config/units.js';
import {
  ATTACK_PUSH_DEEP_RATIO,
  ATTACK_PUSH_SCALE,
  PUSH_MAX_MOVE_RATIO,
  SEPARATION_ITERATIONS,
  SEPARATION_STRENGTH,
  TICK_RATE_FX,
} from '../config/tuning.js';
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
 *
 * Attack 状态下的浅层重叠会被弱化推挤，减少站定输出被弹飞；
 * 深层重叠仍全量解开。单 tick 推挤位移还有上限，避免多邻居叠加瞬移。
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

        const penetration = minDist - gap;
        let strength = SEPARATION_STRENGTH;
        // 任一方在 Attack 且重叠尚浅：削弱推挤，优先保住输出站位
        if (
          (a.state === UnitState.Attack || b.state === UnitState.Attack) &&
          penetration < mul(minDist, ATTACK_PUSH_DEEP_RATIO)
        ) {
          strength = mul(strength, ATTACK_PUSH_SCALE);
        }

        const correction = mul(penetration, strength);
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

      // 多邻居累加后可能超大，按本 tick 移动能力裁剪，防止被弹飞
      const pushLen = lengthOf(unit.push.x, unit.push.y);
      const maxPush = mul(div(unit.stats.moveSpeed, TICK_RATE_FX), PUSH_MAX_MOVE_RATIO);
      if (pushLen > maxPush && pushLen > 0) {
        const scale = div(maxPush, pushLen);
        unit.push.x = mul(unit.push.x, scale);
        unit.push.y = mul(unit.push.y, scale);
      }

      unit.pos.x = clampToArena(unit.pos.x + unit.push.x, ARENA_WIDTH, unit.config.radius);
      unit.pos.y = clampToArena(unit.pos.y + unit.push.y, ARENA_HEIGHT, unit.config.radius);
    }
  }
}
