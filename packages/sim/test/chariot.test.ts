import { describe, expect, it } from 'vitest';
import { BOMB_ARC_APEX, GROUND_PROJECTILE_HEIGHT } from '../src/config/tuning.js';
import { Faction, UnitState } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { takeSnapshot } from '../src/snapshot.js';
import { updateAi } from '../src/systems/ai.js';
import { updateCombat } from '../src/systems/combat.js';
import { updateProjectiles } from '../src/systems/projectiles.js';
import { World } from '../src/world.js';

/** 推进弹道直到指定飞行物结束，避免测试依赖完整 AI 流水线。 */
function flyUntilImpact(world: World, projectileId: number, maxTicks = 200): void {
  for (let i = 0; i < maxTicks; i++) {
    const projectile = world.projectiles.find((item) => item.id === projectileId);
    if (!projectile || projectile.dead) return;
    updateProjectiles(world);
  }
  throw new Error('战车炸弹未在预期 tick 内落地');
}

describe('战车', () => {
  it('加载指定基础参数与最小射程 / 落点范围弹道', () => {
    const world = new World(1);
    const chariot = world.spawnUnit(Faction.Blue, 'ranged_chariot', fromFloat(8), fromFloat(8));

    expect(toFloat(chariot.config.radius)).toBeCloseTo(0.7, 3);
    expect(toFloat(chariot.config.bodyScale)).toBeCloseTo(1.2, 3);
    expect(toFloat(chariot.config.mass)).toBeCloseTo(2, 3);
    expect(toFloat(chariot.stats.maxHp)).toBeCloseTo(600, 3);
    expect(toFloat(chariot.stats.damage)).toBeCloseTo(120, 3);
    expect(toFloat(chariot.stats.attackInterval)).toBeCloseTo(60, 3);
    expect(toFloat(chariot.stats.attackWindup)).toBeCloseTo(12, 3);
    expect(toFloat(chariot.stats.range)).toBeCloseTo(10, 3);
    expect(toFloat(chariot.config.minRange)).toBeCloseTo(3, 3);
    expect(toFloat(chariot.stats.moveSpeed)).toBeCloseTo(1, 3);
    expect(chariot.config.movementLayer).toBe('ground');
    expect(chariot.config.attack.kind).toBe('projectile_aoe');
    if (chariot.config.attack.kind === 'projectile_aoe') {
      expect(toFloat(chariot.config.attack.speed)).toBeCloseTo(9, 3);
      expect(toFloat(chariot.config.attack.aoeRadius)).toBeCloseTo(1.5, 3);
    }
  });

  it('贴进最小射程时 AI 站定 Idle 且不起手前摇', () => {
    const world = new World(1);
    // 边缘距 ≈ 圆心距 - 0.7 - 0.5；圆心距 2 → 边缘距 0.8 < 3
    const chariot = world.spawnUnit(Faction.Blue, 'ranged_chariot', fromFloat(8), fromFloat(8));
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(8));
    chariot.targetId = enemy.id;
    chariot.attackCooldown = 0;
    chariot.windupLeft = 0;

    updateAi(world);
    expect(chariot.state).toBe(UnitState.Idle);

    updateCombat(world);
    expect(chariot.windupLeft).toBe(0);
    expect(world.projectiles).toHaveLength(0);
  });

  it('射程带内可发射炸弹，落地造成范围伤害并生成爆炸特效', () => {
    const world = new World(1);
    const chariot = world.spawnUnit(Faction.Blue, 'ranged_chariot', fromFloat(5), fromFloat(10));
    // 边缘距 ≈ 5 - 0.7 - 0.5 = 3.8，落在 3～10 带内
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(10));
    const splash = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(11.2), fromFloat(10));
    const outside = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(12.0), fromFloat(10));
    const ally = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(10.5), fromFloat(10));
    const hp = new Map(world.units.map((unit) => [unit.id, unit.hp]));

    const projectile = world.spawnProjectile(
      chariot,
      target,
      chariot.stats.damage,
      fromFloat(9),
      fromFloat(1.5),
    );
    expect(projectile.visual).toBe('bomb');
    expect(projectile.impactFx).toBe('explosion');
    expect(projectile.arcApex).toBe(BOMB_ARC_APEX);

    flyUntilImpact(world, projectile.id);

    expect(toFloat(hp.get(target.id)! - target.hp)).toBeCloseTo(120, 3);
    expect(toFloat(hp.get(splash.id)! - splash.hp)).toBeCloseTo(120, 3);
    expect(outside.hp).toBe(hp.get(outside.id));
    expect(ally.hp).toBe(hp.get(ally.id));
    expect(world.explosionEffects).toHaveLength(1);
    expect(world.explosionEffects[0]?.kind).toBe('normal');
    expect(world.aoePulseEffects).toHaveLength(0);
  });

  it('飞行中高度峰值高于起终点，形成抛物线', () => {
    const world = new World(1);
    const chariot = world.spawnUnit(Faction.Blue, 'ranged_chariot', fromFloat(5), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(14), fromFloat(10));
    const projectile = world.spawnProjectile(
      chariot,
      target,
      chariot.stats.damage,
      fromFloat(9),
      fromFloat(1.5),
    );

    expect(projectile.height).toBeCloseTo(GROUND_PROJECTILE_HEIGHT, 3);
    let peak = projectile.height;
    for (let i = 0; i < 200; i++) {
      if (projectile.dead) break;
      updateProjectiles(world);
      peak = Math.max(peak, projectile.height);
    }

    expect(projectile.dead).toBe(true);
    // 中点附近应明显高于出生高度与落点 0
    expect(peak).toBeGreaterThan(GROUND_PROJECTILE_HEIGHT + BOMB_ARC_APEX * 0.5);
  });

  it('快照透出 bomb visual', () => {
    const world = new World(1);
    const chariot = world.spawnUnit(Faction.Blue, 'ranged_chariot', fromFloat(5), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(10));
    world.spawnProjectile(chariot, target, chariot.stats.damage, fromFloat(9), fromFloat(1.5));

    const snap = takeSnapshot(world);
    expect(snap.projectiles).toHaveLength(1);
    expect(snap.projectiles[0]!.visual).toBe('bomb');
  });

  it('弓箭手弹道使用 arrow visual', () => {
    const world = new World(1);
    const archer = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(5), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(10));
    world.spawnProjectile(archer, target, archer.stats.damage, fromFloat(9));

    const snap = takeSnapshot(world);
    expect(snap.projectiles).toHaveLength(1);
    expect(snap.projectiles[0]!.visual).toBe('arrow');
  });

  it('发射后落点锁定，目标走开则打空且溅射仍打原落点', () => {
    const world = new World(1);
    const chariot = world.spawnUnit(Faction.Blue, 'ranged_chariot', fromFloat(5), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(10));
    const splash = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(11.2), fromFloat(10));
    const targetHp = target.hp;
    const splashHp = splash.hp;
    const projectile = world.spawnProjectile(
      chariot,
      target,
      chariot.stats.damage,
      fromFloat(9),
      fromFloat(1.5),
    );
    expect(projectile.homing).toBe(false);
    const lockX = projectile.impactPos.x;
    const lockY = projectile.impactPos.y;

    target.pos.x = fromFloat(10);
    target.pos.y = fromFloat(20);

    flyUntilImpact(world, projectile.id);

    expect(projectile.impactPos.x).toBe(lockX);
    expect(projectile.impactPos.y).toBe(lockY);
    expect(target.hp).toBe(targetHp);
    expect(splash.hp).toBeLessThan(splashHp);
    expect(world.explosionEffects).toHaveLength(1);
  });

  it('弓箭手弹道仍追踪移动目标', () => {
    const world = new World(1);
    const archer = world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(5), fromFloat(10));
    const target = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(10));
    const targetHp = target.hp;
    const projectile = world.spawnProjectile(archer, target, archer.stats.damage, fromFloat(9));
    expect(projectile.homing).toBe(true);

    target.pos.x = fromFloat(9);
    target.pos.y = fromFloat(16);
    updateProjectiles(world);

    expect(toFloat(projectile.impactPos.x)).toBeCloseTo(9, 3);
    expect(toFloat(projectile.impactPos.y)).toBeCloseTo(16, 3);

    flyUntilImpact(world, projectile.id);

    expect(target.hp).toBeLessThan(targetHp);
    expect(projectile.dead).toBe(true);
  });
});
