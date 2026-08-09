import { describe, expect, it } from 'vitest';
import { Faction } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { takeSnapshot } from '../src/snapshot.js';
import { World } from '../src/world.js';

describe('法师召唤', () => {
  it('法师基础参数与攻击方式和女王相同', () => {
    const world = new World(1);
    const mage = world.spawnUnit(Faction.Blue, 'hero_mage', fromFloat(8), fromFloat(8));
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(12), fromFloat(8));

    expect(mage.base).toEqual(queen.base);
    expect(mage.config.attack).toEqual(queen.config.attack);
  });

  it('施法前摇结束后召唤指定参数的同阵营骷髅兵', () => {
    const world = new World(1);
    const mage = world.spawnUnit(Faction.Blue, 'hero_mage', fromFloat(8), fromFloat(8));

    world.step();

    expect(mage.summonCooldown).toBe(fromFloat(100));
    expect(mage.summonWindupLeft).toBeGreaterThan(0);
    expect(mage.windupLeft).toBe(0);
    expect(takeSnapshot(world).units.find((unit) => unit.id === mage.id)?.casting).toBe(true);
    expect(world.units).toHaveLength(1);

    for (let i = 0; i < toFloat(mage.stats.attackWindup); i++) world.step();

    const skeleton = world.units.find((unit) => unit.typeId === 'summoned_skeleton');
    expect(skeleton).toBeDefined();
    expect(skeleton?.faction).toBe(Faction.Blue);
    expect(skeleton?.config.attack.kind).toBe('melee');
    expect(toFloat(skeleton!.config.radius)).toBeCloseTo(0.3, 4);
    expect(toFloat(skeleton!.config.bodyScale)).toBeCloseTo(0.6, 4);
    expect(toFloat(skeleton!.config.mass)).toBe(1.5);
    expect(toFloat(skeleton!.stats.maxHp)).toBe(200);
    expect(toFloat(skeleton!.stats.damage)).toBe(60);
    expect(toFloat(skeleton!.stats.attackInterval)).toBe(20);
    expect(toFloat(skeleton!.stats.attackWindup)).toBe(7);
    expect(toFloat(skeleton!.stats.range)).toBeCloseTo(0.3, 4);
    expect(toFloat(skeleton!.stats.moveSpeed)).toBe(1.5);
  });

  it('每隔五秒再次施放且前摇期间不进行普攻', () => {
    const world = new World(1);
    const mage = world.spawnUnit(Faction.Blue, 'hero_mage', fromFloat(8), fromFloat(8));
    world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(8));

    world.step();
    expect(world.projectiles).toHaveLength(0);

    for (let i = 0; i < 99; i++) world.step();
    expect(world.units.filter((unit) => unit.typeId === 'summoned_skeleton')).toHaveLength(1);

    world.step();
    expect(mage.summonCooldown).toBe(fromFloat(100));
    expect(mage.summonWindupLeft).toBeGreaterThan(0);

    for (let i = 0; i < toFloat(mage.stats.attackWindup); i++) world.step();
    expect(world.units.filter((unit) => unit.typeId === 'summoned_skeleton')).toHaveLength(2);
  });
});
