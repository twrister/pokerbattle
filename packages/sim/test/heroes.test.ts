import { describe, expect, it } from 'vitest';
import { HEAL_FOLLOW_STOP_DIST, HEAL_SEEK_RANGE, HEAL_STOP_HYSTERESIS } from '../src/config/tuning.js';
import { Faction, type Unit, UnitState } from '../src/entity/unit.js';
import { mul, ONE, fromFloat, toFloat } from '../src/math/fixed.js';
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

  it('国王振奋对自身生效', () => {
    const world = new World(1);
    const king = world.spawnUnit(Faction.Blue, 'hero_king', fromFloat(8), fromFloat(8));
    const inspire = king.config.inspire!;

    world.step();
    world.step();
    expectInspiredStats(king, 1, inspire.attackIntervalMul, inspire.moveSpeedMul);
    expect(king.inspired).toBe(true);
    expect(inspireStackCount(king)).toBe(1);
  });

  it('多名国王的振奋可叠加，离开范围只保留仍覆盖的层数', () => {
    const world = new World(1);
    const king = world.spawnUnit(Faction.Blue, 'hero_king', fromFloat(8), fromFloat(8));
    const secondKing = world.spawnUnit(Faction.Blue, 'hero_king', fromFloat(8.5), fromFloat(8));
    const ally = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(10), fromFloat(8));
    const inspire = king.config.inspire!;

    world.step();
    world.step();
    expectInspiredStats(ally, 2, inspire.attackIntervalMul, inspire.moveSpeedMul);
    expectInspiredStats(king, 2, inspire.attackIntervalMul, inspire.moveSpeedMul);
    expect(inspireStackCount(ally)).toBe(2);
    expect(inspireStackCount(king)).toBe(2);
    // 国王振奋是持续光环，不触发施法特效
    expect(takeSnapshot(world).units.some((u) => u.typeId === 'hero_king' && u.casting)).toBe(false);

    king.pos.x = fromFloat(1);
    world.step();
    world.step();
    expectInspiredStats(ally, 1, inspire.attackIntervalMul, inspire.moveSpeedMul);
    expect(inspireStackCount(ally)).toBe(1);

    secondKing.pos.x = fromFloat(1);
    world.step();
    world.step();
    expect(ally.stats.attackInterval).toBe(ally.base.attackInterval);
    expect(ally.stats.moveSpeed).toBe(ally.base.moveSpeed);
    expect(ally.inspired).toBe(false);
    expect(inspireStackCount(ally)).toBe(0);
  });

  it('女王单体治疗前摇起手播特效，结束后只治疗锁定的低血友军', () => {
    const world = new World(1);
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(8));
    const lowHp = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(10), fromFloat(8));
    const nearby = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(11.2), fromFloat(8));
    const outOfRange = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(12), fromFloat(8));
    // 民兵 450、弓手 220：民兵必须掉到比例明显更低，才能锁低血而不是锁残血弓手
    lowHp.hp -= fromFloat(280);
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

  it('女王不能治疗机械单位，仅有受伤战车时不施放', () => {
    const world = new World(1);
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(8));
    const ballista = world.spawnUnit(Faction.Blue, 'ranged_ballista', fromFloat(10), fromFloat(8));
    const chariot = world.spawnUnit(Faction.Blue, 'ranged_chariot', fromFloat(10.5), fromFloat(8));
    const wagon = world.spawnUnit(Faction.Blue, 'melee_charge_wagon', fromFloat(11), fromFloat(8));
    ballista.hp -= fromFloat(200);
    chariot.hp -= fromFloat(200);
    wagon.hp -= fromFloat(200);
    const ballistaBefore = ballista.hp;
    const chariotBefore = chariot.hp;
    const wagonBefore = wagon.hp;
    const ally = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9.5), fromFloat(8));
    ally.hp -= fromFloat(150);
    const allyBefore = ally.hp;
    queen.retargetIn = 0;

    world.step();

    // 范围内更残的战车也不锁机械；起手锁地面友军
    expect(queen.healCastTargetId).toBe(ally.id);
    expect(queen.targetId).toBe(ally.id);
    expect(queen.healCooldown).toBe(queen.config.heal!.cooldown);
    for (let i = 0; i < toFloat(queen.stats.attackWindup); i++) world.step();

    expect(ally.hp).toBeGreaterThan(allyBefore);
    expect(ballista.hp).toBe(ballistaBefore);
    expect(chariot.hp).toBe(chariotBefore);
    expect(wagon.hp).toBe(wagonBefore);

    // 仅剩受伤机械时不进入治疗，但仍可跟随最近战车
    ally.dead = true;
    queen.healCooldown = 0;
    queen.healWindupLeft = 0;
    queen.healCastTargetId = 0;
    queen.retargetIn = 0;
    world.step();
    expect(queen.healCooldown).toBe(0);
    expect(queen.healCastTargetId).toBe(0);
    expect(ballista.hp).toBe(ballistaBefore);
    expect(queen.targetId).toBe(ballista.id);
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
    // 治疗半径 5：两名伤员都够不着治疗，应锁更近者并 Seek
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

  it('搜索半径内的残血友军会被锁定并寻路接近', () => {
    const world = new World(1);
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(8));
    // 旧 sightRange 5.5：8 格外原先看不见，现落在 HEAL_SEEK_RANGE 边界内仍应锁定
    const ally = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(8), fromFloat(8 + toFloat(HEAL_SEEK_RANGE)));
    ally.hp -= fromFloat(150);
    queen.retargetIn = 0;

    const startY = queen.pos.y;
    world.step();

    expect(queen.targetId).toBe(ally.id);
    expect(queen.state).toBe(UnitState.Seek);
    expect(toFloat(queen.pos.y)).toBeGreaterThan(toFloat(startY));
  });

  it('射程内有敌军时仍优先锁场上受伤友军，不进入攻击', () => {
    const world = new World(1);
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(8));
    // 伤员在治疗半径外、旧视野外，仍应 Seek 过去而不是原地打旁边的敌人
    const ally = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(8), fromFloat(16));
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

  it('无残血友军且场上无友军、敌军不在攻击射程内时女王原地待命，不主动追击', () => {
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

  it('无残血友军时跟随场上最近满血友军，进入贴身距离后站定', () => {
    const world = new World(1);
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(8));
    const nearer = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(8), fromFloat(16));
    const farther = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(8), fromFloat(20));
    queen.retargetIn = 0;

    const startY = queen.pos.y;
    world.step();

    expect(queen.targetId).toBe(nearer.id);
    expect(queen.targetId).not.toBe(farther.id);
    expect(queen.state).toBe(UnitState.Seek);
    expect(toFloat(queen.pos.y)).toBeGreaterThan(toFloat(startY));

    // 走到跟随停步距离内后站定等待，不进入治疗冷却（友军满血）
    let arrived = false;
    for (let i = 0; i < 400; i++) {
      expect(queen.state).not.toBe(UnitState.Attack);
      world.step();
      if (queen.state === UnitState.Idle && queen.targetId === nearer.id) {
        arrived = true;
        break;
      }
    }
    expect(arrived).toBe(true);
    expect(queen.healCooldown).toBe(0);
  });

  it('跟随满血友军时远处出现残血友军则立刻改锁伤员', () => {
    const world = new World(1);
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(8));
    const fullAlly = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(8), fromFloat(12));
    queen.retargetIn = 0;

    world.step();
    expect(queen.targetId).toBe(fullAlly.id);

    const injured = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(8), fromFloat(16));
    injured.hp -= fromFloat(150);
    queen.retargetIn = 0;
    world.step();

    expect(queen.targetId).toBe(injured.id);
    expect(queen.state).toBe(UnitState.Seek);
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

  it('超出治疗搜索距离的残血友军不跨场接人，改为跟随前线友军', () => {
    const world = new World(1);
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(8));
    const frontAlly = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(8), fromFloat(12));
    const farInjured = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(8), fromFloat(22));
    // 女王远程够边距 = range+对方半径≈6，敌军必须在圈外才走跟随而不是普攻
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(8), fromFloat(16));
    farInjured.hp -= fromFloat(150);
    queen.retargetIn = 0;

    world.step();

    expect(toFloat(farInjured.pos.y) - toFloat(queen.pos.y)).toBeGreaterThan(toFloat(HEAL_SEEK_RANGE));
    expect(queen.targetId).not.toBe(farInjured.id);
    expect(queen.targetId).toBe(frontAlly.id);
    expect(queen.targetId).not.toBe(enemy.id);
    expect(queen.state).toBe(UnitState.Seek);
  });

  it('两名女王互为最近友军时仍跟随前线普通单位推进', () => {
    const world = new World(1);
    const queenA = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(8));
    const queenB = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(9));
    const grunt = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(8), fromFloat(16));
    world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(8), fromFloat(22));
    queenA.retargetIn = 0;
    queenB.retargetIn = 0;

    const startAY = queenA.pos.y;
    const startBY = queenB.pos.y;
    world.step();

    expect(queenA.targetId).toBe(grunt.id);
    expect(queenB.targetId).toBe(grunt.id);
    expect(queenA.state).toBe(UnitState.Seek);
    expect(queenB.state).toBe(UnitState.Seek);
    expect(toFloat(queenA.pos.y)).toBeGreaterThan(toFloat(startAY));
    expect(toFloat(queenB.pos.y)).toBeGreaterThan(toFloat(startBY));
  });

  it('跟随满血友军时停走有迟滞，轻微拉开不立刻重新 Seek', () => {
    const world = new World(1);
    const queen = world.spawnUnit(Faction.Blue, 'hero_queen', fromFloat(8), fromFloat(8));
    const ally = world.spawnUnit(
      Faction.Blue,
      'melee_grunt',
      fromFloat(8),
      fromFloat(8 + toFloat(HEAL_FOLLOW_STOP_DIST)),
    );
    queen.retargetIn = 0;
    world.step();

    expect(queen.targetId).toBe(ally.id);
    expect(queen.state).toBe(UnitState.Idle);

    // 拉开量小于迟滞，应继续站定，避免贴阈值碎步
    ally.pos.y = fromFloat(8 + toFloat(HEAL_FOLLOW_STOP_DIST) + toFloat(HEAL_STOP_HYSTERESIS) * 0.5);
    for (let i = 0; i < 8; i++) {
      world.step();
      expect(queen.state).toBe(UnitState.Idle);
      expect(queen.state).not.toBe(UnitState.Seek);
    }

    ally.pos.y = fromFloat(8 + toFloat(HEAL_FOLLOW_STOP_DIST) + toFloat(HEAL_STOP_HYSTERESIS) + 1);
    queen.retargetIn = 0;
    world.step();
    expect(queen.state).toBe(UnitState.Seek);
  });
});

/** 与 recomputeStats 一致：final = base * (1 + stacks * (mul - 1))。 */
function expectInspiredStats(
  unit: Unit,
  stacks: number,
  attackIntervalMul: number,
  moveSpeedMul: number,
): void {
  expect(unit.stats.attackInterval).toBe(mul(unit.base.attackInterval, ONE + stacks * (attackIntervalMul - ONE)));
  expect(unit.stats.moveSpeed).toBe(mul(unit.base.moveSpeed, ONE + stacks * (moveSpeedMul - ONE)));
  expect(unit.inspired).toBe(true);
}

function inspireStackCount(unit: Unit): number {
  return unit.buffs.filter((buff) => buff.id === -buff.sourceId && buff.stat === 'moveSpeed').length;
}
