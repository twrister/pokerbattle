import { describe, expect, it } from 'vitest';
import { Faction, UnitState } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { dist } from '../src/math/vec2.js';
import { World } from '../src/world.js';

function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) world.step();
}

describe('战斗行为', () => {
  it('场上没有敌人时单位原地待命', () => {
    const world = new World(1);
    const unit = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(5), fromFloat(5));
    const startX = unit.pos.x;
    const startY = unit.pos.y;

    run(world, 100);

    expect(unit.state).toBe(UnitState.Idle);
    expect(unit.pos.x).toBe(startX);
    expect(unit.pos.y).toBe(startY);
  });

  it('锁定目标后不会因更近敌人而换敌，目标死亡后才重新索敌', () => {
    const world = new World(1);
    const attacker = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(10));
    const far = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(16));
    // 先让攻击者锁住远处目标
    run(world, 10);
    expect(attacker.targetId).toBe(far.id);

    // 再在身旁刷一个更近的敌人，存活期间仍应咬住原目标
    const near = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(11));
    run(world, 20);
    expect(attacker.targetId).toBe(far.id);

    // 原目标死亡后才转火近处敌人
    far.hp = 0;
    far.dead = true;
    run(world, 5);
    expect(attacker.targetId).toBe(near.id);
  });

  it('近战兵会寻路接近远处的敌人并最终进入攻击状态', () => {
    const world = new World(1);
    const melee = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(4));
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(26));
    const startGap = dist(melee.pos.x, melee.pos.y, enemy.pos.x, enemy.pos.y);

    run(world, 40);
    expect(melee.state).toBe(UnitState.Seek);
    expect(dist(melee.pos.x, melee.pos.y, enemy.pos.x, enemy.pos.y)).toBeLessThan(startGap);

    run(world, 200);
    expect(melee.state).toBe(UnitState.Attack);
  });

  it('远程兵在射程边缘停下并用飞行弹造成伤害', () => {
    const world = new World(1);
    const archer = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(9), fromFloat(6));
    const dummy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(20));
    const fullHp = dummy.hp;

    run(world, 400);

    expect(dummy.hp).toBeLessThan(fullHp);
    // 射程 5 加上双方半径，停下的位置不该明显超过这个距离
    const gap = toFloat(dist(archer.pos.x, archer.pos.y, dummy.pos.x, dummy.pos.y));
    expect(gap).toBeLessThan(6.5);
  });

  it('一对一互殴最终会分出胜负，尸体从实体列表中移除', () => {
    const world = new World(1);
    world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(15));
    world.spawnUnit(Faction.Red, 'ranged_archer', fromFloat(9), fromFloat(17));

    run(world, 1200);

    expect(world.units.length).toBe(1);
    expect(world.units[0]!.state).toBe(UnitState.Idle);
  });

  it('攻击间隔生效：DPS 大致等于 伤害 / 间隔', () => {
    const world = new World(1);
    const attacker = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(15));
    // 靶子既不还手也打不死，才能干净地测出十秒内的总伤害
    const dummy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(16));
    dummy.stats.damage = 0;
    dummy.stats.maxHp = fromFloat(20000);
    dummy.hp = dummy.stats.maxHp;
    const fullHp = dummy.hp;

    run(world, 200); // 10 秒

    const lost = toFloat(fullHp - dummy.hp);
    const expected = toFloat(attacker.stats.damage) * 10; // 攻击间隔 1 秒
    expect(lost).toBeGreaterThan(expected * 0.7);
    expect(lost).toBeLessThanOrEqual(expected + 1);
  });
});

describe('碰撞推挤', () => {
  it('重叠的单位会被推开到不再重叠', () => {
    const world = new World(1);
    const a = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(16));
    const b = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9.05), fromFloat(16));

    run(world, 60);

    const gap = toFloat(dist(a.pos.x, a.pos.y, b.pos.x, b.pos.y));
    const minGap = toFloat(a.config.radius + b.config.radius);
    expect(gap).toBeGreaterThan(minGap * 0.95);
  });

  it('大体型推得动小体型，自己几乎不动', () => {
    const world = new World(1);
    const heavy = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(16));
    const light = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(9.2), fromFloat(16));
    const heavyStart = heavy.pos.x;
    const lightStart = light.pos.x;

    run(world, 60);

    const heavyMoved = Math.abs(toFloat(heavy.pos.x - heavyStart));
    const lightMoved = Math.abs(toFloat(light.pos.x - lightStart));
    expect(lightMoved).toBeGreaterThan(heavyMoved * 1.5);
  });
});
