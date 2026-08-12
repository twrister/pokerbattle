import { describe, expect, it } from 'vitest';
import { Faction } from '../src/entity/unit.js';
import { fromFloat } from '../src/math/fixed.js';
import { World } from '../src/world.js';

describe('单位死亡特效', () => {
  it('普通单位死亡生成 Explode4', () => {
    const world = new World(1);
    const grunt = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(8), fromFloat(8));
    grunt.hp = 0;
    world.step();

    expect(world.units.find((unit) => unit.id === grunt.id)).toBeUndefined();
    expect(world.explosionEffects).toHaveLength(1);
    expect(world.explosionEffects[0]?.kind).toBe('explode4');
    expect(world.explosionEffects[0]?.totalTicks).toBe(15);
  });

  it('建筑死亡也生成 Explode4', () => {
    const world = new World(1);
    const tower = world.spawnBuilding(Faction.Blue, 'building_tower', fromFloat(5), fromFloat(10));
    expect(tower).not.toBeNull();
    tower!.hp = 0;
    world.step();

    expect(world.units.find((unit) => unit.id === tower!.id)).toBeUndefined();
    expect(world.explosionEffects.some((fx) => fx.kind === 'explode4')).toBe(true);
  });

  it('炸弹兵自爆只保留自爆特效，不叠死亡 Explode4', () => {
    const world = new World(1);
    const bomber = world.spawnUnit(Faction.Blue, 'summoned_bomber', fromFloat(8), fromFloat(8));
    bomber.hp = 0;
    world.step();

    expect(world.units.find((unit) => unit.id === bomber.id)).toBeUndefined();
    // detonate 先播 normal，cleanup 应跳过 explode4
    expect(world.explosionEffects).toHaveLength(1);
    expect(world.explosionEffects[0]?.kind).toBe('normal');
  });
});
