import { describe, expect, it } from 'vitest';
import { TOWER_HP_DECAY_PER_TICK } from '../src/config/tuning.js';
import { Faction, UnitState } from '../src/entity/unit.js';
import { fromInt, fromFloat, mul, toFloat } from '../src/math/fixed.js';
import { takeSnapshot } from '../src/snapshot.js';
import { World } from '../src/world.js';

/** 箭塔仅因持续损耗应剩余的生命，用来和普攻/溅射伤害区分。 */
function towerHpAfterDecay(maxHp: number, ticks: number): number {
  return maxHp - mul(TOWER_HP_DECAY_PER_TICK, fromInt(ticks));
}

describe('皇家骑士冲刺', () => {
  it('CD 就绪且目标在 2～2.5 格时进入冲刺并前进约 3 格', () => {
    const world = new World(1);
    // 中心距 2.25，落在触发窗内；双方尚未索敌前不会互相走近
    const cavalry = world.spawnUnit(Faction.Blue, 'melee_cavalry', fromFloat(9), fromFloat(10));
    world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(12.25));

    const startY = cavalry.pos.y;
    let sawCharge = false;
    for (let i = 0; i < 60; i++) {
      world.step();
      if (cavalry.state === UnitState.Charge && cavalry.chargeWindupLeft <= 0) sawCharge = true;
      // 冲刺结束后停止观察位移，避免后续 Seek 干扰断言
      if (sawCharge && cavalry.state !== UnitState.Charge) break;
    }

    expect(sawCharge).toBe(true);
    const traveled = toFloat(cavalry.pos.y - startY);
    // 冲刺约 3 格；允许边界/定点误差
    expect(traveled).toBeGreaterThan(2.5);
    expect(traveled).toBeLessThan(3.4);
    expect(cavalry.chargeCooldown).toBeGreaterThan(0);
  });

  it('冲刺触发后先原地前摇 0.5s，期间不位移', () => {
    const world = new World(1);
    const cavalry = world.spawnUnit(Faction.Blue, 'melee_cavalry', fromFloat(9), fromFloat(10));
    world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(12.25));

    // 等到切入冲刺前摇
    for (let i = 0; i < 20 && cavalry.state !== UnitState.Charge; i++) {
      world.step();
    }
    expect(cavalry.state).toBe(UnitState.Charge);
    expect(cavalry.chargeWindupLeft).toBeGreaterThan(0);
    expect(takeSnapshot(world).units.find((u) => u.id === cavalry.id)?.casting).toBe(true);

    const yAtWindup = cavalry.pos.y;
    // 0.5s = 10 tick；前摇期间应基本站定
    for (let i = 0; i < 9; i++) {
      world.step();
      expect(cavalry.state).toBe(UnitState.Charge);
      expect(toFloat(cavalry.pos.y - yAtWindup)).toBeLessThan(0.05);
    }

    // 前摇结束后开始直线位移
    for (let i = 0; i < 5; i++) {
      world.step();
      if (cavalry.chargeWindupLeft <= 0 && cavalry.state === UnitState.Charge) break;
    }
    expect(cavalry.chargeWindupLeft).toBe(0);
    expect(toFloat(cavalry.pos.y - yAtWindup)).toBeGreaterThan(0.1);
  });

  it('冲刺碰到敌人后，前方 1.5 内敌人均受击退伤害，同段不重复命中', () => {
    const world = new World(1);
    const cavalry = world.spawnUnit(Faction.Blue, 'melee_cavalry', fromFloat(9), fromFloat(10));
    // 触发用目标，正前方 2.2 格（会被碰撞并溅射）
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(12.2));
    // 目标侧前方：索敌时比主目标略远，碰撞触发后落入 1.5 溅射圈
    const splash = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(12));
    const targetHp = target.hp;
    const splashHp = splash.hp;

    let charged = false;
    for (let i = 0; i < 50; i++) {
      world.step();
      if (cavalry.state === UnitState.Charge && cavalry.chargeWindupLeft <= 0) charged = true;
      if (charged && cavalry.state !== UnitState.Charge) break;
    }

    expect(charged).toBe(true);
    expect(toFloat(targetHp - target.hp)).toBeGreaterThanOrEqual(30);
    expect(toFloat(splashHp - splash.hp)).toBeGreaterThanOrEqual(30);

    // 溅射名单应包含主目标与侧方单位（位移可能被后续寻路抵消，故以命中记录为准）
    expect(cavalry.chargeHits).toContain(target.id);
    expect(cavalry.chargeHits).toContain(splash.id);
    expect(cavalry.chargeHits.filter((id) => id === target.id).length).toBe(1);
    expect(cavalry.chargeHits.filter((id) => id === splash.id).length).toBe(1);
  });

  it('目标过近（<2 格）时不触发冲刺，改为接近并普攻', () => {
    const world = new World(1);
    const cavalry = world.spawnUnit(Faction.Blue, 'melee_cavalry', fromFloat(9), fromFloat(15));
    // 中心距 1.6：小于触发下限，且略大于普攻 reach（约 1.45）
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(16.6));

    let sawCharge = false;
    for (let i = 0; i < 80; i++) {
      world.step();
      if (cavalry.state === UnitState.Charge) sawCharge = true;
    }

    expect(sawCharge).toBe(false);
    expect(cavalry.chargeCooldown).toBe(0);
    expect(cavalry.state).toBe(UnitState.Attack);
    expect(enemy.hp).toBeLessThan(enemy.stats.maxHp);
  });

  it('冲刺 CD 未转好时不会二次冲刺', () => {
    const world = new World(1);
    const cavalry = world.spawnUnit(Faction.Blue, 'melee_cavalry', fromFloat(9), fromFloat(8));
    // 远端敌人，冲刺结束后仍会 Seek，中途可能再次进入 2～2.5 窗
    world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(20));

    let chargeStarts = 0;
    let wasCharging = false;
    for (let i = 0; i < 120; i++) {
      world.step();
      const charging = cavalry.state === UnitState.Charge;
      if (charging && !wasCharging) chargeStarts++;
      wasCharging = charging;
    }

    expect(chargeStarts).toBe(1);
    // 5 秒 CD = 100 tick，跑 120 tick 时 CD 仍应剩余
    expect(cavalry.chargeCooldown).toBeGreaterThan(0);
  });

  it('普攻为范围伤害：攻击范围内的敌人均掉血', () => {
    const world = new World(1);
    // 贴身部署，确保不进冲刺窗直接普攻
    const cavalry = world.spawnUnit(Faction.Blue, 'melee_cavalry', fromFloat(9), fromFloat(16));
    const a = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(16.9));
    const b = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9.7), fromFloat(16.9));
    const hpA = a.hp;
    const hpB = b.hp;

    let sawCharge = false;
    for (let i = 0; i < 60; i++) {
      world.step();
      if (cavalry.state === UnitState.Charge) sawCharge = true;
      if (a.hp < hpA && b.hp < hpB) break;
    }

    expect(sawCharge).toBe(false);
    expect(a.hp).toBeLessThan(hpA);
    expect(b.hp).toBeLessThan(hpB);
    // 至少吃到一轮普攻伤害
    expect(toFloat(hpA - a.hp)).toBeGreaterThanOrEqual(95);
    expect(toFloat(hpB - b.hp)).toBeGreaterThanOrEqual(95);
  });

  it('普攻命中时生成整圆地面脉冲，并标记范围受击', () => {
    const world = new World(1);
    world.spawnUnit(Faction.Blue, 'melee_cavalry', fromFloat(9), fromFloat(16));
    const a = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(16.9));
    const b = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9.7), fromFloat(16.9));
    const hpA = a.hp;

    for (let i = 0; i < 60; i++) {
      world.step();
      if (a.hp < hpA) break;
    }

    const snap = takeSnapshot(world);
    const rings = snap.aoePulseEffects.filter((e) => e.kind === 'melee_ring');
    expect(rings.length).toBeGreaterThanOrEqual(1);
    expect(rings[0]!.radius).toBeGreaterThan(0.5);
    expect(snap.units.find((u) => u.id === a.id)?.aoeHit).toBe(true);
    expect(snap.units.find((u) => u.id === b.id)?.aoeHit).toBe(true);
  });

  it('冲刺首撞生成前方扇形脉冲，同段不重复生成', () => {
    const world = new World(1);
    const cavalry = world.spawnUnit(Faction.Blue, 'melee_cavalry', fromFloat(9), fromFloat(10));
    world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(12.2));
    world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(12));

    let fanCount = 0;
    let charged = false;
    for (let i = 0; i < 50; i++) {
      world.step();
      if (cavalry.state === UnitState.Charge && cavalry.chargeWindupLeft <= 0) charged = true;
      fanCount += takeSnapshot(world).aoePulseEffects.filter((e) => e.kind === 'charge_fan').length;
      if (charged && cavalry.state !== UnitState.Charge) break;
    }

    expect(charged).toBe(true);
    // 首撞只冒一次扇形；效果持续数 tick，累加计数应落在持续窗口内
    expect(fanCount).toBeGreaterThanOrEqual(1);
    expect(fanCount).toBeLessThanOrEqual(8);
  });

  it('目标为建筑时不主动发动冲锋，改为接近并普攻', () => {
    const world = new World(1);
    const cavalry = world.spawnUnit(Faction.Blue, 'melee_cavalry', fromFloat(9), fromFloat(10));
    // 中心距 3.2，落在冲锋触发窗内；无此限制时会直接冲塔
    const tower = world.spawnBuilding(Faction.Red, 'building_tower', fromFloat(9), fromFloat(13.2));
    expect(tower).not.toBeNull();

    let sawCharge = false;
    let sawMeleeHit = false;
    for (let i = 0; i < 80; i++) {
      world.step();
      if (cavalry.state === UnitState.Charge) sawCharge = true;
      // 持续损耗也会掉血，必须低于「只掉寿命」才算普攻打中
      if (tower!.hp < towerHpAfterDecay(tower!.stats.maxHp, world.tick)) {
        sawMeleeHit = true;
        break;
      }
    }

    expect(sawCharge).toBe(false);
    expect(cavalry.chargeCooldown).toBe(0);
    expect(sawMeleeHit).toBe(true);
  });

  it('冲锋命中单位后，溅射不对建筑造成伤害或击退', () => {
    const world = new World(1);
    const cavalry = world.spawnUnit(Faction.Blue, 'melee_cavalry', fromFloat(9), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(13.3));
    const targetHp = target.hp;

    // 锁定单位并进入冲锋后再放塔，避免索敌改锁建筑
    let tower = null as ReturnType<World['spawnBuilding']>;
    let towerSpawnTick = 0;
    let charged = false;
    for (let i = 0; i < 60; i++) {
      world.step();
      if (!tower && cavalry.state === UnitState.Charge) {
        tower = world.spawnBuilding(Faction.Red, 'building_tower', fromFloat(10), fromFloat(13));
        towerSpawnTick = world.tick;
      }
      if (cavalry.state === UnitState.Charge && cavalry.chargeWindupLeft <= 0) charged = true;
      if (charged && cavalry.state !== UnitState.Charge) break;
    }

    expect(charged).toBe(true);
    expect(tower).not.toBeNull();
    expect(cavalry.chargeHits).toContain(target.id);
    expect(cavalry.chargeHits).not.toContain(tower!.id);
    expect(target.hp).toBeLessThan(targetHp);
    // 溅射不伤建筑；放置后只应扣除箭塔持续损耗
    expect(tower!.hp).toBe(towerHpAfterDecay(tower!.stats.maxHp, world.tick - towerSpawnTick));
    expect(toFloat(tower!.pos.x)).toBeCloseTo(10, 5);
    expect(toFloat(tower!.pos.y)).toBeCloseTo(13, 5);
  });
});
