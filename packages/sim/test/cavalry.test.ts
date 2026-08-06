import { describe, expect, it } from 'vitest';
import { Faction, UnitState } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { World } from '../src/world.js';

describe('骑兵冲刺', () => {
  it('CD 就绪且目标在 2～2.5 格时进入冲刺并前进约 3 格', () => {
    const world = new World(1);
    // 中心距 2.25，落在触发窗内；双方尚未索敌前不会互相走近
    const cavalry = world.spawnUnit(Faction.Blue, 'melee_cavalry', fromFloat(9), fromFloat(10));
    world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(12.25));

    const startY = cavalry.pos.y;
    let sawCharge = false;
    for (let i = 0; i < 40; i++) {
      world.step();
      if (cavalry.state === UnitState.Charge) sawCharge = true;
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
    for (let i = 0; i < 30; i++) {
      world.step();
      if (cavalry.state === UnitState.Charge) charged = true;
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
});
