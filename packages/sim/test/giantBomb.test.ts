import { describe, expect, it } from 'vitest';
import {
  applyCardFormationDrafts,
  dumpCardFormationDrafts,
  findFormationById,
  isGiantBombFormation,
  resetCardFormationsToDefault,
} from '../src/config/cardFormations.js';
import { FUSE_BOMB_MIN_FLIGHT_SECONDS, TICK_RATE, fuseBombFlightSpeed } from '../src/config/tuning.js';
import { playFormationCommand, spawnCommand } from '../src/commands.js';
import { Faction } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { takeSnapshot } from '../src/snapshot.js';
import { applyCommands } from '../src/systems/applyCommands.js';
import { updateProjectiles } from '../src/systems/projectiles.js';
import { World } from '../src/world.js';

describe('巨型炸弹', () => {
  it('作为炸弹牌型的唯一单独配置', () => {
    const giantBomb = findFormationById('bomb_giant_bomb');
    expect(giantBomb).toBeDefined();
    expect(isGiantBombFormation(giantBomb!)).toBe(true);
    expect(findFormationById('bomb_cavalry')).toBeUndefined();
  });

  it('从己方主堡抛出，落地当帧伤害半径内敌军单位与建筑', () => {
    const world = new World(1);
    const blueBase = world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(2))!;
    const ally = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(15));
    const allyBuilding = world.spawnBuilding(Faction.Blue, 'building_tower', fromFloat(7), fromFloat(15))!;
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(15));
    const air = world.spawnUnit(Faction.Red, 'dragon', fromFloat(8), fromFloat(15));
    const building = world.spawnBuilding(Faction.Red, 'building_tower', fromFloat(12), fromFloat(15))!;
    const outside = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(17.5), fromFloat(15));
    const hp = new Map(world.units.map((unit) => [unit.id, unit.hp]));

    const projectile = world.spawnGiantBomb(Faction.Blue, fromFloat(9), fromFloat(15));
    expect(projectile.pos).toEqual(blueBase.pos);
    expect(projectile.visual).toBe('bomb');
    expect(projectile.fuseBombKind).toBe('giant_bomb');
    const flying = takeSnapshot(world).projectiles[0]!;
    expect(flying.impactX).toBeCloseTo(9, 3);
    expect(flying.impactY).toBeCloseTo(15, 3);
    expect(flying.aoeRadius).toBeCloseTo(6, 3);

    for (let i = 0; i < 100 && !projectile.dead; i += 1) updateProjectiles(world);
    expect(projectile.dead).toBe(true);

    // 己方单位与建筑不受伤
    expect(ally.hp).toBe(hp.get(ally.id));
    expect(allyBuilding.hp).toBe(hp.get(allyBuilding.id));
    for (const unit of [enemy, air, building]) {
      expect(toFloat(hp.get(unit.id)! - unit.hp)).toBeCloseTo(600, 3);
    }
    expect(outside.hp).toBe(hp.get(outside.id));
    expect(world.explosionEffects).toHaveLength(1);
    expect(world.explosionEffects[0]?.kind).toBe('giant_bomb');
  });

  it('近处投放按最短 0.8s 压低速度，落地不少于 16 tick', () => {
    const world = new World(1);
    world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(2));
    const projectile = world.spawnGiantBomb(Faction.Blue, fromFloat(9), fromFloat(8));
    const expectedSpeed = fuseBombFlightSpeed(projectile.startDist, fromFloat(20));
    expect(toFloat(projectile.speed)).toBeCloseTo(toFloat(expectedSpeed), 3);
    expect(toFloat(projectile.speed)).toBeCloseTo(toFloat(projectile.startDist) / FUSE_BOMB_MIN_FLIGHT_SECONDS, 3);
    expect(toFloat(projectile.speed)).toBeLessThan(20);

    const minTicks = Math.round(FUSE_BOMB_MIN_FLIGHT_SECONDS * TICK_RATE);
    let ticks = 0;
    for (; ticks < 100 && !projectile.dead; ticks += 1) updateProjectiles(world);
    expect(projectile.dead).toBe(true);
    expect(ticks).toBeGreaterThanOrEqual(minTicks);
  });

  it('对敌方基地只造成一半伤害，单位与其它建筑仍是全额', () => {
    const world = new World(1);
    world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(2));
    const enemyBase = world.spawnBuilding(Faction.Red, 'building_base', fromFloat(9), fromFloat(15))!;
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(15));
    const tower = world.spawnBuilding(Faction.Red, 'building_tower', fromFloat(12), fromFloat(15))!;
    const hp = new Map(world.units.map((unit) => [unit.id, unit.hp]));

    const projectile = world.spawnGiantBomb(Faction.Blue, fromFloat(9), fromFloat(15));
    const full = toFloat(projectile.damage);
    for (let i = 0; i < 100 && !projectile.dead; i += 1) updateProjectiles(world);

    expect(toFloat(hp.get(enemy.id)! - enemy.hp)).toBeCloseTo(full, 3);
    expect(toFloat(hp.get(tower.id)! - tower.hp)).toBeCloseTo(full, 3);
    expect(toFloat(hp.get(enemyBase.id)! - enemyBase.hp)).toBeCloseTo(full / 2, 3);
  });

  it('Spawn 指令对巨型炸弹走主堡抛物线投放，不生成地面单位', () => {
    const world = new World(1);
    world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(2));
    world.step([spawnCommand(Faction.Blue, 'giant_bomb', fromFloat(9), fromFloat(15))]);
    expect(world.units.some((unit) => unit.typeId === 'giant_bomb')).toBe(false);
    expect(world.projectiles).toHaveLength(1);
    expect(world.projectiles[0]?.fuseBombKind).toBe('giant_bomb');
    expect(world.projectiles[0]?.visual).toBe('bomb');
  });

  it('四条按点数查表覆盖伤害', () => {
    const drafts = dumpCardFormationDrafts();
    const bomb = drafts.bomb.find((entry) => entry.id === 'bomb_giant_bomb')!;
    bomb.rankDamage = { ...bomb.rankDamage, '2-10': 800 };
    applyCardFormationDrafts(drafts);
    try {
      const play = (cardIds: string[]) => {
        const world = new World(1);
        world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(2));
        applyCommands(world, [
          playFormationCommand(Faction.Blue, 'bomb_giant_bomb', cardIds, fromFloat(9), fromFloat(15)),
        ]);
        return toFloat(world.projectiles[0]!.damage);
      };
      expect(play(['5-spades', '5-hearts', '5-clubs', '5-diamonds'])).toBeCloseTo(800, 3);
      expect(play(['A-spades', 'A-hearts', 'A-clubs', 'A-diamonds'])).toBeCloseTo(1000, 3);
    } finally {
      resetCardFormationsToDefault();
    }
  });

  it('火箭使用阵型固定伤害', () => {
    const drafts = dumpCardFormationDrafts();
    const rocket = drafts.rocket.find((entry) => entry.id === 'rocket_bomb')!;
    rocket.damage = 1500;
    applyCardFormationDrafts(drafts);
    try {
      const world = new World(1);
      world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(2));
      applyCommands(world, [
        playFormationCommand(
          Faction.Blue,
          'rocket_bomb',
          ['joker-black', 'joker-red'],
          fromFloat(9),
          fromFloat(15),
        ),
      ]);
      expect(toFloat(world.projectiles[0]!.damage)).toBeCloseTo(1500, 3);
    } finally {
      resetCardFormationsToDefault();
    }
  });

  it('四条与火箭出牌半径跟阵型走；缺字段回落单位配置', () => {
    expect(findFormationById('bomb_giant_bomb')?.aoeRadius).toBe(6);
    expect(findFormationById('rocket_bomb')?.aoeRadius).toBe(6);

    const playRadius = (formationId: string, cardIds: string[]) => {
      const world = new World(1);
      world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(2));
      applyCommands(world, [
        playFormationCommand(Faction.Blue, formationId, cardIds, fromFloat(9), fromFloat(15)),
      ]);
      return toFloat(world.projectiles[0]!.aoeRadius);
    };
    expect(playRadius('bomb_giant_bomb', ['5-spades', '5-hearts', '5-clubs', '5-diamonds'])).toBeCloseTo(6, 3);
    expect(playRadius('rocket_bomb', ['joker-black', 'joker-red'])).toBeCloseTo(6, 3);

    const drafts = dumpCardFormationDrafts();
    drafts.bomb.find((entry) => entry.id === 'bomb_giant_bomb')!.aoeRadius = 3;
    drafts.rocket.find((entry) => entry.id === 'rocket_bomb')!.aoeRadius = 8;
    applyCardFormationDrafts(drafts);
    try {
      expect(playRadius('bomb_giant_bomb', ['5-spades', '5-hearts', '5-clubs', '5-diamonds'])).toBeCloseTo(3, 3);
      expect(playRadius('rocket_bomb', ['joker-black', 'joker-red'])).toBeCloseTo(8, 3);
    } finally {
      resetCardFormationsToDefault();
    }

    const fallback = dumpCardFormationDrafts();
    delete fallback.bomb.find((entry) => entry.id === 'bomb_giant_bomb')!.aoeRadius;
    applyCardFormationDrafts(fallback);
    try {
      expect(playRadius('bomb_giant_bomb', ['5-spades', '5-hearts', '5-clubs', '5-diamonds'])).toBeCloseTo(6, 3);
    } finally {
      resetCardFormationsToDefault();
    }
  });
});
