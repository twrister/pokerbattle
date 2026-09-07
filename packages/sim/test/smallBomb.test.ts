import { describe, expect, it } from 'vitest';
import {
  applyCardFormationDrafts,
  dumpCardFormationDrafts,
  findFormationById,
  isFuseBombFormation,
  resetCardFormationsToDefault,
  resolveCardFormation,
} from '../src/config/cardFormations.js';
import { resolveFuseBombDamage } from '../src/config/cardMapping.js';
import { getPokerCardById } from '../src/cards/deck.js';
import { Faction } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { takeSnapshot } from '../src/snapshot.js';
import { updateProjectiles } from '../src/systems/projectiles.js';
import { World } from '../src/world.js';
import { applyCommands } from '../src/systems/applyCommands.js';
import { playFormationCommand } from '../src/commands.js';

describe('小炸弹', () => {
  it('作为三条可选配置，出牌走主堡抛物线投放', () => {
    const smallBomb = findFormationById('triple_small_bomb');
    expect(smallBomb).toBeDefined();
    expect(isFuseBombFormation(smallBomb!)).toBe(true);

    const cards = ['5-spades', '5-hearts', '5-clubs'].map((id) => getPokerCardById(id)!);
    const resolved = resolveCardFormation(smallBomb!, cards);
    expect(resolved?.slots[0]?.typeId).toBe('small_bomb');

    const world = new World(1);
    world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(2));
    applyCommands(world, [
      playFormationCommand(
        Faction.Blue,
        'triple_small_bomb',
        cards.map((card) => card.id),
        fromFloat(9),
        fromFloat(15),
      ),
    ]);
    expect(world.projectiles).toHaveLength(1);
    expect(world.projectiles[0]?.fuseBombKind).toBe('small_bomb');
    expect(world.units.filter((unit) => unit.typeId === 'small_bomb')).toHaveLength(0);
  });

  it('敌军不能锁定投放炸弹兵种配置单位', () => {
    const world = new World(1);
    const melee = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(15));
    const smallBomb = world.spawnUnit(Faction.Red, 'small_bomb', fromFloat(9), fromFloat(16));
    const ground = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(9), fromFloat(20));
    ground.stats.damage = 0;
    const bombHp = smallBomb.hp;

    for (let i = 0; i < 40; i++) world.step();

    expect(melee.targetId).toBe(ground.id);
    expect(smallBomb.hp).toBe(bombHp);
  });

  it('从己方主堡抛出，落地当帧伤害半径内敌军单位与建筑', () => {
    const world = new World(1);
    const blueBase = world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(2))!;
    const ally = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(15));
    const allyBuilding = world.spawnBuilding(Faction.Blue, 'building_tower', fromFloat(7), fromFloat(15))!;
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(15));
    const air = world.spawnUnit(Faction.Red, 'dragon', fromFloat(8), fromFloat(15));
    const building = world.spawnBuilding(Faction.Red, 'building_tower', fromFloat(11), fromFloat(15))!;
    const outside = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(13.5), fromFloat(15));
    const hp = new Map(world.units.map((unit) => [unit.id, unit.hp]));

    const projectile = world.spawnSmallBomb(Faction.Blue, fromFloat(9), fromFloat(15));
    expect(projectile.pos).toEqual(blueBase.pos);
    expect(projectile.visual).toBe('bomb');
    expect(projectile.fuseBombKind).toBe('small_bomb');
    const flying = takeSnapshot(world).projectiles[0]!;
    expect(flying.impactX).toBeCloseTo(9, 3);
    expect(flying.impactY).toBeCloseTo(15, 3);
    expect(flying.aoeRadius).toBeCloseTo(2.5, 3);

    for (let i = 0; i < 100 && !projectile.dead; i += 1) updateProjectiles(world);
    expect(projectile.dead).toBe(true);

    // 己方单位与建筑不受伤
    expect(ally.hp).toBe(hp.get(ally.id));
    expect(allyBuilding.hp).toBe(hp.get(allyBuilding.id));
    for (const unit of [enemy, air, building]) {
      expect(toFloat(hp.get(unit.id)! - unit.hp)).toBeCloseTo(500, 3);
    }
    expect(outside.hp).toBe(hp.get(outside.id));
    expect(world.explosionEffects).toHaveLength(1);
    expect(world.explosionEffects[0]?.kind).toBe('normal');
  });

  it('对敌方基地只造成一半伤害，单位仍是全额', () => {
    const world = new World(1);
    world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(2));
    const enemyBase = world.spawnBuilding(Faction.Red, 'building_base', fromFloat(9), fromFloat(15))!;
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(15));
    const hp = new Map(world.units.map((unit) => [unit.id, unit.hp]));

    const projectile = world.spawnSmallBomb(Faction.Blue, fromFloat(9), fromFloat(15));
    const full = toFloat(projectile.damage);
    for (let i = 0; i < 100 && !projectile.dead; i += 1) updateProjectiles(world);

    expect(toFloat(hp.get(enemy.id)! - enemy.hp)).toBeCloseTo(full, 3);
    expect(toFloat(hp.get(enemyBase.id)! - enemyBase.hp)).toBeCloseTo(full / 2, 3);
  });

  it('三条小炸弹伤害按点数表取值', () => {
    const triple = findFormationById('triple_small_bomb');
    expect(triple).toBeDefined();
    expect(isFuseBombFormation(triple!)).toBe(true);
    expect(triple!.rankDamage?.['2-10']).toBe(500);
    expect(triple!.rankDamage?.A).toBe(900);

    const playTriple = (cardIds: string[], expected: number) => {
      const cards = cardIds.map((id) => getPokerCardById(id)!);
      expect(toFloat(resolveFuseBombDamage(triple!, cards)!)).toBeCloseTo(expected, 3);

      const world = new World(1);
      world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(2));
      applyCommands(world, [
        playFormationCommand(
          Faction.Blue,
          'triple_small_bomb',
          cardIds,
          fromFloat(9),
          fromFloat(15),
        ),
      ]);
      expect(world.projectiles).toHaveLength(1);
      expect(toFloat(world.projectiles[0]!.damage)).toBeCloseTo(expected, 3);
    };

    playTriple(['2-spades', '2-hearts', '2-clubs'], 500);
    playTriple(['5-spades', '5-hearts', '5-clubs'], 500);
    playTriple(['A-spades', 'A-hearts', 'A-clubs'], 900);
  });

  it('改点数表后三条小炸弹出牌伤害跟着变；缺档回落单位配置', () => {
    const drafts = dumpCardFormationDrafts();
    const triple = drafts.triple.find((entry) => entry.id === 'triple_small_bomb')!;
    triple.rankDamage = { ...triple.rankDamage, '2-10': 777 };
    delete triple.rankDamage!.J;
    applyCardFormationDrafts(drafts);
    try {
      const play = (cardIds: string[]) => {
        const world = new World(1);
        world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(2));
        applyCommands(world, [
          playFormationCommand(Faction.Blue, 'triple_small_bomb', cardIds, fromFloat(9), fromFloat(15)),
        ]);
        return toFloat(world.projectiles[0]!.damage);
      };
      expect(play(['2-spades', '2-hearts', '2-clubs'])).toBeCloseTo(777, 3);
      expect(play(['5-spades', '5-hearts', '5-clubs'])).toBeCloseTo(777, 3);
      expect(play(['J-spades', 'J-hearts', 'J-clubs'])).toBeCloseTo(500, 3);
    } finally {
      resetCardFormationsToDefault();
    }
  });

  it('三条小炸弹出牌半径跟阵型走；缺字段回落单位配置', () => {
    const triple = findFormationById('triple_small_bomb');
    expect(triple?.aoeRadius).toBe(2.5);

    const playRadius = (cardIds: string[]) => {
      const world = new World(1);
      world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(2));
      applyCommands(world, [
        playFormationCommand(Faction.Blue, 'triple_small_bomb', cardIds, fromFloat(9), fromFloat(15)),
      ]);
      return toFloat(world.projectiles[0]!.aoeRadius);
    };
    expect(playRadius(['5-spades', '5-hearts', '5-clubs'])).toBeCloseTo(2.5, 3);

    const drafts = dumpCardFormationDrafts();
    const draft = drafts.triple.find((entry) => entry.id === 'triple_small_bomb')!;
    draft.aoeRadius = 4;
    applyCardFormationDrafts(drafts);
    try {
      expect(playRadius(['5-spades', '5-hearts', '5-clubs'])).toBeCloseTo(4, 3);
    } finally {
      resetCardFormationsToDefault();
    }

    const fallback = dumpCardFormationDrafts();
    const fallbackDraft = fallback.triple.find((entry) => entry.id === 'triple_small_bomb')!;
    delete fallbackDraft.aoeRadius;
    applyCardFormationDrafts(fallback);
    try {
      expect(playRadius(['5-spades', '5-hearts', '5-clubs'])).toBeCloseTo(2.5, 3);
    } finally {
      resetCardFormationsToDefault();
    }
  });
});
