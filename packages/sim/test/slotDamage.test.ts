import { describe, expect, it } from 'vitest';
import { applyBombDamage, applyCombatDamage, Faction } from '../src/entity/unit.js';
import { fromFloat, fromInt, toFloat } from '../src/math/fixed.js';
import { updateProjectiles } from '../src/systems/projectiles.js';
import { World } from '../src/world.js';

describe('席位伤害账本', () => {
  it('近战打基地记 toCastle，打兵记 toUnits', () => {
    const world = new World(1);
    const castle = world.spawnBuilding(Faction.Red, 'building_base', fromFloat(9), fromFloat(15))!;
    const grunt = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(8), fromFloat(12));

    applyCombatDamage(castle, fromInt(80), false, world, 0);
    applyCombatDamage(grunt, fromInt(30), false, world, 0);

    expect(toFloat(world.getSlotDamageStats(0).toCastle)).toBeCloseTo(80, 3);
    expect(toFloat(world.getSlotDamageStats(0).toUnits)).toBeCloseTo(30, 3);
    expect(toFloat(world.getSlotDamageStats(1).toCastle)).toBe(0);
  });

  it('超杀只记剩余血量', () => {
    const world = new World(1);
    const grunt = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(8), fromFloat(12));
    grunt.hp = fromInt(10);

    applyCombatDamage(grunt, fromInt(100), false, world, 0);

    expect(toFloat(world.getSlotDamageStats(0).toUnits)).toBeCloseTo(10, 3);
  });

  it('炸弹对基地按减半后的实际扣血入账', () => {
    const world = new World(1);
    const castle = world.spawnBuilding(Faction.Red, 'building_base', fromFloat(9), fromFloat(15))!;

    applyBombDamage(castle, fromInt(100), world, 0);

    expect(toFloat(world.getSlotDamageStats(0).toCastle)).toBeCloseTo(50, 3);
    expect(toFloat(world.getSlotDamageStats(0).toUnits)).toBe(0);
  });

  it('弹道延迟命中记到发射席位', () => {
    const world = new World(1);
    const archer = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(8), fromFloat(8), 1);
    const grunt = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(8), fromFloat(12));
    const before = grunt.hp;

    world.spawnProjectile(archer, grunt, fromInt(40), fromFloat(20), 0);
    for (let i = 0; i < 80 && world.projectiles.some((p) => !p.dead); i += 1) {
      updateProjectiles(world);
    }

    expect(grunt.hp).toBeLessThan(before);
    expect(toFloat(world.getSlotDamageStats(1).toUnits)).toBeCloseTo(40, 3);
    expect(toFloat(world.getSlotDamageStats(0).toUnits)).toBe(0);
  });

  it('2v2 两席互不影响', () => {
    const world = new World(1);
    const castle = world.spawnBuilding(Faction.Red, 'building_base', fromFloat(9), fromFloat(15))!;
    const grunt = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(8), fromFloat(12));

    applyCombatDamage(castle, fromInt(15), false, world, 0);
    applyCombatDamage(grunt, fromInt(25), false, world, 1);

    expect(toFloat(world.getSlotDamageStats(0).toCastle)).toBeCloseTo(15, 3);
    expect(toFloat(world.getSlotDamageStats(0).toUnits)).toBe(0);
    expect(toFloat(world.getSlotDamageStats(1).toCastle)).toBe(0);
    expect(toFloat(world.getSlotDamageStats(1).toUnits)).toBeCloseTo(25, 3);
  });

  it('引信炸弹从出牌席自己的主堡起飞并记到该席', () => {
    const world = new World(1);
    const slot0 = world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(6), fromFloat(2), 0)!;
    const slot1 = world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(12), fromFloat(2), 1)!;
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(12), fromFloat(15));
    const before = enemy.hp;

    const projectile = world.spawnGiantBomb(Faction.Blue, fromFloat(12), fromFloat(15), undefined, 1);
    expect(projectile.ownerSlot).toBe(1);
    expect(projectile.pos).toEqual(slot1.pos);
    expect(projectile.pos).not.toEqual(slot0.pos);

    for (let i = 0; i < 100 && !projectile.dead; i += 1) updateProjectiles(world);
    expect(enemy.hp).toBeLessThan(before);
    expect(toFloat(world.getSlotDamageStats(1).toUnits)).toBeGreaterThan(0);
    expect(toFloat(world.getSlotDamageStats(0).toUnits)).toBe(0);
  });

  it('clear 后账本归零', () => {
    const world = new World(1);
    const grunt = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(8), fromFloat(12));
    applyCombatDamage(grunt, fromInt(20), false, world, 0);
    world.clear();
    expect(toFloat(world.getSlotDamageStats(0).toUnits)).toBe(0);
  });
});
