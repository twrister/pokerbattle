import { describe, expect, it } from 'vitest';
import {
  CommandKind,
  CASTLE_PROTECT_HP,
  fromFloat,
  getPokerCardById,
  isDeployAnchorInsideHalfCourt,
  toFloat,
} from '../src/index.js';
import { Faction } from '../src/entity/unit.js';
import { MatchState } from '../src/match/matchState.js';
import { SoloBotController } from '../src/match/soloBot.js';

describe('SoloBotController', () => {
  it('手牌不超过 5 张时不出牌，继续攒牌', () => {
    const match = createMatch();
    match.setInitialHandSize(4);
    const bot = new SoloBotController('easy', 77);

    expect(match.decks[Faction.Red].hand.length).toBeLessThanOrEqual(5);
    expect(bot.decide(match)).toBeNull();
  });

  it('空场满血时困难档 6 张继续囤牌', () => {
    const match = createMatch();
    setHand(match, Faction.Red, ['2-hearts', '4-hearts', '6-hearts', '8-hearts', '9-spades', '3-clubs']);
    const bot = new SoloBotController('hard', 77);

    expect(bot.decide(match)).toBeNull();
  });

  it('只产生通过对局校验的红方出牌，并由 MatchState 正常扣牌', () => {
    const match = createMatch();
    fillHandNearLimit(match, Faction.Red);
    const bot = new SoloBotController('easy', 77);
    const before = match.decks[Faction.Red].hand.length;

    const command = bot.decide(match);

    expect(command).not.toBeNull();
    expect(command?.kind).toBe(CommandKind.PlayFormation);
    expect(command?.faction).toBe(Faction.Red);
    if (command?.kind !== CommandKind.PlayFormation) throw new Error('期望出牌指令');
    expect(command.cardIds.length).toBeGreaterThanOrEqual(1);
    expect(match.validate(command)).toBe(true);
    match.step([command]);
    expect(match.decks[Faction.Red].hand.length).toBeLessThan(before);
  });

  it('相同种子与局面会做出完全相同的首个决策', () => {
    const first = createMatch();
    const second = createMatch();
    setHand(first, Faction.Red, dumpHandIds());
    setHand(second, Faction.Red, dumpHandIds());

    const commandA = new SoloBotController('hard', 99).decide(first);
    const commandB = new SoloBotController('hard', 99).decide(second);

    expect(commandA).toEqual(commandB);
  });

  it('出牌后遵守思考冷却，不会连续每帧操作', () => {
    const match = createMatch();
    fillHand(match, Faction.Red, match.getMaxHandSize());
    const bot = new SoloBotController('hard', 5);
    const command = bot.decide(match);
    expect(command).not.toBeNull();
    match.step([command!]);

    expect(bot.decide(match)).toBeNull();
  });

  it('有待领取保护卡包时立刻领取，不受攒牌门槛限制', () => {
    const match = createMatch();
    const castle = match.world.units.find(
      (unit) => unit.faction === Faction.Red && unit.typeId === 'building_base',
    );
    if (!castle) throw new Error('主堡未生成');
    castle.hp = fromFloat(CASTLE_PROTECT_HP - 1);
    match.step();
    expect(match.getCastlePackState(Faction.Red)).toBe('pending');

    const command = new SoloBotController('easy', 77).decide(match);
    expect(command?.kind).toBe(CommandKind.ClaimCastlePack);
    expect(command?.faction).toBe(Faction.Red);
  });

  it('压力小时打出阻碍凑大牌的废牌，而不是最强组合', () => {
    const match = createMatch();
    setHand(match, Faction.Red, fullDumpHandIds());
    const command = new SoloBotController('hard', 11).decide(match);

    expect(command?.kind).toBe(CommandKind.PlayFormation);
    if (command?.kind !== CommandKind.PlayFormation) throw new Error('期望出牌指令');
    expect(command.cardIds).toHaveLength(1);
    expect(['9-spades', '3-clubs', 'K-diamonds', 'J-clubs', 'Q-clubs']).toContain(command.cardIds[0]);
  });

  it('半场有敌军时会放置箭塔防守', () => {
    const match = createMatch();
    const castle = requireCastle(match, Faction.Red);
    // 两个近战压境，防守缺口大小刚好让一座箭塔够用
    for (let index = 0; index < 2; index += 1) {
      match.world.spawnUnit(
        Faction.Blue,
        'melee_grunt',
        fromFloat(toFloat(castle.pos.x) - 0.5 + index),
        fromFloat(toFloat(castle.pos.y) - 8),
      );
    }
    // 10-J-Q-K 顺子可展开为 3 档特殊牌（箭塔/小巨人）；被压制时应出箭塔
    setHand(match, Faction.Red, ['10-spades', 'J-hearts', 'Q-clubs', 'K-diamonds']);

    const command = new SoloBotController('hard', 21).decide(match);

    expect(command?.kind).toBe(CommandKind.PlayFormation);
    if (command?.kind !== CommandKind.PlayFormation) throw new Error('期望出牌指令');
    expect(command.formationId).toContain('building_tower');
    expect(isDeployAnchorInsideHalfCourt(toFloat(command.x), toFloat(command.y), Faction.Red)).toBe(true);
  });

  it('困难档空场时手牌离上限还差 2 张继续囤牌', () => {
    const match = createMatch();
    fillHand(match, Faction.Red, match.getMaxHandSize() - 2);

    expect(new SoloBotController('hard', 3).decide(match)).toBeNull();
  });

  it('困难档半场只有一个小兵且已有箭塔时不动用手牌', () => {
    const match = createMatch();
    const castle = requireCastle(match, Faction.Red);
    match.world.spawnUnit(Faction.Red, 'building_tower', castle.pos.x, fromFloat(toFloat(castle.pos.y) - 4));
    match.world.spawnUnit(Faction.Blue, 'melee_grunt', castle.pos.x, fromFloat(toFloat(castle.pos.y) - 9));
    setHand(match, Faction.Red, ['10-spades', 'J-hearts', 'Q-clubs', 'K-diamonds', '5-clubs', '2-hearts']);

    expect(new SoloBotController('hard', 21).decide(match)).toBeNull();
  });

  it('困难档手握大牌型且接近满手时打出五张牌组', () => {
    const match = createMatch();
    setHand(match, Faction.Red, [
      '2-hearts', '5-hearts', '7-hearts', '9-hearts', 'J-hearts', '3-clubs', 'K-spades', '8-diamonds',
    ]);

    const command = new SoloBotController('hard', 8).decide(match);

    expect(command?.kind).toBe(CommandKind.PlayFormation);
    if (command?.kind !== CommandKind.PlayFormation) throw new Error('期望出牌指令');
    expect(command.cardIds.length).toBe(5);
  });

  it('困难档爆兵后连击间隔明显短于普通出牌冷却', () => {
    const match = createMatch();
    setHand(match, Faction.Red, [
      '2-hearts', '5-hearts', '7-hearts', '9-hearts', 'J-hearts', '3-clubs', 'K-spades', '8-diamonds',
    ]);
    const bot = new SoloBotController('hard', 8);
    const first = bot.decide(match);
    expect(first).not.toBeNull();
    match.step([first!]);

    // 普通冷却至少 14 帧；连击冷却应在 12 帧内恢复
    let ticks = 0;
    let next = bot.decide(match);
    while (!next && ticks < 14) {
      match.step();
      ticks += 1;
      next = bot.decide(match);
    }
    expect(next).not.toBeNull();
  });

  it('敌军贴己方基地时把兵放到敌军堆附近', () => {
    const match = createMatch();
    const castle = requireCastle(match, Faction.Red);
    const attackerX = toFloat(castle.pos.x) + 1;
    const attackerY = toFloat(castle.pos.y) - 3;
    const attacker = match.world.spawnUnit(
      Faction.Blue,
      'melee_grunt',
      fromFloat(attackerX),
      fromFloat(attackerY),
    );
    attacker.targetId = castle.id;
    setHand(match, Faction.Red, ['5-hearts', '7-clubs', '9-diamonds']);

    const command = new SoloBotController('hard', 33).decide(match);

    expect(command?.kind).toBe(CommandKind.PlayFormation);
    if (command?.kind !== CommandKind.PlayFormation) throw new Error('期望出牌指令');
    expect(isDeployAnchorInsideHalfCourt(toFloat(command.x), toFloat(command.y), Faction.Red)).toBe(true);
    expect(Math.hypot(toFloat(command.x) - attackerX, toFloat(command.y) - attackerY)).toBeLessThan(3);
  });

  it('己方前排很多、后排没有时更倾向出远程', () => {
    const match = createMatch();
    const castle = requireCastle(match, Faction.Red);
    for (let index = 0; index < 6; index += 1) {
      match.world.spawnUnit(
        Faction.Red,
        'melee_grunt',
        fromFloat(toFloat(castle.pos.x) - 3 + index),
        fromFloat(toFloat(castle.pos.y) - 5),
      );
    }
    // 满手且全是对子/三条骨架，只能打组合
    setHand(match, Faction.Red, [
      '5-hearts', '5-clubs', '5-spades', '7-hearts', '7-clubs', '9-hearts', '9-clubs', 'J-hearts', 'J-clubs',
    ]);

    const command = new SoloBotController('hard', 44).decide(match);

    expect(command?.kind).toBe(CommandKind.PlayFormation);
    if (command?.kind !== CommandKind.PlayFormation) throw new Error('期望出牌指令');
    expect(command.formationId).toContain('archer');
  });
});

function createMatch(): MatchState {
  const match = new MatchState(20260806);
  match.seedStartingCastles();
  return match;
}

function requireCastle(match: MatchState, faction: Faction) {
  const castle = match.world.units.find((unit) => unit.faction === faction && unit.typeId === 'building_base');
  if (!castle) throw new Error('主堡未生成');
  return castle;
}

/** 4 张同花骨架 + 3 张杂色，方便断言清废牌。 */
function dumpHandIds(): string[] {
  return ['2-hearts', '4-hearts', '6-hearts', '8-hearts', '9-spades', '3-clubs', 'K-diamonds'];
}

/** 4 张同花骨架 + 5 张杂牌，凑满默认手牌上限 9。 */
function fullDumpHandIds(): string[] {
  return [...dumpHandIds(), 'J-clubs', 'Q-clubs'];
}

/** 把手牌补到指定张数，用于构造满手局面。 */
function fillHand(match: MatchState, faction: Faction, size: number): void {
  while (match.decks[faction].hand.length < size) {
    if (!match.decks[faction].draw()) break;
  }
  expect(match.decks[faction].hand).toHaveLength(size);
}

function setHand(match: MatchState, faction: Faction, cardIds: readonly string[]): void {
  const cards = cardIds.map((id) => {
    const card = getPokerCardById(id);
    if (!card) throw new Error(`未知牌 ${id}`);
    return card;
  });
  match.decks[faction].reset(cards);
  match.decks[faction].drawMany(cards.length);
  expect(match.decks[faction].hand).toHaveLength(cardIds.length);
}

/** 抽到手牌上限前一张，逼人机在安全局面也必须出手。 */
function fillHandNearLimit(match: MatchState, faction: Faction): void {
  const limit = match.getMaxHandSize();
  while (match.decks[faction].hand.length < limit - 1) {
    if (!match.decks[faction].draw()) break;
  }
  expect(match.decks[faction].hand.length).toBeGreaterThanOrEqual(limit - 1);
}
