import { describe, expect, it } from 'vitest';
import { CommandKind, CASTLE_PROTECT_HP, fromFloat } from '../src/index.js';
import { Faction } from '../src/entity/unit.js';
import { MatchState } from '../src/match/matchState.js';
import { SoloBotController } from '../src/match/soloBot.js';

describe('SoloBotController', () => {
  it('手牌不超过 5 张时不出牌，继续攒牌', () => {
    const match = createMatch();
    const bot = new SoloBotController('easy', 77);

    expect(match.decks[Faction.Red].hand.length).toBeLessThanOrEqual(5);
    expect(bot.decide(match)).toBeNull();
  });

  it('只产生通过对局校验的红方出牌，并由 MatchState 正常扣牌', () => {
    const match = createMatch();
    fillHandAboveFive(match, Faction.Red);
    const bot = new SoloBotController('easy', 77);
    const before = match.decks[Faction.Red].hand.length;

    const command = bot.decide(match);

    expect(command).not.toBeNull();
    expect(command?.kind).toBe(CommandKind.PlayFormation);
    expect(command?.faction).toBe(Faction.Red);
    if (command?.kind !== CommandKind.PlayFormation) throw new Error('期望出牌指令');
    expect(command.cardIds.length).toBeGreaterThanOrEqual(1);
    expect(match.validate(command)).toBe(true);
    match.step([command!]);
    expect(match.decks[Faction.Red].hand.length).toBeLessThan(before);
  });

  it('相同种子与局面会做出完全相同的首个决策', () => {
    const first = createMatch();
    const second = createMatch();
    fillHandAboveFive(first, Faction.Red);
    fillHandAboveFive(second, Faction.Red);

    const commandA = new SoloBotController('hard', 99).decide(first);
    const commandB = new SoloBotController('hard', 99).decide(second);

    expect(commandA).toEqual(commandB);
  });

  it('出牌后遵守思考冷却，不会连续每帧操作', () => {
    const match = createMatch();
    fillHandAboveFive(match, Faction.Red);
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
    expect(match.decks[Faction.Red].hand.length).toBeLessThanOrEqual(5);

    const command = new SoloBotController('easy', 77).decide(match);
    expect(command?.kind).toBe(CommandKind.ClaimCastlePack);
    expect(command?.faction).toBe(Faction.Red);
  });
});

function createMatch(): MatchState {
  const match = new MatchState(20260806);
  match.seedStartingCastles();
  return match;
}

/** 把指定阵营手牌抽到超过 5 张，满足人机出牌门槛。 */
function fillHandAboveFive(match: MatchState, faction: Faction): void {
  while (match.decks[faction].hand.length <= 5) {
    const drawn = match.decks[faction].draw();
    if (!drawn) break;
  }
  expect(match.decks[faction].hand.length).toBeGreaterThan(5);
}
