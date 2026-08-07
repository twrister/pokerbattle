import { describe, expect, it } from 'vitest';
import { Faction } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { takeSnapshot } from '../src/snapshot.js';
import { World } from '../src/world.js';

describe('国王与女王', () => {
  it('国王拥有指定基础属性与近战单体攻击', () => {
    const world = new World(1);
    const king = world.spawnUnit(Faction.Blue, 'hero_king', fromFloat(8), fromFloat(8));

    expect(toFloat(king.stats.maxHp)).toBe(800);
    expect(toFloat(king.stats.damage)).toBe(100);
    expect(king.config.attack.kind).toBe('melee');
  });

  it('国王向范围内友军提供不叠加的振奋，离开范围立即移除', () => {
    const world = new World(1);
    const king = world.spawnUnit(Faction.Blue, 'hero_king', fromFloat(8), fromFloat(8));
    const secondKing = world.spawnUnit(Faction.Blue, 'hero_king', fromFloat(8.5), fromFloat(8));
    const ally = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(10), fromFloat(8));
    const baseInterval = ally.base.attackInterval;
    const baseSpeed = ally.base.moveSpeed;

    world.step();
    world.step();
    expect(ally.stats.attackInterval).toBeLessThan(baseInterval);
    expect(ally.stats.moveSpeed).toBeGreaterThan(baseSpeed);
    expect(toFloat(ally.stats.attackInterval)).toBeCloseTo(toFloat(baseInterval) * 0.8, 3);

    king.pos.x = fromFloat(1);
    secondKing.pos.x = fromFloat(1);
    world.step();
    world.step();
    expect(ally.stats.attackInterval).toBe(baseInterval);
    expect(ally.stats.moveSpeed).toBe(baseSpeed);
  });

  it('女王自动选取低血友军为圆心，范围治疗并进入五秒冷却', () => {
    const world = new World(1);
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(8));
    const lowHp = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(10), fromFloat(8));
    const nearby = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(11.2), fromFloat(8));
    const outOfRange = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(12), fromFloat(8));
    lowHp.hp -= fromFloat(200);
    nearby.hp -= fromFloat(100);
    outOfRange.hp -= fromFloat(100);

    const lowBefore = lowHp.hp;
    const nearbyBefore = nearby.hp;
    const outBefore = outOfRange.hp;
    world.step();

    expect(toFloat(lowHp.hp - lowBefore)).toBe(120);
    expect(toFloat(nearby.hp - nearbyBefore)).toBe(100);
    expect(outOfRange.hp).toBe(outBefore);
    expect(queen.healCooldown).toBe(fromFloat(100));
    expect(takeSnapshot(world).healEffects).toHaveLength(1);
  });

  it('女王没有受伤友军时不进入冷却', () => {
    const world = new World(1);
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(8));
    world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(10), fromFloat(8));

    world.step();

    expect(queen.healCooldown).toBe(0);
    expect(takeSnapshot(world).healEffects).toHaveLength(0);
  });
});
