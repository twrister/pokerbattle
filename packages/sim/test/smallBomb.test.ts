import { describe, expect, it } from 'vitest';
import {
  findFormationById,
  isFuseBombFormation,
  resolveCardFormation,
} from '../src/config/cardFormations.js';
import {
  computeTripleSmallBombDamage,
  TRIPLE_SMALL_BOMB_DAMAGE_BASE,
  TRIPLE_SMALL_BOMB_DAMAGE_PER_STRENGTH,
} from '../src/config/cardMapping.js';
import { getCardStrength, getPokerCardById } from '../src/cards/deck.js';
import { Faction } from '../src/entity/unit.js';
import { fromFloat, toFloat } from '../src/math/fixed.js';
import { takeSnapshot } from '../src/snapshot.js';
import { updateProjectiles } from '../src/systems/projectiles.js';
import { World } from '../src/world.js';
import { applyCommands } from '../src/systems/applyCommands.js';
import { playFormationCommand } from '../src/commands.js';

describe('小炸弹', () => {
  it('作为炸弹牌型可选单独配置，出牌走与巨型炸弹相同的投放路径', () => {
    const smallBomb = findFormationById('bomb_small_bomb');
    expect(smallBomb).toBeDefined();
    expect(isFuseBombFormation(smallBomb!)).toBe(true);

    const cards = ['5-spades', '5-hearts', '5-clubs', '5-diamonds'].map((id) => getPokerCardById(id)!);
    const resolved = resolveCardFormation(smallBomb!, cards);
    expect(resolved?.slots[0]?.typeId).toBe('small_bomb');

    const world = new World(1);
    world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(2));
    applyCommands(world, [
      playFormationCommand(
        Faction.Blue,
        'bomb_small_bomb',
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

  it('从己方主堡抛出，落地后按 attackInterval 闪烁再无差别伤害半径内单位与建筑', () => {
    const world = new World(1);
    const blueBase = world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(2))!;
    // aoeRadius=3.5：落点 (9,15) 内圈单位应受伤，外侧不受伤
    const ally = world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(15));
    const enemy = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(10), fromFloat(15));
    const air = world.spawnUnit(Faction.Red, 'dragon', fromFloat(8), fromFloat(15));
    const building = world.spawnBuilding(Faction.Red, 'building_tower', fromFloat(11), fromFloat(15))!;
    const outside = world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(13.5), fromFloat(15));
    const hp = new Map(world.units.map((unit) => [unit.id, unit.hp]));

    const projectile = world.spawnSmallBomb(Faction.Blue, fromFloat(9), fromFloat(15));
    expect(projectile.pos).toEqual(blueBase.pos);
    expect(projectile.visual).toBe('bomb');
    expect(projectile.fuseBombKind).toBe('small_bomb');
    // small_bomb 配置 attackInterval=10
    expect(projectile.fuseTicks).toBe(10);

    for (let i = 0; i < 100 && !projectile.landed; i += 1) updateProjectiles(world);
    expect(projectile.landed).toBe(true);
    expect(takeSnapshot(world).projectiles[0]).toMatchObject({
      landed: true,
      fuseBombKind: 'small_bomb',
    });

    for (let i = 0; i < 9; i += 1) updateProjectiles(world);
    expect(ally.hp).toBe(hp.get(ally.id));
    updateProjectiles(world);

    for (const unit of [ally, enemy, air, building]) {
      expect(toFloat(hp.get(unit.id)! - unit.hp)).toBeCloseTo(600, 3);
    }
    expect(outside.hp).toBe(hp.get(outside.id));
    expect(world.explosionEffects).toHaveLength(1);
    expect(world.explosionEffects[0]?.kind).toBe('normal');
  });

  it('四条小炸弹伤害仍为配置固定值 600', () => {
    const cards = ['5-spades', '5-hearts', '5-clubs', '5-diamonds'].map((id) => getPokerCardById(id)!);
    const world = new World(1);
    world.spawnBuilding(Faction.Blue, 'building_base', fromFloat(9), fromFloat(2));
    applyCommands(world, [
      playFormationCommand(
        Faction.Blue,
        'bomb_small_bomb',
        cards.map((card) => card.id),
        fromFloat(9),
        fromFloat(15),
      ),
    ]);
    expect(toFloat(world.projectiles[0]!.damage)).toBeCloseTo(600, 3);
  });

  it('三条兑换小炸弹伤害按牌力线性加成', () => {
    const triple = findFormationById('triple_small_bomb');
    expect(triple).toBeDefined();
    expect(isFuseBombFormation(triple!)).toBe(true);

    const playTriple = (cardIds: string[]) => {
      const cards = cardIds.map((id) => getPokerCardById(id)!);
      const expected =
        TRIPLE_SMALL_BOMB_DAMAGE_BASE +
        getCardStrength(cards[0]!) * TRIPLE_SMALL_BOMB_DAMAGE_PER_STRENGTH;
      expect(toFloat(computeTripleSmallBombDamage(cards))).toBeCloseTo(expected, 3);

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
      return expected;
    };

    expect(playTriple(['2-spades', '2-hearts', '2-clubs'])).toBe(400);
    expect(playTriple(['A-spades', 'A-hearts', 'A-clubs'])).toBe(1000);
  });
});
