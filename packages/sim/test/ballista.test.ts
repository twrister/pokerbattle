import { describe, expect, it } from 'vitest';
import { getUnitConfig, toUnitConfigDraft, usesArrowVisual } from '../src/config/units.js';
import { Faction } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { World } from '../src/world.js';

function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) world.step();
}

describe('连弩车', () => {
  it('加载指定基础参数、对空优先与箭矢弹道', () => {
    const world = new World(1);
    const ballista = world.spawnUnit(Faction.Blue, 'ranged_ballista', fromFloat(8), fromFloat(8));

    expect(ballista.config.name).toBe('连弩车');
    expect(toFloat(ballista.config.radius)).toBeCloseTo(0.8, 3);
    expect(toFloat(ballista.config.bodyScale)).toBeCloseTo(1.2, 3);
    expect(toFloat(ballista.stats.maxHp)).toBeCloseTo(600, 3);
    expect(toFloat(ballista.stats.damage)).toBeCloseTo(60, 3);
    expect(toFloat(ballista.stats.attackInterval)).toBeCloseTo(20, 3);
    expect(toFloat(ballista.stats.attackWindup)).toBeCloseTo(9, 3);
    expect(toFloat(ballista.stats.range)).toBeCloseTo(8, 3);
    expect(toFloat(ballista.stats.moveSpeed)).toBeCloseTo(0.8, 3);
    expect(toFloat(ballista.config.sightRange)).toBeCloseTo(9, 3);
    expect(ballista.config.movementLayer).toBe('ground');
    expect(ballista.config.canAttackAir).toBe(true);
    expect(ballista.config.preferAir).toBe(true);
    expect(ballista.config.attack.kind).toBe('projectile');
    expect(usesArrowVisual('ranged_ballista')).toBe(true);
    expect(toUnitConfigDraft(getUnitConfig('ranged_ballista')).preferAir).toBe(true);
    expect(toUnitConfigDraft(getUnitConfig('ranged_archer')).preferAir).toBeUndefined();
  });

  it('射程内更远的空中单位优先于更近的地面单位', () => {
    const world = new World(1);
    const ballista = world.spawnUnit(Faction.Blue, 'ranged_ballista', fromFloat(9), fromFloat(10));
    const ground = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(12));
    const air = world.spawnUnit(Faction.Red, 'dragon', fromFloat(9), fromFloat(16));
    ballista.retargetIn = 0;

    run(world, 1);
    expect(ballista.targetId).toBe(air.id);
    expect(ballista.targetId).not.toBe(ground.id);
  });

  it('打地面时射程内出现空中单位应打断粘性换火', () => {
    const world = new World(1);
    const ballista = world.spawnUnit(Faction.Blue, 'ranged_ballista', fromFloat(9), fromFloat(10));
    const ground = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(12));
    ballista.retargetIn = 0;

    run(world, 1);
    expect(ballista.targetId).toBe(ground.id);

    const air = world.spawnUnit(Faction.Red, 'dragon', fromFloat(9), fromFloat(16));
    run(world, 1);
    expect(ballista.targetId).toBe(air.id);
  });

  it('弓手不受 preferAir 影响，仍锁射程内更近的地面单位', () => {
    const world = new World(1);
    const archer = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(9), fromFloat(10));
    const ground = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(11.5));
    const air = world.spawnUnit(Faction.Red, 'dragon', fromFloat(9), fromFloat(14.5));
    archer.retargetIn = 0;

    run(world, 1);
    expect(archer.config.preferAir).toBe(false);
    expect(archer.targetId).toBe(ground.id);
    expect(archer.targetId).not.toBe(air.id);
  });

  it('发射追踪箭矢，命中特效为 explode4', () => {
    const world = new World(1);
    const ballista = world.spawnUnit(Faction.Blue, 'ranged_ballista', fromFloat(5), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(12), fromFloat(10));
    const projectile = world.spawnProjectile(
      ballista,
      target,
      ballista.stats.damage,
      fromFloat(9),
    );

    expect(projectile.visual).toBe('arrow');
    expect(projectile.impactFx).toBe('explode4');
    expect(projectile.homing).toBe(true);
  });
});
