import { describe, expect, it } from 'vitest';
import { Faction } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { takeSnapshot } from '../src/snapshot.js';
import { World } from '../src/world.js';

describe('炸弹兵自爆', () => {
  it('大法师前摇结束后召唤炸弹兵', () => {
    const world = new World(1);
    const archmage = world.spawnUnit(Faction.Blue, 'hero_archmage', fromFloat(8), fromFloat(8));

    world.step();
    expect(archmage.summonCooldown).toBe(fromFloat(100));
    expect(archmage.summonWindupLeft).toBeGreaterThan(0);
    expect(world.units).toHaveLength(1);

    for (let i = 0; i < toFloat(archmage.stats.attackWindup); i++) world.step();

    const bomber = world.units.find((unit) => unit.typeId === 'summoned_bomber');
    expect(bomber).toBeDefined();
    expect(bomber?.faction).toBe(Faction.Blue);
    expect(bomber?.config.detonate).toBeDefined();
    expect(bomber!.stats.maxHp).toBe(bomber!.config.maxHp);
    expect(bomber!.stats.damage).toBe(bomber!.config.damage);
    expect(toFloat(bomber!.config.detonate!.fuse)).toBe(10);
    expect(toFloat(bomber!.config.detonate!.aoeRadius)).toBeCloseTo(1.5, 4);
  });

  it('接近地面目标后引信结束爆炸并造成范围伤害', () => {
    const world = new World(1);
    const bomber = world.spawnUnit(Faction.Blue, 'summoned_bomber', fromFloat(8), fromFloat(8));
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(8.5), fromFloat(8));
    const hpBefore = enemy.hp;
    const expectDamage = bomber.stats.damage;

    // 贴身时进入 Attack 并点燃引信
    for (let i = 0; i < 5; i++) world.step();
    expect(bomber.detonateWindupLeft).toBeGreaterThan(0);

    // 走完约 0.5s 引信
    for (let i = 0; i < 12; i++) world.step();

    expect(world.units.find((unit) => unit.id === bomber.id)).toBeUndefined();
    expect(enemy.hp).toBe(hpBefore - expectDamage);
    expect(takeSnapshot(world).explosionEffects.length).toBeGreaterThan(0);
  });

  it('引信中被击杀时立即爆炸', () => {
    const world = new World(1);
    const bomber = world.spawnUnit(Faction.Blue, 'summoned_bomber', fromFloat(8), fromFloat(8));
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(8.4), fromFloat(8));
    const hpBefore = enemy.hp;

    for (let i = 0; i < 5; i++) world.step();
    expect(bomber.detonateWindupLeft).toBeGreaterThan(0);

    bomber.hp = 0;
    world.step();

    expect(world.units.find((unit) => unit.id === bomber.id)).toBeUndefined();
    expect(enemy.hp).toBeLessThan(hpBefore);
    expect(takeSnapshot(world).explosionEffects.length).toBeGreaterThan(0);
  });

  it('爆炸不伤害飞行单位', () => {
    const world = new World(1);
    const bomber = world.spawnUnit(Faction.Blue, 'summoned_bomber', fromFloat(8), fromFloat(8));
    const dragon = world.spawnUnit(Faction.Red, 'dragon', fromFloat(8.2), fromFloat(8));
    const ground = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(8.5), fromFloat(8));
    const dragonHp = dragon.hp;
    const groundHp = ground.hp;

    // 近战索敌不会锁定龙；手动贴身并强制引爆
    bomber.hp = 0;
    world.step();

    expect(dragon.hp).toBe(dragonHp);
    expect(ground.hp).toBeLessThan(groundHp);
  });

  it('贴建筑外缘爆炸时按占地表面距结算，能打到建筑', () => {
    const world = new World(1);
    // 基地 footprint=4，中心 (8,10)；外缘约 y=8，炸弹兵贴南墙
    const base = world.spawnBuilding(Faction.Red, 'building_base', fromFloat(8), fromFloat(10));
    expect(base).not.toBeNull();
    const bomber = world.spawnUnit(Faction.Blue, 'summoned_bomber', fromFloat(8), fromFloat(7.7));
    const hpBefore = base!.hp;

    bomber.hp = 0;
    world.step();

    expect(base!.hp).toBe(hpBefore - bomber.stats.damage);
  });
});
