import { describe, expect, it } from 'vitest';
import { Faction } from '../src/entity/unit.js';
import { fromFloat } from '../src/math/fixed.js';
import { updateProjectiles } from '../src/systems/projectiles.js';
import { World } from '../src/world.js';

/** 推进弹道直到指定飞行物结束。 */
function flyUntilImpact(world: World, projectileId: number, maxTicks = 200): void {
  for (let i = 0; i < maxTicks; i++) {
    const projectile = world.projectiles.find((item) => item.id === projectileId);
    if (!projectile || projectile.dead) return;
    updateProjectiles(world);
  }
  throw new Error('弹道未在预期 tick 内命中');
}

describe('弹道命中爆炸特效', () => {
  it('弓箭手仍标记 explode4，但命中不生成爆炸序列帧', () => {
    const world = new World(1);
    const archer = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(5), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(12), fromFloat(10));
    const projectile = world.spawnProjectile(
      archer,
      target,
      archer.stats.damage,
      fromFloat(10),
    );

    expect(projectile.impactFx).toBe('explode4');
    expect(projectile.visual).toBe('arrow');

    flyUntilImpact(world, projectile.id);

    expect(world.explosionEffects).toHaveLength(0);
    expect(world.aoePulseEffects).toHaveLength(0);
  });

  it('箭塔命中单位或建筑均不生成爆炸序列帧', () => {
    const world = new World(1);
    const tower = world.spawnBuilding(Faction.Blue, 'building_tower', fromFloat(5), fromFloat(10));
    expect(tower).not.toBeNull();
    const grunt = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(12), fromFloat(10));
    const enemyBase = world.spawnBuilding(Faction.Red, 'building_base', fromFloat(9), fromFloat(24));
    expect(enemyBase).not.toBeNull();

    const againstUnit = world.spawnProjectile(tower!, grunt, tower!.stats.damage, fromFloat(10));
    flyUntilImpact(world, againstUnit.id);
    expect(world.explosionEffects).toHaveLength(0);

    const againstBuilding = world.spawnProjectile(
      tower!,
      enemyBase!,
      tower!.stats.damage,
      fromFloat(10),
    );
    expect(againstBuilding.impactFx).toBe('explode4');
    flyUntilImpact(world, againstBuilding.id);
    expect(world.explosionEffects).toHaveLength(0);
  });

  it('女王命中仍标记 explode2，但不生成爆炸序列帧', () => {
    const world = new World(1);
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(5), fromFloat(10));
    const grunt = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(12), fromFloat(10));
    const projectile = world.spawnProjectile(queen, grunt, queen.stats.damage, fromFloat(10));

    expect(projectile.impactFx).toBe('explode2');
    flyUntilImpact(world, projectile.id);
    expect(world.explosionEffects).toHaveLength(0);
  });

  it('龙 AOE 命中不生成爆炸序列帧也不回退脉冲环', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(5), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(12), fromFloat(10));
    const aoeRadius =
      dragon.config.attack.kind === 'projectile_aoe'
        ? dragon.config.attack.aoeRadius
        : fromFloat(2);
    const projectile = world.spawnProjectile(
      dragon,
      target,
      dragon.stats.damage,
      fromFloat(9),
      aoeRadius,
    );

    expect(projectile.impactFx).toBe('explode2');
    flyUntilImpact(world, projectile.id);
    expect(world.explosionEffects).toHaveLength(0);
    expect(world.aoePulseEffects).toHaveLength(0);
  });

  it('小王与大王命中不生成爆炸序列帧', () => {
    const world = new World(1);
    for (const typeId of ['hero_mage', 'hero_archmage'] as const) {
      const caster = world.spawnUnit(Faction.Blue, typeId, fromFloat(5), fromFloat(10));
      const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(12), fromFloat(10));
      const projectile = world.spawnProjectile(
        caster,
        target,
        caster.stats.damage,
        fromFloat(10),
      );
      expect(projectile.impactFx).toBe('explode2');
      flyUntilImpact(world, projectile.id);
    }
    expect(world.explosionEffects).toHaveLength(0);
  });
});
