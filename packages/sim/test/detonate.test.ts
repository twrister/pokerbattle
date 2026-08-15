import { describe, expect, it } from 'vitest';
import { Faction, UnitState } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { takeSnapshot } from '../src/snapshot.js';
import { World } from '../src/world.js';

describe('炸弹兵自爆', () => {
  it('敌军可以锁定并普攻命中炸弹兵', () => {
    const world = new World(1);
    const melee = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(8));
    // 比地面兵更近，可锁定时应优先咬炸弹兵
    const bomber = world.spawnUnit(Faction.Red, 'summoned_bomber', fromFloat(9), fromFloat(9));
    const ground = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(14));
    melee.retargetIn = 0;
    // 冻住炸弹兵，避免其主动贴脸自爆抢在普攻前引爆
    bomber.stats.moveSpeed = 0;
    ground.stats.damage = 0;
    const bomberHp = bomber.hp;

    world.step();
    expect(melee.targetId).toBe(bomber.id);

    for (let i = 0; i < 20; i++) world.step();
    expect(bomber.hp).toBeLessThan(bomberHp);
  });

  it('视野有敌方建筑时仍优先锁更近的地面兵，与骷髅兵一致', () => {
    const world = new World(1);
    const base = world.spawnBuilding(Faction.Red, 'building_base', fromFloat(8), fromFloat(18));
    expect(base).not.toBeNull();
    // 地面兵更近；若推家过滤把炸弹兵当「无人能威胁」会只咬基地
    const ground = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(8), fromFloat(10));
    const bomber = world.spawnUnit(Faction.Blue, 'summoned_bomber', fromFloat(8), fromFloat(8));
    const skeleton = world.spawnUnit(Faction.Blue, 'summoned_skeleton', fromFloat(8.1), fromFloat(8));
    bomber.retargetIn = 0;
    skeleton.retargetIn = 0;
    bomber.stats.moveSpeed = 0;
    skeleton.stats.moveSpeed = 0;
    ground.stats.damage = 0;

    world.step();

    expect(bomber.targetId).toBe(ground.id);
    expect(skeleton.targetId).toBe(ground.id);
  });

  it('追到目标射程后站定点燃引信并自爆', () => {
    const world = new World(1);
    const bomber = world.spawnUnit(Faction.Blue, 'summoned_bomber', fromFloat(8), fromFloat(8));
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(8));
    enemy.stats.moveSpeed = 0;
    enemy.stats.damage = 0;
    bomber.retargetIn = 0;

    let litFuse = false;
    for (let i = 0; i < 80; i++) {
      world.step();
      if (bomber.detonateWindupLeft > 0) {
        litFuse = true;
        // 点燃当帧仍是 Attack；下一帧 AI 切 Idle 站定蓄力
        expect(bomber.state).not.toBe(UnitState.Seek);
        expect(bomber.targetId).toBe(enemy.id);
        world.step();
        if (world.units.find((unit) => unit.id === bomber.id)) {
          expect(bomber.state).toBe(UnitState.Idle);
          expect(bomber.detonateWindupLeft).toBeGreaterThan(0);
        }
        break;
      }
    }
    expect(litFuse).toBe(true);

    for (let i = 0; i < 20; i++) world.step();
    expect(world.units.find((unit) => unit.id === bomber.id)).toBeUndefined();
  });

  it('大法师前摇结束后召唤炸弹兵', () => {
    const world = new World(1);
    const archmage = world.spawnUnit(Faction.Blue, 'hero_archmage', fromFloat(8), fromFloat(8));

    world.step();
    // 与 units.json summon.cooldown 对齐
    expect(archmage.summonCooldown).toBe(fromFloat(60));
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

    // 近战索敌不会锁定巨龙；手动贴身并强制引爆
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
