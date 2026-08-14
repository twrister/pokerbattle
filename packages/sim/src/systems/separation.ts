import { type Fx, ONE, div, fromFloat, mul, sqrt } from '../math/fixed.js';
import { lengthOf } from '../math/vec2.js';
import { ARENA_HEIGHT, ARENA_WIDTH, clampToArena } from '../config/arena.js';
import { MAX_UNIT_RADIUS, isBuildingConfig } from '../config/units.js';
import { evictionDeltaOutOfAabb } from '../nav/buildingEvict.js';
import {
  ATTACK_PUSH_DEEP_RATIO,
  ATTACK_PUSH_SCALE,
  PUSH_MAX_MOVE_RATIO,
  SEPARATION_ITERATIONS,
  SEPARATION_STRENGTH,
  TICK_RATE_FX,
} from '../config/tuning.js';
import { UnitState, type Unit } from '../entity/unit.js';
import type { World } from '../world.js';

/** 复用的邻居缓冲，避免每帧每单位都新建数组 */
const neighbors: number[] = [];
/** 本 tick 建筑下标，两轮分离迭代共用，避免每轮再扫全场认建筑 */
const buildingIndices: number[] = [];

/**
 * 圆形软碰撞：单位互相挤开而不是硬性阻挡。
 *
 * 硬碰撞在密集队形里极易把单位卡死，王室战争这类游戏一律用软碰撞，
 * 表现上就是「挤过去」而不是「撞墙」。推开的位移按质量反比分配，
 * 所以大体型能把小体型顶开，自己几乎不动。
 *
 * Attack 状态下的浅层重叠会被弱化推挤，减少站定输出被弹飞；
 * 深层重叠仍全量解开。单 tick 推挤位移还有上限，避免多邻居叠加瞬移。
 *
 * 建筑是方形占地：在圆-圆循环前先做圆-AABB 解叠，建筑本身不动。
 */
export function resolveSeparation(world: World): void {
  const units = world.units;
  const grid = world.unitGrid;
  collectBuildingIndices(units);

  for (let iter = 0; iter < SEPARATION_ITERATIONS; iter++) {
    // 上一轮已经改过位置，每轮都要重建哈希；建筑不入哈希
    grid.clear();
    for (let i = 0; i < units.length; i++) {
      const unit = units[i]!;
      if (unit.dead) continue;
      unit.push.x = 0;
      unit.push.y = 0;
      if (isBuildingConfig(unit.config)) continue;
      grid.insert(i, unit.pos.x, unit.pos.y);
    }

    // 先把地面单位推出建筑 AABB，再解单位间圆-圆重叠
    resolveBuildingSeparation(world);

    for (let i = 0; i < units.length; i++) {
      const a = units[i]!;
      if (a.dead || isBuildingConfig(a.config)) continue;
      grid.query(a.pos.x, a.pos.y, a.config.radius + MAX_UNIT_RADIUS, neighbors);

      for (let k = 0; k < neighbors.length; k++) {
        const j = neighbors[k]!;
        // 只处理 i < j 的一半配对，既去重又让遍历顺序完全由下标决定
        if (j <= i) continue;
        const b = units[j]!;
        if (b.dead || isBuildingConfig(b.config)) continue;
        // 空中与地面单位处于不同移动层，双方都不会被彼此顶开。
        if (a.config.movementLayer !== b.config.movementLayer) continue;

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
      if (isBuildingConfig(unit.config)) continue;
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
  world.markUnitGridDirty();
}

/**
 * 圆 vs 建筑 AABB：把单位中心夹到矩形得最近点，穿透则沿法线推出单位。
 * 建筑侧位移恒为 0；空中单位不受阻挡。
 */
/** 按 world.units 原序收集存活建筑，保证推出顺序与原先双重循环一致。 */
function collectBuildingIndices(units: readonly Unit[]): void {
  buildingIndices.length = 0;
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    if (unit.dead || !isBuildingConfig(unit.config)) continue;
    buildingIndices.push(i);
  }
}

function resolveBuildingSeparation(world: World): void {
  const units = world.units;
  for (let b = 0; b < buildingIndices.length; b++) {
    const building = units[buildingIndices[b]!]!;
    if (building.dead || !isBuildingConfig(building.config)) continue;

    const half = fromFloat(building.config.footprint / 2);
    const minX = building.pos.x - half;
    const maxX = building.pos.x + half;
    const minY = building.pos.y - half;
    const maxY = building.pos.y + half;

    for (let ui = 0; ui < units.length; ui++) {
      const unit = units[ui]!;
      if (unit.dead || isBuildingConfig(unit.config)) continue;
      if (unit.config.movementLayer === 'air') continue;
      if (unit.state === UnitState.Charge) continue;

      pushUnitOutOfAabb(unit, minX, minY, maxX, maxY);
    }
  }
}

/** 将单位圆推出半开 AABB；完全在外则不动。 */
function pushUnitOutOfAabb(unit: Unit, minX: Fx, minY: Fx, maxX: Fx, maxY: Fx): void {
  const cx = unit.pos.x;
  const cy = unit.pos.y;
  // 最近点 = clamp 到矩形（开区间内侧用 max-epsilon 没必要，闭边即可）
  const closestX = cx < minX ? minX : cx > maxX ? maxX : cx;
  const closestY = cy < minY ? minY : cy > maxY ? maxY : cy;
  const dx = cx - closestX;
  const dy = cy - closestY;
  const r = unit.config.radius;
  const gapSq = mul(dx, dx) + mul(dy, dy);

  // 圆心在矩形内部：墙感知挤出，避免贴边最短轴被场地边界顶回
  if (dx === 0 && dy === 0 && cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
    const delta = evictionDeltaOutOfAabb(cx, cy, r, minX, minY, maxX, maxY);
    unit.push.x += delta.dx;
    unit.push.y += delta.dy;
    return;
  }

  if (gapSq >= mul(r, r)) return;
  const gap = sqrt(gapSq);
  if (gap <= 0) return;
  const penetration = r - gap;
  const nx = div(dx, gap);
  const ny = div(dy, gap);
  // 建筑解叠用全量推出，避免单位慢慢钻进墙里
  unit.push.x += mul(nx, penetration);
  unit.push.y += mul(ny, penetration);
}
