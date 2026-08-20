import { describe, expect, it } from 'vitest';
import { Faction, UnitState } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { takeSnapshot } from '../src/snapshot.js';
import { World } from '../src/world.js';

describe('国王与女王', () => {
  it('国王拥有指定基础属性与近战单体攻击', () => {
    const world = new World(1);
    const king = world.spawnUnit(Faction.Blue, 'hero_king', fromFloat(8), fromFloat(8));

    expect(king.stats.maxHp).toBe(king.config.maxHp);
    expect(king.stats.damage).toBe(king.config.damage);
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
    // 国王振奋是持续光环，不触发施法特效
    expect(takeSnapshot(world).units.some((u) => u.typeId === 'hero_king' && u.casting)).toBe(false);

    king.pos.x = fromFloat(1);
    secondKing.pos.x = fromFloat(1);
    world.step();
    world.step();
    expect(ally.stats.attackInterval).toBe(baseInterval);
    expect(ally.stats.moveSpeed).toBe(baseSpeed);
  });

  it('女王单体治疗前摇起手播特效，结束后只治疗锁定的低血友军', () => {
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

    // 前摇刚起手：特效 + 攻击蓄力姿势，治疗尚未结算，目标已锁定
    const heal = queen.config.heal!;
    expect(queen.healWindupLeft).toBeGreaterThan(0);
    expect(queen.healCastTargetId).toBe(lowHp.id);
    expect(queen.healCooldown).toBe(heal.cooldown);
    expect(queen.castFxLeft).toBeGreaterThan(0);
    expect(lowHp.hp).toBe(lowBefore);
    const windupSnap = takeSnapshot(world);
    const queenSnap = windupSnap.units.find((u) => u.id === queen.id);
    expect(queenSnap?.casting).toBe(true);
    expect(queenSnap?.attacking).toBe(true);
    expect(windupSnap.healEffects).toHaveLength(0);

    // 走完 attackWindup 后只回锁定目标，旁侧受伤友军不受益
    const windupTicks = toFloat(queen.stats.attackWindup);
    for (let i = 0; i < windupTicks; i++) world.step();

    expect(queen.healWindupLeft).toBe(0);
    expect(queen.healCastTargetId).toBe(0);
    expect(lowHp.hp - lowBefore).toBe(heal.amount);
    expect(nearby.hp).toBe(nearbyBefore);
    expect(outOfRange.hp).toBe(outBefore);
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

  it('女王不能治疗友方建筑，仅有受伤建筑时不施放', () => {
    const world = new World(1);
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(8));
    const base = world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(8), fromFloat(10));
    expect(base).not.toBeNull();
    base!.hp -= fromFloat(500);
    const baseBefore = base!.hp;
    const ally = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(10), fromFloat(8));
    ally.hp -= fromFloat(150);
    const allyBefore = ally.hp;

    world.step();

    // 范围内有更残的基地也不锁建筑；起手锁地面友军
    expect(queen.healCastTargetId).toBe(ally.id);
    expect(queen.healCooldown).toBe(queen.config.heal!.cooldown);
    for (let i = 0; i < toFloat(queen.stats.attackWindup); i++) world.step();

    expect(ally.hp).toBeGreaterThan(allyBefore);
    expect(base!.hp).toBe(baseBefore);

    // 仅剩受伤建筑时不进入治疗
    ally.hp = ally.stats.maxHp;
    queen.healCooldown = 0;
    queen.healWindupLeft = 0;
    queen.healCastTargetId = 0;
    world.step();
    expect(queen.healCooldown).toBe(0);
    expect(queen.healCastTargetId).toBe(0);
    expect(base!.hp).toBe(baseBefore);
  });

  it('女王不能以自身为目标回血', () => {
    const world = new World(1);
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(8));
    const ally = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(10), fromFloat(8));
    queen.hp -= fromFloat(200);
    const queenBefore = queen.hp;
    const allyBefore = ally.hp;

    world.step();

    // 仅自身受伤时不施放治疗
    expect(queen.hp).toBe(queenBefore);
    expect(ally.hp).toBe(allyBefore);
    expect(queen.healCooldown).toBe(0);

    ally.hp -= fromFloat(150);
    const allyHurt = ally.hp;
    world.step();
    // 前摇起手进冷却；走完前摇后才结算
    const heal = queen.config.heal!;
    expect(queen.healCooldown).toBe(heal.cooldown);
    expect(queen.healWindupLeft).toBeGreaterThan(0);
    for (let i = 0; i < toFloat(queen.stats.attackWindup); i++) world.step();

    // 有其他受伤友军时正常单体治疗，且绝不回自己
    expect(ally.hp - allyHurt).toBe(heal.amount);
    expect(queen.hp).toBe(queenBefore);
  });

  it('无敌军时女王寻路接近远处受伤友军并治疗，不普攻友军', () => {
    const world = new World(1);
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(8));
    // 治疗半径 5、视野 5.5：两名伤员都在视野内且够不着治疗，应锁更近者并 Seek
    const far = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(8), fromFloat(13.45));
    const nearer = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(8), fromFloat(13.2));
    far.hp -= fromFloat(200);
    nearer.hp -= fromFloat(100);
    queen.retargetIn = 0;

    const startY = queen.pos.y;
    world.step();

    // 应锁定更近的受伤友军并进入 Seek
    expect(queen.targetId).toBe(nearer.id);
    expect(queen.state).toBe(UnitState.Seek);
    expect(toFloat(queen.pos.y)).toBeGreaterThan(toFloat(startY));

    // 走到治疗半径内后起手，全程不进入 Attack；前摇结束后回血
    let castStarted = false;
    for (let i = 0; i < 400; i++) {
      expect(queen.state).not.toBe(UnitState.Attack);
      world.step();
      if (queen.healCooldown > 0) {
        castStarted = true;
        break;
      }
    }
    expect(castStarted).toBe(true);
    for (let i = 0; i < toFloat(queen.stats.attackWindup); i++) {
      expect(queen.state).not.toBe(UnitState.Attack);
      world.step();
    }
    expect(nearer.hp).toBeGreaterThan(nearer.stats.maxHp - fromFloat(100));
  });

  it('射程内有敌军时仍优先锁视野内受伤友军，不进入攻击', () => {
    const world = new World(1);
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(8));
    // 治疗半径 5、视野 5.5：放在两者之间，验证会 Seek 过去而不是原地打旁边的敌人
    const ally = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(8), fromFloat(13.3));
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(8), fromFloat(11));
    ally.hp -= fromFloat(150);
    queen.retargetIn = 0;

    const startY = queen.pos.y;
    world.step();

    expect(queen.targetId).toBe(ally.id);
    expect(queen.targetId).not.toBe(enemy.id);
    expect(queen.state).toBe(UnitState.Seek);
    expect(queen.state).not.toBe(UnitState.Attack);
    expect(toFloat(queen.pos.y)).toBeGreaterThan(toFloat(startY));
  });

  it('无残血友军且敌方已在攻击射程内时女王才普攻', () => {
    const world = new World(1);
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(8));
    const fullAlly = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(8), fromFloat(12));
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(8), fromFloat(11));
    queen.retargetIn = 0;

    world.step();

    expect(fullAlly.hp).toBe(fullAlly.stats.maxHp);
    expect(queen.targetId).toBe(enemy.id);
    expect(queen.state).toBe(UnitState.Attack);
  });

  it('无残血友军但敌军不在攻击射程内时女王原地待命，不主动追击', () => {
    const world = new World(1);
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(8));
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(8), fromFloat(18));
    queen.retargetIn = 0;

    const startY = queen.pos.y;
    for (let i = 0; i < 20; i++) world.step();

    expect(queen.targetId).toBe(0);
    expect(queen.state).toBe(UnitState.Idle);
    expect(queen.pos.y).toBe(startY);
    expect(toFloat(queen.pos.y)).toBeLessThan(toFloat(enemy.pos.y) - 5);
  });

  it('射程内有敌且治疗半径内有残血友军时只治疗不攻击', () => {
    const world = new World(1);
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(8));
    const ally = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(8), fromFloat(12));
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(8), fromFloat(11));
    ally.hp -= fromFloat(150);
    queen.retargetIn = 0;

    world.step();

    expect(queen.targetId).toBe(ally.id);
    expect(queen.targetId).not.toBe(enemy.id);
    expect(queen.state).not.toBe(UnitState.Attack);
    expect(queen.healCastTargetId).toBe(ally.id);
    expect(queen.healWindupLeft).toBeGreaterThan(0);
  });
});
