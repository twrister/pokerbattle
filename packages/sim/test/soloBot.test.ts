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
    fillHandNearLimit(match, Faction.Red);
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
    setHand(match, Faction.Red, dumpHandIds());
    const command = new SoloBotController('hard', 11).decide(match);

    expect(command?.kind).toBe(CommandKind.PlayFormation);
    if (command?.kind !== CommandKind.PlayFormation) throw new Error('期望出牌指令');
    expect(command.cardIds).toHaveLength(1);
    expect(['9-spades', '3-clubs', 'K-diamonds']).toContain(command.cardIds[0]);
  });

  it('半场有敌军时会放置箭塔防守', () => {
    const match = createMatch();
    const castle = requireCastle(match, Faction.Red);
    match.world.spawnUnit(
      Faction.Blue,
      'melee_grunt',
      castle.pos.x,
      fromFloat(toFloat(castle.pos.y) - 8),
    );
    setHand(match, Faction.Red, ['10-spades', 'J-hearts', 'Q-clubs', 'K-diamonds', '5-clubs']);

    const command = new SoloBotController('hard', 21).decide(match);

    expect(command?.kind).toBe(CommandKind.PlayFormation);
    if (command?.kind !== CommandKind.PlayFormation) throw new Error('期望出牌指令');
    expect(command.formationId).toContain('building_tower');
    expect(isDeployAnchorInsideHalfCourt(toFloat(command.x), toFloat(command.y), Faction.Red)).toBe(true);
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
    setHand(match, Faction.Red, ['5-hearts']);

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
