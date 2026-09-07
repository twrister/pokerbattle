import { describe, expect, it } from 'vitest';
import { AIR_PROJECTILE_HEIGHT } from '../src/config/tuning.js';
import { Faction, UnitState } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { dist } from '../src/math/vec2.js';
import { takeSnapshot } from '../src/snapshot.js';
import { resolveSeparation } from '../src/systems/separation.js';
import { updateCombat } from '../src/systems/combat.js';
import { updateProjectiles } from '../src/systems/projectiles.js';
import { World } from '../src/world.js';

/** 推进弹道系统直到指定飞行物结束，避免测试依赖完整 AI 流水线。 */
function flyUntilImpact(world: World, projectileId: number, maxTicks = 100): void {
  for (let i = 0; i < maxTicks; i++) {
    const projectile = world.projectiles.find((item) => item.id === projectileId);
    if (!projectile || projectile.dead) return;
    updateProjectiles(world);
  }
  throw new Error('范围弹未在预期 tick 内落地');
}

describe('飞行巨龙', () => {
  it('加载指定基础参数与落点范围弹道', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(9), fromFloat(16));

    expect(toFloat(dragon.config.radius)).toBeCloseTo(0.6, 3);
    expect(toFloat(dragon.config.bodyScale)).toBeCloseTo(1.1, 3);
    expect(toFloat(dragon.config.mass)).toBeCloseTo(2, 3);
    expect(toFloat(dragon.stats.maxHp)).toBeCloseTo(3500, 3);
    expect(toFloat(dragon.stats.damage)).toBeCloseTo(100, 3);
    expect(toFloat(dragon.stats.attackInterval)).toBeCloseTo(22, 3);
    expect(toFloat(dragon.stats.attackWindup)).toBeCloseTo(10, 3);
    expect(toFloat(dragon.stats.range)).toBeCloseTo(2, 3);
    expect(dragon.config.movementLayer).toBe('air');
    expect(dragon.config.preferThreats).toBe(true);
    expect(dragon.config.noBacktrack).toBe(true);
    expect(dragon.config.attack.kind).toBe('projectile_aoe');
    if (dragon.config.attack.kind === 'projectile_aoe') {
      expect(toFloat(dragon.config.attack.speed)).toBeCloseTo(9, 3);
      expect(toFloat(dragon.config.attack.aoeRadius)).toBeCloseTo(2, 3);
    }
  });

  it('空中与地面单位互不推挤', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(9), fromFloat(16));
    const ground = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(16));
    const dragonStart = { ...dragon.pos };
    const groundStart = { ...ground.pos };

    resolveSeparation(world);

    expect(dragon.pos).toEqual(dragonStart);
    expect(ground.pos).toEqual(groundStart);
  });

  it('同为空中单位时仍会互相推挤', () => {
    const world = new World(1);
    const a = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(9), fromFloat(16));
    const b = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(9), fromFloat(16));

    resolveSeparation(world);

    expect(dist(a.pos.x, a.pos.y, b.pos.x, b.pos.y)).toBeGreaterThan(0);
  });

  it('弹道落地后只对半径 2 内敌人各造成一次范围伤害', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(5), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(10));
    const splash = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(11.5), fromFloat(10));
    const outside = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(12.1), fromFloat(10));
    const ally = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(10.5), fromFloat(10));
    const hp = new Map(world.units.map((unit) => [unit.id, unit.hp]));
    const projectile = world.spawnProjectile(
      dragon,
      target,
      dragon.stats.damage,
      fromFloat(9),
      fromFloat(2),
    );

    flyUntilImpact(world, projectile.id);

    expect(toFloat(hp.get(target.id)! - target.hp)).toBeCloseTo(100, 3);
    expect(toFloat(hp.get(splash.id)! - splash.hp)).toBeCloseTo(100, 3);
    expect(outside.hp).toBe(hp.get(outside.id));
    expect(ally.hp).toBe(hp.get(ally.id));
    expect(target.aoeHitFxLeft).toBeGreaterThan(0);
    expect(splash.aoeHitFxLeft).toBeGreaterThan(0);
    expect(world.aoePulseEffects).toHaveLength(0);
    expect(world.explosionEffects).toHaveLength(1);
    expect(world.explosionEffects[0]?.kind).toBe('normal');
  });

  it('主目标提前死亡后仍飞向最后位置并触发爆炸', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(5), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(10));
    const splash = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(11), fromFloat(10));
    const splashHp = splash.hp;
    const projectile = world.spawnProjectile(
      dragon,
      target,
      dragon.stats.damage,
      fromFloat(9),
      fromFloat(2),
    );
    target.hp = 0;
    target.dead = true;

    flyUntilImpact(world, projectile.id);

    expect(splash.hp).toBeLessThan(splashHp);
    expect(projectile.dead).toBe(true);
    expect(world.explosionEffects).toHaveLength(1);
    expect(world.explosionEffects[0]?.kind).toBe('normal');
  });

  it('近战不能锁定或命中空中单位', () => {
    const world = new World(1);
    const melee = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(15));
    const dragon = world.spawnUnit(Faction.Red, 'dragon', fromFloat(9), fromFloat(16));
    const ground = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(20));
    dragon.stats.damage = 0;
    ground.stats.damage = 0;

    for (let i = 0; i < 40; i++) world.step();

    expect(melee.targetId).toBe(ground.id);
    expect(dragon.hp).toBe(dragon.stats.maxHp);
  });

  it('有敌方建筑时巨龙不锁更近的近战地面兵', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(9), fromFloat(6));
    const base = world.spawnBuilding(Faction.Red, 'building_base', fromFloat(9), fromFloat(24))!;
    // 比基地中心更近，但打不到空中——有建筑时不应引走巨龙
    const melee = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(10));
    dragon.retargetIn = 0;
    melee.stats.damage = 0;

    for (let i = 0; i < 10; i++) world.step();

    expect(dragon.targetId).toBe(base.id);
  });

  it('巨龙追建筑时近战贴脸应改火', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(9), fromFloat(6));
    const base = world.spawnBuilding(Faction.Red, 'building_base', fromFloat(9), fromFloat(24))!;
    dragon.retargetIn = 0;

    for (let i = 0; i < 10; i++) world.step();
    expect(dragon.targetId).toBe(base.id);
    expect(dragon.state).toBe(UnitState.Seek);

    // 圆心距 2，落在巨龙攻击射程内（约 2.6），应打断推家改火
    const melee = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(8));
    for (let i = 0; i < 5; i++) world.step();

    expect(dragon.targetId).toBe(melee.id);
  });

  it('巨龙锁近战后拉开出射程应弃目标并回锁建筑', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(9), fromFloat(10));
    const melee = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(16));
    dragon.retargetIn = 0;
    melee.stats.damage = 0;

    for (let i = 0; i < 10; i++) world.step();
    expect(dragon.targetId).toBe(melee.id);

    // 强制拉开到攻击射程外，再刷基地：飞行单位应立刻弃近战并回锁建筑
    dragon.pos.x = fromFloat(9);
    dragon.pos.y = fromFloat(6);
    melee.pos.x = fromFloat(9);
    melee.pos.y = fromFloat(16);
    const base = world.spawnBuilding(Faction.Red, 'building_base', fromFloat(9), fromFloat(24))!;
    for (let i = 0; i < 3; i++) world.step();

    expect(dragon.targetId).toBe(base.id);
  });

  it('无建筑时巨龙仍会锁近战地面兵', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(9), fromFloat(10));
    const melee = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(16));
    dragon.retargetIn = 0;
    melee.stats.damage = 0;

    for (let i = 0; i < 10; i++) world.step();

    expect(dragon.targetId).toBe(melee.id);
  });

  it('有建筑时巨龙仍会锁更近的对空威胁', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(9), fromFloat(6));
    world.spawnBuilding(Faction.Red, 'building_base', fromFloat(9), fromFloat(24));
    const archer = world.spawnUnit(Faction.Red, 'ranged_archer', fromFloat(9), fromFloat(10));
    dragon.retargetIn = 0;
    archer.stats.damage = 0;

    for (let i = 0; i < 10; i++) world.step();

    expect(dragon.targetId).toBe(archer.id);
  });

  it('前方近战与更远的前方弓手并存时锁弓手', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(9), fromFloat(6));
    const melee = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(10));
    const archer = world.spawnUnit(Faction.Red, 'ranged_archer', fromFloat(9), fromFloat(12));
    dragon.retargetIn = 0;
    melee.stats.damage = 0;
    archer.stats.damage = 0;

    for (let i = 0; i < 10; i++) world.step();

    expect(dragon.targetId).toBe(archer.id);
  });

  it('身后近战更近时仍锁前方基地，不回头', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(9), fromFloat(16));
    const melee = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(10));
    const base = world.spawnBuilding(Faction.Red, 'building_base', fromFloat(9), fromFloat(24))!;
    dragon.retargetIn = 0;
    melee.stats.damage = 0;

    for (let i = 0; i < 10; i++) world.step();

    expect(dragon.targetId).toBe(base.id);
  });

  it('身后弓手已进射程时仍锁弓手，不因方向放弃', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(9), fromFloat(10));
    const archer = world.spawnUnit(Faction.Red, 'ranged_archer', fromFloat(9), fromFloat(9));
    dragon.retargetIn = 0;
    archer.stats.damage = 0;

    for (let i = 0; i < 10; i++) world.step();

    expect(dragon.targetId).toBe(archer.id);
  });

  it('打近战粘性中射程内出现弓手应换火', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(9), fromFloat(10));
    const melee = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(11));
    dragon.retargetIn = 0;
    melee.stats.damage = 0;

    for (let i = 0; i < 5; i++) world.step();
    expect(dragon.targetId).toBe(melee.id);

    const archer = world.spawnUnit(Faction.Red, 'ranged_archer', fromFloat(10), fromFloat(10));
    archer.stats.damage = 0;
    for (let i = 0; i < 3; i++) world.step();

    expect(dragon.targetId).toBe(archer.id);
  });

  it('全场只有身后目标时仍会锁上，不原地卡死', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(9), fromFloat(16));
    const melee = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(10));
    dragon.retargetIn = 0;
    melee.stats.damage = 0;

    for (let i = 0; i < 10; i++) world.step();

    expect(dragon.targetId).toBe(melee.id);
  });

  it('巨龙弹道从 2.5 高度发射，打地面时落点高度为 0', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(5), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(10));
    const projectile = world.spawnProjectile(
      dragon,
      target,
      dragon.stats.damage,
      fromFloat(9),
      fromFloat(2),
    );

    expect(projectile.height).toBe(2.5);
    expect(projectile.startHeight).toBe(AIR_PROJECTILE_HEIGHT);
    expect(projectile.endHeight).toBe(0);
    expect(takeSnapshot(world).projectiles[0]!.height).toBe(2.5);

    flyUntilImpact(world, projectile.id);
    expect(projectile.height).toBe(0);
  });

  it('巨龙攻击空中单位时改为单体且无范围脉冲', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(9), fromFloat(10));
    const airTarget = world.spawnUnit(Faction.Red, 'dragon', fromFloat(9), fromFloat(11.5));
    const splash = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10.5), fromFloat(11.5));
    airTarget.stats.damage = 0;
    splash.stats.damage = 0;
    const airHp = airTarget.hp;
    const splashHp = splash.hp;

    dragon.state = UnitState.Attack;
    dragon.targetId = airTarget.id;
    dragon.attackCooldown = 0;
    // 前摇剩 1 tick，本帧走完即结算，避免再开一轮 10 tick 前摇
    dragon.windupLeft = fromFloat(1);
    updateCombat(world);

    const projectile = world.projectiles[0]!;
    expect(projectile).toBeDefined();
    expect(toFloat(projectile.aoeRadius)).toBe(0);

    flyUntilImpact(world, projectile.id);

    expect(toFloat(airHp - airTarget.hp)).toBeCloseTo(100, 3);
    expect(splash.hp).toBe(splashHp);
    expect(world.aoePulseEffects).toHaveLength(0);
  });

  it('发射后落点锁定，目标走开则打空且溅射仍打原落点', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(5), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(10));
    const splash = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(11.5), fromFloat(10));
    const targetHp = target.hp;
    const splashHp = splash.hp;
    const projectile = world.spawnProjectile(
      dragon,
      target,
      dragon.stats.damage,
      fromFloat(9),
      fromFloat(2),
    );
    expect(projectile.homing).toBe(false);
    const lockX = projectile.impactPos.x;
    const lockY = projectile.impactPos.y;

    // 飞出爆炸半径后落点不得跟随
    target.pos.x = fromFloat(10);
    target.pos.y = fromFloat(20);

    flyUntilImpact(world, projectile.id);

    expect(projectile.impactPos.x).toBe(lockX);
    expect(projectile.impactPos.y).toBe(lockY);
    expect(target.hp).toBe(targetHp);
    expect(splash.hp).toBeLessThan(splashHp);
    expect(world.explosionEffects).toHaveLength(1);
  });

  it('对空单体在目标飞离锁定点后 miss', () => {
    const world = new World(1);
    const dragon = world.spawnUnit(Faction.Blue, 'dragon', fromFloat(9), fromFloat(10));
    const airTarget = world.spawnUnit(Faction.Red, 'dragon', fromFloat(9), fromFloat(11.5));
    const airHp = airTarget.hp;
    const projectile = world.spawnProjectile(
      dragon,
      airTarget,
      dragon.stats.damage,
      fromFloat(9),
      fromFloat(0),
    );
    expect(projectile.homing).toBe(false);

    airTarget.pos.x = fromFloat(9);
    airTarget.pos.y = fromFloat(20);

    flyUntilImpact(world, projectile.id);

    expect(airTarget.hp).toBe(airHp);
    expect(projectile.dead).toBe(true);
    expect(world.explosionEffects).toHaveLength(1);
    expect(world.explosionEffects[0]?.kind).toBe('normal');
  });
});
