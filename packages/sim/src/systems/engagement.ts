import { type Fx, ONE, mul } from '../math/fixed.js';
import { type Vec2, set } from '../math/vec2.js';
import { ARENA_HEIGHT, ARENA_WIDTH, clampToArena } from '../config/arena.js';
import {
  ENGAGEMENT_SLOT_COUNT,
  ENGAGEMENT_SLOT_INSET,
} from '../config/tuning.js';
import { isBuildingConfig } from '../config/units.js';
import type { Unit } from '../entity/unit.js';
import { computeBuildingEngageGoal } from './combatRange.js';

/** ≈ 1/√2，用于对角槽位方向；配置期常量，tick 内不再出现浮点 */
const INV_SQRT2: Fx = 46341; // fromFloat(0.707107) ≈ 46341

/**
 * 攻击环八方向（已归一化）。索引即槽位编号，顺序绕一圈，
 * 方便用 id 做确定性邻位偏移而不依赖 atan2。
 */
const SLOT_DIRS: ReadonlyArray<Readonly<Vec2>> = [
  { x: 0, y: ONE }, // 0: +Y
  { x: INV_SQRT2, y: INV_SQRT2 }, // 1
  { x: ONE, y: 0 }, // 2: +X
  { x: INV_SQRT2, y: -INV_SQRT2 }, // 3
  { x: 0, y: -ONE }, // 4: -Y
  { x: -INV_SQRT2, y: -INV_SQRT2 }, // 5
  { x: -ONE, y: 0 }, // 6: -X
  { x: -INV_SQRT2, y: INV_SQRT2 }, // 7
];

/** 无有效槽位时的占位，索敌清空目标时写回 */
export const NO_ENGAGE_SLOT = -1;

/**
 * 邻位槽是否相对来向翻到了左右对侧（例如西南来却分到东南槽）。
 * 正南/正北槽 dir.x=0，不算翻侧。
 */
function crossesApproachSide(slot: number, dx: Fx): boolean {
  if (dx === 0) return false;
  const sx = SLOT_DIRS[slot]!.x;
  if (sx === 0) return false;
  return (dx < 0 && sx > 0) || (dx > 0 && sx < 0);
}

/**
 * 按攻击者相对目标的来向选最近的八方向槽位，
 * 再用 id 在邻位做确定性偏移，让同侧围攻自然散开。
 * 邻位若翻到来向对侧则改走反向邻位（仍对侧则退回主槽），避免左侧单位去右侧站位。
 */
export function assignEngageSlot(attacker: Unit, target: Unit): number {
  const dx = attacker.pos.x - target.pos.x;
  const dy = attacker.pos.y - target.pos.y;
  let best = 0;
  let bestDot: Fx = mul(SLOT_DIRS[0]!.x, dx) + mul(SLOT_DIRS[0]!.y, dy);

  for (let i = 1; i < ENGAGEMENT_SLOT_COUNT; i++) {
    const dir = SLOT_DIRS[i]!;
    const dot = mul(dir.x, dx) + mul(dir.y, dy);
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }

  // id % 3 → {-1, 0, +1}，把同来向的若干单位摊到相邻槽
  const offset = (attacker.id % 3) - 1;
  let slot = (best + offset + ENGAGEMENT_SLOT_COUNT) % ENGAGEMENT_SLOT_COUNT;
  if (crossesApproachSide(slot, dx)) {
    const alt = (best - offset + ENGAGEMENT_SLOT_COUNT) % ENGAGEMENT_SLOT_COUNT;
    slot = crossesApproachSide(alt, dx) ? best : alt;
  }
  return slot;
}

/**
 * 把目标中心换成攻击环上的槽位坐标。
 * 默认停在「略进入射程」处；射程极短时退到碰撞外缘贴边，但绝不能抬到进入射程之外
 * （否则近战打远程英雄会永远 Seek：对方站远处射击，自己停在环上却够不着）。
 */
export function computeEngageGoal(attacker: Unit, target: Unit, out: Vec2): Vec2 {
  const slot =
    attacker.engageSlot >= 0 && attacker.engageSlot < ENGAGEMENT_SLOT_COUNT
      ? attacker.engageSlot
      : 0;
  const dir = SLOT_DIRS[slot]!;

  // 建筑占地是方形：槽位放在扩大 AABB 外缘，避免对角目标点落进 footprint
  if (isBuildingConfig(target.config)) {
    return computeBuildingEngageGoal(attacker, target, dir, out);
  }

  const contact = attacker.config.radius + target.config.radius;
  const reach = attacker.stats.range + contact;
  // 远端停在射程内侧；inset 吃掉全部近战 range 时贴碰撞外缘，保证仍能进 Attack
  let ring = reach - ENGAGEMENT_SLOT_INSET;
  if (ring < contact) ring = contact;

  const x = target.pos.x + mul(dir.x, ring);
  const y = target.pos.y + mul(dir.y, ring);
  return set(
    out,
    clampToArena(x, ARENA_WIDTH, attacker.config.radius),
    clampToArena(y, ARENA_HEIGHT, attacker.config.radius),
  );
}
