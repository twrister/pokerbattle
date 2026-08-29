import { type Fx, fromFloat, mul } from '../math/fixed.js';
import { distSq } from '../math/vec2.js';
import { isBuildingConfig } from '../config/units.js';
import { type Unit, UnitState, applyBombDamage, isAlive } from '../entity/unit.js';
import type { World } from '../world.js';
import { distSqToBuildingFootprint } from './combatRange.js';

/** 复用邻居缓冲，避免每帧分配 */
const neighbors: number[] = [];

/**
 * 炸弹兵自爆：接近目标后点燃引信，走完引爆；中途死亡则当帧立即爆炸。
 * 只伤地面敌军，空中单位免疫爆炸伤害。
 */
export function updateDetonate(world: World): void {
  world.ensureUnitGrid();
  for (const unit of world.units) {
    const detonate = unit.config.detonate;
    if (!detonate || unit.detonated) continue;

    // 中途死亡（含引信中被击杀）立即爆炸，不等 cleanup 删掉尸体
    if (unit.hp <= 0) {
      resolveDetonate(world, unit);
      continue;
    }

    if (unit.detonateWindupLeft > 0) {
      unit.detonateWindupLeft -= world.unitTimeScale;
      if (unit.detonateWindupLeft <= 0) {
        unit.detonateWindupLeft = 0;
        resolveDetonate(world, unit);
      }
      continue;
    }

    // 贴身进入 Attack 后才点引信，期间站定由 ai / movement 拦截
    if (unit.state !== UnitState.Attack) continue;
    unit.detonateWindupLeft = detonate.fuse;
    unit.path.length = 0;
    unit.pathIndex = 0;
  }
}

/**
 * 结算爆炸：范围扣血、生成序列帧特效，并把自身标为已引爆待移除。
 * 对基地走炸弹减半，避免自爆直接削穿主堡。
 */
function resolveDetonate(world: World, unit: Unit): void {
  const detonate = unit.config.detonate;
  if (!detonate || unit.detonated) return;

  unit.detonated = true;
  unit.detonateWindupLeft = 0;
  unit.hp = 0;

  const radius = detonate.aoeRadius;
  const damage = unit.stats.damage;
  const radiusSq = mul(radius, radius);
  // 建筑只按中心插入空间哈希；查询半径要覆盖「贴外缘爆炸 → 中心仍可能很远」
  const queryRadius = radius + maxBuildingHalfFootprint(world);

  world.unitGrid.query(unit.pos.x, unit.pos.y, queryRadius, neighbors);

  for (let i = 0; i < neighbors.length; i++) {
    const other = world.units[neighbors[i]!]!;
    if (!isAlive(other) || other.faction === unit.faction) continue;
    if (other.id === unit.id) continue;
    // 爆炸只伤地面；飞行单位需被其它攻击锁定才吃伤害
    if (other.config.movementLayer === 'air') continue;
    if (!isInsideDetonateRadius(unit, other, radiusSq)) continue;
    applyBombDamage(other, damage);
  }

  world.spawnExplosionEffect(unit.pos.x, unit.pos.y, radius);
}

/** 普通单位用圆心距；建筑用到占地 AABB 表面距，贴墙爆炸也能打中。 */
function isInsideDetonateRadius(bomber: Unit, other: Unit, radiusSq: Fx): boolean {
  if (isBuildingConfig(other.config)) {
    return distSqToBuildingFootprint(bomber.pos.x, bomber.pos.y, other) <= radiusSq;
  }
  return distSq(bomber.pos.x, bomber.pos.y, other.pos.x, other.pos.y) <= radiusSq;
}

/** 场上存活建筑的最大半边长，供扩大空间哈希查询。 */
function maxBuildingHalfFootprint(world: World): Fx {
  let half: Fx = 0;
  for (const other of world.units) {
    if (!isAlive(other) || !isBuildingConfig(other.config)) continue;
    const h = fromFloat(other.config.footprint / 2);
    if (h > half) half = h;
  }
  return half;
}
