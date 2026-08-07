import type { Fx } from './math/fixed.js';
import { Rng } from './math/rng.js';
import { ARENA_HEIGHT, ARENA_WIDTH, NAV_CELL_SIZE, clampToArena } from './config/arena.js';
import { MAX_UNIT_RADIUS, type UnitTypeId, getUnitConfig } from './config/units.js';
import { RETARGET_INTERVAL } from './config/tuning.js';
import { type Projectile, createProjectile } from './entity/projectile.js';
import { type AoePulseEffect, type AoePulseKind, type HealEffect } from './entity/effect.js';
import { type Faction, type Unit, createUnit } from './entity/unit.js';
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
  }

  getUnit(id: number): Unit | undefined {
    return this.unitsById.get(id);
  }

  spawnUnit(faction: Faction, typeId: UnitTypeId, x: Fx, y: Fx): Unit {
    const config = getUnitConfig(typeId);
    const unit = createUnit(
      this.nextEntityId++,
      typeId,
      faction,
      clampToArena(x, ARENA_WIDTH, config.radius),
      clampToArena(y, ARENA_HEIGHT, config.radius),
    );
    // 按 id 打散首次索敌时机；锁定后目标死亡才再索敌，不再周期重选
    unit.retargetIn = unit.id % RETARGET_INTERVAL;
    this.units.push(unit);
    this.unitsById.set(unit.id, unit);
    return unit;
  }

  spawnProjectile(from: Unit, targetId: number, damage: Fx, speed: Fx): Projectile {
    const projectile = createProjectile(
      this.nextEntityId++,
      from.faction,
      from.pos.x,
      from.pos.y,
      targetId,
      damage,
      speed,
    );
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
    cleanup(this);
  }

  removeDeadUnits(): void {
    let write = 0;
    for (let read = 0; read < this.units.length; read++) {
      const unit = this.units[read]!;
      if (unit.dead) {
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
    this.unitsById.clear();
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
      h = mix(h, unit.castFxLeft);
      h = mix(h, unit.aoeHitFxLeft);
    }
    for (const projectile of this.projectiles) {
      h = mix(h, projectile.id);
      h = mix(h, projectile.pos.x);
      h = mix(h, projectile.pos.y);
      h = mix(h, projectile.targetId);
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
