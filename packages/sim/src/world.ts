import { type Fx, floorToInt, fromFloat, toFloat } from './math/fixed.js';
import { lengthOf } from './math/vec2.js';
import { Rng } from './math/rng.js';
import { ARENA_HEIGHT, ARENA_WIDTH, NAV_CELL_SIZE, clampToArena } from './config/arena.js';
import {
  MAX_UNIT_RADIUS,
  type UnitTypeId,
  getUnitConfig,
  isBuildingConfig,
} from './config/units.js';
import {
  AIR_PROJECTILE_HEIGHT,
  BOMB_ARC_APEX,
  GROUND_PROJECTILE_HEIGHT,
  RETARGET_INTERVAL,
  TOWER_PROJECTILE_HEIGHT,
} from './config/tuning.js';
import {
  type Projectile,
  type ProjectileImpactFx,
  type ProjectileVisual,
  createProjectile,
} from './entity/projectile.js';
import {
  type AoePulseEffect,
  type AoePulseKind,
  type ExplosionEffect,
  type HealEffect,
} from './entity/effect.js';
import { Faction, type Unit, createUnit } from './entity/unit.js';
import {
  buildingCellRange,
  isBuildingRectInsideArena,
  snapBuildingCenter,
} from './nav/buildingGrid.js';
import { NavGrid } from './nav/grid.js';
import { PathFinder } from './nav/astar.js';
import { SpatialHash } from './spatial/hash.js';
import type { Command } from './commands.js';
import { applyCommands } from './systems/applyCommands.js';
import { updateBuffs } from './systems/buffs.js';
import { updateTargeting } from './systems/targeting.js';
import { updateAi } from './systems/ai.js';
import { updatePaths } from './systems/pathfinding.js';
import { updateMovement } from './systems/movement.js';
import { updateCharge } from './systems/cavalry.js';
import { resolveSeparation } from './systems/separation.js';
import { updateCombat } from './systems/combat.js';
import { updateProjectiles } from './systems/projectiles.js';
import { updateDetonate } from './systems/detonate.js';
import { tickPresentationFx, updateHeroSkills } from './systems/heroSkills.js';
import { cleanup } from './systems/cleanup.js';

const NO_COMMANDS: readonly Command[] = [];

/**
 * 一局战斗的全部状态。
 *
 * 这个类不碰 DOM、不碰渲染、不读时钟、不用 Math.random，
 * 所以同一个 seed 加同一串指令，在浏览器和 Node 服务端会跑出逐位相同的结果——
 * 这正是后面接帧同步联网的前提。
 */
export class World {
  readonly seed: number;
  readonly rng: Rng;
  readonly nav: NavGrid;
  readonly pathFinder: PathFinder;
  /** 清空战场时会按当前 MAX_UNIT_RADIUS 重建，保证改半径后空间哈希仍正确 */
  unitGrid: SpatialHash;
  readonly units: Unit[] = [];
  readonly projectiles: Projectile[] = [];
  readonly healEffects: HealEffect[] = [];
  readonly aoePulseEffects: AoePulseEffect[] = [];
  readonly explosionEffects: ExplosionEffect[] = [];
  /** 1 格分辨率的建筑占格表，用于放置重叠校验（与 NAV 半格网格独立） */
  private readonly buildingCells: Uint8Array;
  readonly buildingCols: number;
  readonly buildingRows: number;

  tick = 0;
  private nextEntityId = 1;
  private nextEffectId = 1;
  private readonly unitsById = new Map<number, Unit>();

  constructor(seed = 1) {
    this.seed = seed | 0;
    this.rng = new Rng(this.seed);
    this.nav = new NavGrid(ARENA_WIDTH, ARENA_HEIGHT, NAV_CELL_SIZE);
    this.pathFinder = new PathFinder(this.nav);
    // 格子取「最大半径的两倍」，保证任意两个可能重叠的单位一定落在相邻格内
    this.unitGrid = new SpatialHash(ARENA_WIDTH, ARENA_HEIGHT, MAX_UNIT_RADIUS * 2);
    this.buildingCols = toFloat(ARENA_WIDTH);
    this.buildingRows = toFloat(ARENA_HEIGHT);
    this.buildingCells = new Uint8Array(this.buildingCols * this.buildingRows);
  }

  getUnit(id: number): Unit | undefined {
    return this.unitsById.get(id);
  }

  spawnUnit(faction: Faction, typeId: UnitTypeId, x: Fx, y: Fx, level = 1): Unit {
    const config = getUnitConfig(typeId, level);
    // 建筑必须走 spawnBuilding，保证占格与寻路阻挡同步写入
    if (isBuildingConfig(config)) {
      const building = this.spawnBuilding(faction, typeId, x, y, level);
      if (!building) {
        throw new Error(`无法在 (${toFloat(x)}, ${toFloat(y)}) 放置建筑 ${typeId}`);
      }
      return building;
    }
    const unit = createUnit(
      this.nextEntityId++,
      typeId,
      faction,
      clampToArena(x, ARENA_WIDTH, config.radius),
      clampToArena(y, ARENA_HEIGHT, config.radius),
      config.level,
    );
    // 按 id 打散首次索敌时机；锁定后不周期重选（换火见 targeting）
    unit.retargetIn = unit.id % RETARGET_INTERVAL;
    this.units.push(unit);
    this.unitsById.set(unit.id, unit);
    return unit;
  }

  /**
   * 校验建筑落点：已吸附中心、整块在场内、且与已有建筑不重叠。
   * 坐标为定点世界坐标（调用方应先 snap）。
   */
  canPlaceBuilding(typeId: UnitTypeId, centerX: Fx, centerY: Fx): boolean {
    const config = getUnitConfig(typeId);
    if (!isBuildingConfig(config)) return false;
    const rect = buildingCellRange(toFloat(centerX), toFloat(centerY), config.footprint);
    if (!isBuildingRectInsideArena(rect, this.buildingCols, this.buildingRows)) return false;
    for (let gy = rect.minY; gy < rect.maxY; gy++) {
      for (let gx = rect.minX; gx < rect.maxX; gx++) {
        if (this.buildingCells[gy * this.buildingCols + gx] !== 0) return false;
      }
    }
    return true;
  }

  /**
   * 放置建筑：吸附格子 → 写占格/Nav 阻挡 → 挤开区域内单位。
   * 非法落点返回 null（指令层静默丢弃，保持确定性）。
   */
  spawnBuilding(faction: Faction, typeId: UnitTypeId, x: Fx, y: Fx, level = 1): Unit | null {
    const config = getUnitConfig(typeId, level);
    if (!isBuildingConfig(config)) return null;
    const snappedX = fromFloat(snapBuildingCenter(toFloat(x), config.footprint));
    const snappedY = fromFloat(snapBuildingCenter(toFloat(y), config.footprint));
    if (!this.canPlaceBuilding(typeId, snappedX, snappedY)) return null;

    const unit = createUnit(this.nextEntityId++, typeId, faction, snappedX, snappedY, config.level);
    unit.retargetIn = 0;
    this.setBuildingOccupation(unit, true);
    this.evictUnitsFromBuilding(unit);
    this.units.push(unit);
    this.unitsById.set(unit.id, unit);
    return unit;
  }

  /** 建筑死亡或清空时解除占地与寻路阻挡 */
  releaseBuilding(unit: Unit): void {
    if (!isBuildingConfig(unit.config)) return;
    this.setBuildingOccupation(unit, false);
  }

  /** 同步写入/清除 buildingCells 与 NavGrid 半开矩形阻挡 */
  private setBuildingOccupation(unit: Unit, occupied: boolean): void {
    const footprint = unit.config.footprint;
    const half = fromFloat(footprint / 2);
    const minX = unit.pos.x - half;
    const minY = unit.pos.y - half;
    const maxX = unit.pos.x + half;
    const maxY = unit.pos.y + half;
    this.nav.setBlockedWorldRectExclusive(minX, minY, maxX, maxY, occupied);

    const rect = buildingCellRange(toFloat(unit.pos.x), toFloat(unit.pos.y), footprint);
    const flag = occupied ? 1 : 0;
    for (let gy = rect.minY; gy < rect.maxY; gy++) {
      for (let gx = rect.minX; gx < rect.maxX; gx++) {
        this.buildingCells[gy * this.buildingCols + gx] = flag;
      }
    }
  }

  /**
   * 放置瞬间把压在占地内的地面单位沿最短轴推出（矩形边 + 半径）。
   * 空中单位不受影响；后续帧由 separation 的 AABB 解叠维持。
   */
  private evictUnitsFromBuilding(building: Unit): void {
    const half = fromFloat(building.config.footprint / 2);
    const minX = building.pos.x - half;
    const maxX = building.pos.x + half;
    const minY = building.pos.y - half;
    const maxY = building.pos.y + half;

    for (const unit of this.units) {
      if (unit.dead || unit.id === building.id) continue;
      if (isBuildingConfig(unit.config)) continue;
      if (unit.config.movementLayer === 'air') continue;

      const r = unit.config.radius;
      const left = minX - r;
      const right = maxX + r;
      const bottom = minY - r;
      const top = maxY + r;
      if (unit.pos.x <= left || unit.pos.x >= right || unit.pos.y <= bottom || unit.pos.y >= top) {
        continue;
      }

      const distLeft = unit.pos.x - left;
      const distRight = right - unit.pos.x;
      const distBottom = unit.pos.y - bottom;
      const distTop = top - unit.pos.y;
      // 四向距离用整数比较保证确定性；等距时优先左右再上下
      if (distLeft <= distRight && distLeft <= distBottom && distLeft <= distTop) {
        unit.pos.x = left;
      } else if (distRight <= distBottom && distRight <= distTop) {
        unit.pos.x = right;
      } else if (distBottom <= distTop) {
        unit.pos.y = bottom;
      } else {
        unit.pos.y = top;
      }
      unit.pos.x = clampToArena(unit.pos.x, ARENA_WIDTH, unit.config.radius);
      unit.pos.y = clampToArena(unit.pos.y, ARENA_HEIGHT, unit.config.radius);
    }
  }

  spawnProjectile(from: Unit, target: Unit, damage: Fx, speed: Fx, aoeRadius: Fx = 0): Projectile {
    // 空中单位从头部吐弹；防御塔/基地从塔顶射出；其余地面单位用默认高度
    const startHeight =
      from.config.movementLayer === 'air'
        ? AIR_PROJECTILE_HEIGHT
        : from.config.id === 'building_tower' || from.config.id === 'building_base'
          ? TOWER_PROJECTILE_HEIGHT
          : GROUND_PROJECTILE_HEIGHT;
    const endHeight = target.config.movementLayer === 'air' ? AIR_PROJECTILE_HEIGHT : 0;
    const dx = target.pos.x - from.pos.x;
    const dy = target.pos.y - from.pos.y;
    const startDist = lengthOf(dx, dy);
    // 战车炸弹：抛物线 + 落地爆炸；弓箭手/防御塔/基地用箭矢贴图；其余保持线性彩色球
    const isBomb = from.config.id === 'ranged_chariot';
    const isArrow =
      from.config.id === 'ranged_archer'
      || from.config.id === 'building_tower'
      || from.config.id === 'building_base';
    const arcApex = isBomb ? BOMB_ARC_APEX : 0;
    const impactFx: ProjectileImpactFx = isBomb ? 'explosion' : 'pulse';
    const visual: ProjectileVisual = isBomb ? 'bomb' : isArrow ? 'arrow' : 'orb';
    const projectile = createProjectile(
      this.nextEntityId++,
      from.faction,
      from.pos.x,
      from.pos.y,
      target.id,
      target.pos.x,
      target.pos.y,
      target.config.radius,
      damage,
      speed,
      aoeRadius,
      startHeight,
      endHeight,
      startDist,
      arcApex,
      impactFx,
      visual,
    );
    this.projectiles.push(projectile);
    return projectile;
  }

  /**
   * 从己方主堡向指定落点投放巨型炸弹。
   * 主堡不存在时使用己方场边中央，保证沙盒与测试环境也能确定性运行。
   */
  spawnGiantBomb(faction: Faction, targetX: Fx, targetY: Fx, level = 1): Projectile {
    return this.spawnFuseBomb(faction, 'giant_bomb', targetX, targetY, level, BOMB_ARC_APEX * 2);
  }

  /**
   * 从己方主堡投放小炸弹：伤害与爆炸半径更小，抛物线也更矮。
   * damageOverride 用于三条兑换等按牌力线性伤，缺省走单位配置。
   */
  spawnSmallBomb(
    faction: Faction,
    targetX: Fx,
    targetY: Fx,
    level = 1,
    damageOverride?: Fx,
  ): Projectile {
    return this.spawnFuseBomb(
      faction,
      'small_bomb',
      targetX,
      targetY,
      level,
      BOMB_ARC_APEX,
      damageOverride,
    );
  }

  /** 主堡抛物线引信弹的共用投放逻辑。 */
  private spawnFuseBomb(
    faction: Faction,
    typeId: 'giant_bomb' | 'small_bomb',
    targetX: Fx,
    targetY: Fx,
    level: number,
    arcApex: number,
    damageOverride?: Fx,
  ): Projectile {
    const config = getUnitConfig(typeId, level);
    const base = this.units.find(
      (unit) => unit.faction === faction && unit.typeId === 'building_base' && !unit.dead,
    );
    const startX = base?.pos.x ?? ARENA_WIDTH / 2;
    const startY = base?.pos.y ?? (faction === Faction.Blue ? 0 : ARENA_HEIGHT);
    const dx = targetX - startX;
    const dy = targetY - startY;
    const speed = config.attack.kind === 'projectile_aoe' ? config.attack.speed : fromFloat(12);
    const radius = config.attack.kind === 'projectile_aoe' ? config.attack.aoeRadius : fromFloat(8);
    const projectile = createProjectile(
      this.nextEntityId++,
      faction,
      startX,
      startY,
      -1,
      targetX,
      targetY,
      0,
      damageOverride ?? config.damage,
      speed,
      radius,
      GROUND_PROJECTILE_HEIGHT,
      0,
      lengthOf(dx, dy),
      arcApex,
      'explosion',
      'bomb',
      typeId,
    );
    // 落地引信时长走单位攻击间隔，便于在配置表调爆炸节奏
    projectile.fuseTicks = Math.max(0, floorToInt(config.attackInterval));
    this.projectiles.push(projectile);
    return projectile;
  }

  /** 记录一次单体受疗反馈，供快照层在目标脚底播放短暂特效。 */
  spawnHealEffect(x: Fx, y: Fx, radius: Fx): void {
    const totalTicks = 12;
    this.healEffects.push({
      id: this.nextEffectId++,
      x,
      y,
      radius,
      remainingTicks: totalTicks,
      totalTicks,
    });
  }

  /**
   * 记录一次伤害范围脉冲（普攻整圆 / 冲刺扇形），供快照层播放地面反馈。
   * dir 仅 charge_fan 使用；整圆可传 0。
   */
  spawnAoePulse(
    kind: AoePulseKind,
    x: Fx,
    y: Fx,
    radius: Fx,
    dirX: Fx = 0,
    dirY: Fx = 0,
  ): void {
    // 比治疗环更短，突出「这一刀」的瞬时感
    const totalTicks = 6;
    this.aoePulseEffects.push({
      id: this.nextEffectId++,
      kind,
      x,
      y,
      radius,
      dirX,
      dirY,
      remainingTicks: totalTicks,
      totalTicks,
    });
  }

  /** 记录一次爆炸序列帧，供快照层按进度播放对应类型素材。 */
  spawnExplosionEffect(
    x: Fx,
    y: Fx,
    radius: Fx,
    kind: ExplosionEffect['kind'] = 'normal',
  ): void {
    // 约 0.5 秒，对齐 8 帧 @16fps 的爆炸素材时长
    const totalTicks = 10;
    this.explosionEffects.push({
      id: this.nextEffectId++,
      x,
      y,
      radius,
      kind,
      remainingTicks: totalTicks,
      totalTicks,
    });
  }

  /**
   * 推进一个逻辑帧。系统顺序写死在这里，任何调整都会改变模拟结果，
   * 改动前请确认两端会同时更新。
   */
  step(commands: readonly Command[] = NO_COMMANDS): void {
    this.tick++;
    // 先推进上帧遗留的表现倒计时，再跑本帧逻辑，保证新特效能进当帧快照
    tickPresentationFx(this);
    applyCommands(this, commands);
    updateBuffs(this);
    updateTargeting(this);
    updateAi(this);
    updatePaths(this);
    updateMovement(this);
    updateCharge(this);
    resolveSeparation(this);
    updateHeroSkills(this);
    updateCombat(this);
    updateProjectiles(this);
    // 在 cleanup 前引爆，保证死亡当帧仍能结算 AOE 与特效
    updateDetonate(this);
    cleanup(this);
  }

  removeDeadUnits(): void {
    let write = 0;
    for (let read = 0; read < this.units.length; read++) {
      const unit = this.units[read]!;
      if (unit.dead) {
        // 拆除前先解除占格与寻路阻挡，避免「鬼墙」
        this.releaseBuilding(unit);
        this.unitsById.delete(unit.id);
        continue;
      }
      this.units[write++] = unit;
    }
    this.units.length = write;
  }

  removeDeadProjectiles(): void {
    let write = 0;
    for (let read = 0; read < this.projectiles.length; read++) {
      const projectile = this.projectiles[read]!;
      if (projectile.dead) continue;
      this.projectiles[write++] = projectile;
    }
    this.projectiles.length = write;
  }

  /** 清空战场，回到 tick 0。沙盒里的「重开」按钮用。 */
  clear(): void {
    this.units.length = 0;
    this.projectiles.length = 0;
    this.healEffects.length = 0;
    this.aoePulseEffects.length = 0;
    this.explosionEffects.length = 0;
    this.unitsById.clear();
    this.buildingCells.fill(0);
    this.nav.clearBlocked();
    this.tick = 0;
    this.nextEntityId = 1;
    this.nextEffectId = 1;
    this.rng.setState(this.seed);
    // 配置面板可能改过半径，格子尺寸要跟着 MAX_UNIT_RADIUS 走
    this.unitGrid = new SpatialHash(ARENA_WIDTH, ARENA_HEIGHT, MAX_UNIT_RADIUS * 2);
  }

  /**
   * 世界状态指纹。两端每隔若干帧比对一次就能立刻发现不同步，
   * 单机阶段则用来做确定性回归测试。
   */
  hash(): number {
    let h = 0x811c9dc5;
    h = mix(h, this.tick);
    h = mix(h, this.rng.getState());
    for (const unit of this.units) {
      h = mix(h, unit.id);
      h = mix(h, unit.pos.x);
      h = mix(h, unit.pos.y);
      h = mix(h, unit.facing.x);
      h = mix(h, unit.facing.y);
      h = mix(h, unit.hp);
      h = mix(h, unit.state);
      h = mix(h, unit.targetId);
      h = mix(h, unit.engageSlot);
      h = mix(h, unit.attackCooldown);
      h = mix(h, unit.windupLeft);
      h = mix(h, unit.chargeCooldown);
      h = mix(h, unit.chargeWindupLeft);
      h = mix(h, unit.chargeRemaining);
      h = mix(h, unit.chargeDir.x);
      h = mix(h, unit.chargeDir.y);
      h = mix(h, unit.healCooldown);
      h = mix(h, unit.healWindupLeft);
      h = mix(h, unit.healCastTargetId);
      h = mix(h, unit.summonCooldown);
      h = mix(h, unit.summonWindupLeft);
      h = mix(h, unit.detonateWindupLeft);
      h = mix(h, unit.detonated ? 1 : 0);
      h = mix(h, unit.castFxLeft);
      h = mix(h, unit.aoeHitFxLeft);
    }
    for (const projectile of this.projectiles) {
      h = mix(h, projectile.id);
      h = mix(h, projectile.pos.x);
      h = mix(h, projectile.pos.y);
      h = mix(h, projectile.targetId);
      h = mix(h, projectile.impactPos.x);
      h = mix(h, projectile.impactPos.y);
      h = mix(h, projectile.targetRadius);
      h = mix(h, projectile.damage);
      h = mix(h, projectile.aoeRadius);
      h = mix(h, projectile.fuseTicks);
      h = mix(h, projectile.landed ? 1 : 0);
      h = mix(h, projectile.fuseBombKind === 'giant_bomb' ? 2 : projectile.fuseBombKind === 'small_bomb' ? 1 : 0);
    }
    for (const effect of this.healEffects) {
      h = mix(h, effect.id);
      h = mix(h, effect.x);
      h = mix(h, effect.y);
      h = mix(h, effect.remainingTicks);
    }
    for (const effect of this.aoePulseEffects) {
      h = mix(h, effect.id);
      h = mix(h, effect.x);
      h = mix(h, effect.y);
      h = mix(h, effect.dirX);
      h = mix(h, effect.dirY);
      h = mix(h, effect.remainingTicks);
      h = mix(h, effect.kind === 'charge_fan' ? 1 : 0);
    }
    for (const effect of this.explosionEffects) {
      h = mix(h, effect.id);
      h = mix(h, effect.x);
      h = mix(h, effect.y);
      h = mix(h, effect.kind === 'giant_bomb' ? 1 : 0);
      h = mix(h, effect.remainingTicks);
    }
    return h >>> 0;
  }
}

/** FNV-1a，逐字节混入一个 32 位整数 */
function mix(hash: number, value: number): number {
  let h = hash;
  for (let shift = 0; shift < 32; shift += 8) {
    h ^= (value >>> shift) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h;
}
