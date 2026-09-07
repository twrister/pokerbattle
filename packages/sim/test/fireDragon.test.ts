import { describe, expect, it } from 'vitest';
import { Faction } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { takeSnapshot } from '../src/snapshot.js';
import { updateGroundHazards } from '../src/systems/groundHazards.js';
import { updateProjectiles } from '../src/systems/projectiles.js';
import { World } from '../src/world.js';

/** 推进弹道直到指定飞行物结束。 */
function flyUntilImpact(world: World, projectileId: number, maxTicks = 100): void {
  for (let i = 0; i < maxTicks; i++) {
    const projectile = world.projectiles.find((item) => item.id === projectileId);
    if (!projectile || projectile.dead) return;
    updateProjectiles(world);
  }
  throw new Error('范围弹未在预期 tick 内落地');
}

/** 只推进燃烧区，避免完整 step 再开一轮攻击。 */
function tickHazards(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) updateGroundHazards(world);
}

describe('喷火龙', () => {
  it('加载与巨龙对齐的基础参数，并带落地燃烧配置', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'fire_dragon', fromFloat(9), fromFloat(16));
    const burn = dragon.config.groundBurn;

    expect(dragon.config.name).toBe('喷火龙');
    expect(dragon.config.movementLayer).toBe('air');
    expect(dragon.config.preferThreats).toBe(true);
    expect(dragon.config.noBacktrack).toBe(true);
    expect(dragon.config.attack.kind).toBe('projectile_aoe');
    expect(toFloat(dragon.stats.damage)).toBeCloseTo(120, 3);
    expect(burn).toBeDefined();
    expect(toFloat(burn!.durationTicks)).toBeCloseTo(40, 3);
    expect(toFloat(burn!.intervalTicks)).toBeCloseTo(10, 3);
    expect(toFloat(burn!.damage)).toBeCloseTo(20, 3);
  });

  it('弹道落地仍结算一次爆炸伤，并生成燃烧区', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'fire_dragon', fromFloat(5), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(10));
    const hp = target.hp;
    const projectile = world.spawnProjectile(
      dragon,
      target,
      dragon.stats.damage,
      fromFloat(9),
      fromFloat(2),
    );
    expect(projectile.groundBurn).not.toBeNull();
    expect(projectile.homing).toBe(false);

    flyUntilImpact(world, projectile.id);

    expect(toFloat(hp - target.hp)).toBeCloseTo(120, 3);
    expect(world.groundHazards).toHaveLength(1);
    expect(toFloat(world.groundHazards[0]!.radius)).toBeCloseTo(2, 3);
    expect(takeSnapshot(world).groundHazards).toHaveLength(1);
  });

  it('燃烧区在落地后 0.5s 首次灼烧，2s 内共 4 跳各 20', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'fire_dragon', fromFloat(5), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(10));
    const projectile = world.spawnProjectile(
      dragon,
      target,
      dragon.stats.damage,
      fromFloat(9),
      fromFloat(2),
    );
    flyUntilImpact(world, projectile.id);
    const afterBoom = target.hp;

    tickHazards(world, 9);
    expect(target.hp).toBe(afterBoom);

    tickHazards(world, 1);
    expect(toFloat(afterBoom - target.hp)).toBeCloseTo(20, 3);

    tickHazards(world, 10);
    expect(toFloat(afterBoom - target.hp)).toBeCloseTo(40, 3);

    tickHazards(world, 10);
    expect(toFloat(afterBoom - target.hp)).toBeCloseTo(60, 3);

    tickHazards(world, 10);
    expect(toFloat(afterBoom - target.hp)).toBeCloseTo(80, 3);
    expect(world.groundHazards).toHaveLength(0);
  });

  it('燃烧只伤圈内敌军地面单位，不伤友军、圈外与空中', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'fire_dragon', fromFloat(5), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(10));
    const splash = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(11.5), fromFloat(10));
    const outside = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(12.1), fromFloat(10));
    const ally = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(10.5), fromFloat(10));
    const air = world.spawnUnit(Faction.Red, 'dragon', fromFloat(10), fromFloat(10));
    const projectile = world.spawnProjectile(
      dragon,
      target,
      dragon.stats.damage,
      fromFloat(9),
      fromFloat(2),
    );
    flyUntilImpact(world, projectile.id);
    const afterBoom = new Map(world.units.map((unit) => [unit.id, unit.hp]));

    tickHazards(world, 10);

    expect(toFloat(afterBoom.get(target.id)! - target.hp)).toBeCloseTo(20, 3);
    expect(toFloat(afterBoom.get(splash.id)! - splash.hp)).toBeCloseTo(20, 3);
    expect(outside.hp).toBe(afterBoom.get(outside.id));
    expect(ally.hp).toBe(afterBoom.get(ally.id));
    expect(air.hp).toBe(afterBoom.get(air.id));
  });

  it('打空中目标时不铺地面火', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'fire_dragon', fromFloat(9), fromFloat(10));
    const airTarget = world.spawnUnit(Faction.Red, 'dragon', fromFloat(9), fromFloat(11.5));
    const projectile = world.spawnProjectile(
      dragon,
      airTarget,
      dragon.stats.damage,
      fromFloat(9),
      0,
    );
    expect(projectile.groundBurn).toBeNull();
    expect(toFloat(projectile.aoeRadius)).toBe(0);

    flyUntilImpact(world, projectile.id);

    expect(world.groundHazards).toHaveLength(0);
  });
});
