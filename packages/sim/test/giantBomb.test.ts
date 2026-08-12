import { describe, expect, it } from 'vitest';
import { findFormationById, isGiantBombFormation } from '../src/config/cardFormations.js';
import { Faction } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { takeSnapshot } from '../src/snapshot.js';
import { updateProjectiles } from '../src/systems/projectiles.js';
import { World } from '../src/world.js';

describe('巨型炸弹', () => {
  it('作为炸弹牌型的唯一单独配置', () => {
    const giantBomb = findFormationById('bomb_giant_bomb');
    expect(giantBomb).toBeDefined();
    expect(isGiantBombFormation(giantBomb!)).toBe(true);
    expect(findFormationById('bomb_cavalry')).toBeUndefined();
  });

  it('从己方主堡抛出，落地后按 attackInterval 闪烁再伤害半径内敌军单位与建筑', () => {
    const world = new World(1);
    const blueBase = world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(2))!;
    const ally = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(15));
    const allyBuilding = world.spawnBuilding(Faction.Blue, 'building_tower', fromFloat(7), fromFloat(15))!;
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(15));
    const air = world.spawnUnit(Faction.Red, 'dragon', fromFloat(8), fromFloat(15));
    const building = world.spawnBuilding(Faction.Red, 'building_tower', fromFloat(12), fromFloat(15))!;
    const outside = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(17.5), fromFloat(15));
    const hp = new Map(world.units.map((unit) => [unit.id, unit.hp]));

    const projectile = world.spawnGiantBomb(Faction.Blue, fromFloat(9), fromFloat(15));
    expect(projectile.pos).toEqual(blueBase.pos);
    expect(projectile.visual).toBe('bomb');
    expect(projectile.fuseBombKind).toBe('giant_bomb');
    // giant_bomb 配置 attackInterval=15
    expect(projectile.fuseTicks).toBe(15);

    for (let i = 0; i < 100 && !projectile.landed; i += 1) updateProjectiles(world);
    expect(projectile.landed).toBe(true);
    expect(takeSnapshot(world).projectiles[0]).toMatchObject({
      landed: true,
      fuseBombKind: 'giant_bomb',
    });

    for (let i = 0; i < 14; i += 1) updateProjectiles(world);
    expect(ally.hp).toBe(hp.get(ally.id));
    updateProjectiles(world);

    // 己方单位与建筑不受伤
    expect(ally.hp).toBe(hp.get(ally.id));
    expect(allyBuilding.hp).toBe(hp.get(allyBuilding.id));
    for (const unit of [enemy, air, building]) {
      expect(toFloat(hp.get(unit.id)! - unit.hp)).toBeCloseTo(1200, 3);
    }
    expect(outside.hp).toBe(hp.get(outside.id));
    expect(world.explosionEffects).toHaveLength(0);
  });
});
