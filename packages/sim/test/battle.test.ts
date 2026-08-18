import { describe, expect, it } from 'vitest';
import { Faction, NO_TARGET, type Unit, UnitState } from '../src/entity/unit.js';
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

  it('追击中近敌进入攻击射程时应改火', () => {
    const world = new World(1);
    const attacker = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(10));
    const far = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(16));
    // 先锁远处目标并进入 Seek（圆心距 6 > 近战可达约 1.3）
    run(world, 10);
    expect(attacker.targetId).toBe(far.id);
    expect(attacker.state).toBe(UnitState.Seek);

    // 身旁刷已进入攻击射程的敌人（圆心距 1 ≤ 1.3），应打断粘性改火
    const near = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(11));
    run(world, 5);
    expect(attacker.targetId).toBe(near.id);
  });

  it('交战中已够得着当前目标时不因更近敌人换火', () => {
    const world = new World(1);
    // 贴脸开打：圆心距 0.8，近战可达约 1.3，留出挤开余量
    const attacker = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(10));
    const engaged = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(10.8));
    run(world, 15);
    expect(attacker.targetId).toBe(engaged.id);
    expect(attacker.state).toBe(UnitState.Attack);

    // 更近敌人出现；只推进 1 tick 让索敌跑完，避免长时间推挤把原目标挤出射程
    world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(10.3));
    run(world, 1);
    expect(attacker.targetId).toBe(engaged.id);
  });

  it('当前目标死亡后重新索敌', () => {
    const world = new World(1);
    const attacker = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(10));
    const far = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(16));
    run(world, 10);
    expect(attacker.targetId).toBe(far.id);

    // 远处刷第二个敌人（圆心距 3，未进攻击射程），追击中不够着则仍粘远敌
    const other = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(13));
    run(world, 5);
    expect(attacker.targetId).toBe(far.id);

    far.hp = 0;
    far.dead = true;
    run(world, 5);
    expect(attacker.targetId).toBe(other.id);
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

  it('近战能贴脸打到远程女王（攻击环不得落在进入射程外）', () => {
    const world = new World(1);
    const melee = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(10));
    const queen = world.spawnUnit(Faction.Red, 'hero_queen', fromFloat(9), fromFloat(20));
    queen.stats.damage = 0;

    let enteredAttack = false;
    for (let i = 0; i < 200; i++) {
      world.step();
      if (melee.state === UnitState.Attack) enteredAttack = true;
    }

    expect(enteredAttack).toBe(true);
    expect(queen.dead).toBe(true);
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

  it('深层重叠即使有一方在 Attack 也会被推开', () => {
    const world = new World(1);
    const attacker = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(16));
    const ally = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9.02), fromFloat(16));
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(16.8));
    // 强制进入 Attack，验证深层重叠不会被弱推挤卡死
    attacker.state = UnitState.Attack;
    attacker.targetId = enemy.id;
    ally.state = UnitState.Attack;
    ally.targetId = enemy.id;

    run(world, 80);

    const gap = toFloat(dist(attacker.pos.x, attacker.pos.y, ally.pos.x, ally.pos.y));
    const minGap = toFloat(attacker.config.radius + ally.config.radius);
    expect(gap).toBeGreaterThan(minGap * 0.9);
  });
});

describe('拥挤与攻击环', () => {
  /** 统计场上存活单位两两最大穿透深度（格） */
  function maxPenetration(world: World): number {
    let worst = 0;
    const units = world.units;
    for (let i = 0; i < units.length; i++) {
      const a = units[i]!;
      if (a.dead) continue;
      for (let j = i + 1; j < units.length; j++) {
        const b = units[j]!;
        if (b.dead) continue;
        const gap = toFloat(dist(a.pos.x, a.pos.y, b.pos.x, b.pos.y));
        const minGap = toFloat(a.config.radius + b.config.radius);
        const pen = minGap - gap;
        if (pen > worst) worst = pen;
      }
    }
    return worst;
  }

  it('多名近战同打一人时会占用多个攻击槽位，不会全挤到目标中心', () => {
    const world = new World(1);
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(18));
    enemy.stats.damage = 0;
    // 定点 Fx 上限约 32767，过大 fromFloat 会溢出成负数被当成死亡
    enemy.stats.maxHp = fromFloat(20000);
    enemy.hp = enemy.stats.maxHp;

    const attackers = [
      world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(7), fromFloat(10)),
      world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(10)),
      world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(11), fromFloat(10)),
      world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(8), fromFloat(9)),
      world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(10), fromFloat(9)),
    ];

    run(world, 240);

    const slots = new Set(attackers.map((u) => u.engageSlot));
    expect(slots.size).toBeGreaterThanOrEqual(3);
    for (const u of attackers) {
      expect(u.engageSlot).toBeGreaterThanOrEqual(0);
      // 不应长期钻进敌人碰撞圆中心
      const gap = toFloat(dist(u.pos.x, u.pos.y, enemy.pos.x, enemy.pos.y));
      expect(gap).toBeGreaterThan(toFloat(u.config.radius + enemy.config.radius) * 0.85);
    }
  });

  it('Attack 单位被浅层推挤后仍能维持攻击状态', () => {
    const world = new World(1);
    const attacker = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(15.5));
    const bumper = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9.9), fromFloat(15.5));
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(16.4));
    enemy.stats.damage = 0;
    enemy.stats.maxHp = fromFloat(20000);
    enemy.hp = enemy.stats.maxHp;

    // 先贴近并进入攻击
    run(world, 80);
    expect(attacker.state).toBe(UnitState.Attack);

    let switches = 0;
    let attackFrames = 0;
    let prev = attacker.state;
    for (let i = 0; i < 120; i++) {
      // 侧向浅层重叠（穿透约 0.1 < 深层阈值），模拟友军擦肩而不是硬怼进碰撞核
      bumper.pos.x = attacker.pos.x + fromFloat(0.9);
      bumper.pos.y = attacker.pos.y;
      world.step();
      if (attacker.state === UnitState.Attack) attackFrames++;
      if (attacker.state !== prev) {
        if (
          (prev === UnitState.Attack && attacker.state === UnitState.Seek) ||
          (prev === UnitState.Seek && attacker.state === UnitState.Attack)
        ) {
          switches++;
        }
        prev = attacker.state;
      }
    }

    expect(attackFrames).toBeGreaterThan(100);
    expect(switches).toBeLessThanOrEqual(4);
  });

  it('多单位对冲后峰值重叠可控，多数单位能进入输出', () => {
    const world = new World(1);
    for (let i = 0; i < 6; i++) {
      world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(6 + i * 1.1), fromFloat(10));
      world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(6 + i * 1.1), fromFloat(22));
    }

    let peakPen = 0;
    let attackTicks = 0;
    for (let t = 0; t < 300; t++) {
      world.step();
      peakPen = Math.max(peakPen, maxPenetration(world));
      for (const u of world.units) {
        if (!u.dead && u.state === UnitState.Attack) attackTicks++;
      }
    }

    // 软碰撞允许短暂重叠，但不该长期深度穿透
    expect(peakPen).toBeLessThan(0.55);
    expect(attackTicks).toBeGreaterThan(200);
  });
});

describe('短视野索敌：城堡无视距离', () => {
  /** 只改本单位索敌，避免写回全局配置表污染其它用例。 */
  function shrinkSight(unit: Unit, sight = 3): void {
    Object.assign(unit, { config: { ...unit.config, sightRange: fromFloat(sight) } });
  }

  it('圈内无敌军时能直接锁上远处城堡', () => {
    const world = new World(1);
    const attacker = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(6));
    const castle = world.spawnBuilding(Faction.Red, 'building_base', fromFloat(9), fromFloat(24))!;
    shrinkSight(attacker);
    attacker.retargetIn = 0;

    run(world, 5);

    expect(attacker.targetId).toBe(castle.id);
    expect(attacker.state).toBe(UnitState.Seek);
  });

  it('圈内有敌军时锁圈内单位，不锁远处城堡', () => {
    const world = new World(1);
    const attacker = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(6));
    const near = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(8));
    world.spawnBuilding(Faction.Red, 'building_base', fromFloat(9), fromFloat(24));
    shrinkSight(attacker);
    attacker.retargetIn = 0;
    near.stats.damage = 0;

    run(world, 5);

    expect(attacker.targetId).toBe(near.id);
  });

  it('圈内无敌军时不会锁远处箭塔', () => {
    const world = new World(1);
    const attacker = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(6));
    world.spawnBuilding(Faction.Red, 'building_tower', fromFloat(9), fromFloat(24));
    shrinkSight(attacker);
    attacker.retargetIn = 0;

    run(world, 5);

    expect(attacker.targetId).toBe(NO_TARGET);
    expect(attacker.state).toBe(UnitState.Idle);
  });
});
