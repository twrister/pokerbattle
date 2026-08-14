import { describe, expect, it } from 'vitest';
import { Faction } from '../src/entity/unit.js';
import {
  CASTLE_PROTECT_CARDS,
  CASTLE_PROTECT_HP,
  DOUBLE_SPEED_DRAW_INTERVAL_TICKS,
  DOUBLE_SPEED_START_TICKS,
  FINAL_DRAW_INTERVAL_TICKS,
  FINAL_START_TICKS,
  HAND_LIMIT_DOUBLE_SPEED,
  HAND_LIMIT_FINAL,
  HAND_LIMIT_NORMAL,
  INITIAL_HAND_SIZE,
  MATCH_END_TICKS,
  MatchState,
  NORMAL_DRAW_INTERVAL_TICKS,
  TICK_RATE,
  claimCastlePackCommand,
  fromFloat,
  toFloat,
} from '../src/index.js';

describe('MatchState.clear', () => {
  it('清空后保留牌堆实例引用，并重新发初始手牌', () => {
    const match = new MatchState(1);
    const blueDeck = match.decks[Faction.Blue];
    const redDeck = match.decks[Faction.Red];
    const beforeBlue = blueDeck.hand.map((card) => card.id);

    blueDeck.play(beforeBlue.slice(0, 1));
    expect(blueDeck.hand).toHaveLength(beforeBlue.length - 1);

    match.clear();

    // 单机 HandPanel 绑的是同一 deck；换实例会导致校验手牌 id 永远对不上
    expect(match.decks[Faction.Blue]).toBe(blueDeck);
    expect(match.decks[Faction.Red]).toBe(redDeck);
    expect(blueDeck.hand).toHaveLength(INITIAL_HAND_SIZE);
    expect(redDeck.hand).toHaveLength(INITIAL_HAND_SIZE);
  });
});

describe('MatchState 对局规则', () => {
  it('按阶段重置下一张牌倒计时，且不在倍速结束时结算', () => {
    const match = createMatch();
    expect(match.getDrawIntervalTicks()).toBe(NORMAL_DRAW_INTERVAL_TICKS);
    expect(match.decks[Faction.Blue].hand).toHaveLength(INITIAL_HAND_SIZE);
    expect(match.getMaxHandSize()).toBe(HAND_LIMIT_NORMAL);

    stepTo(match, DOUBLE_SPEED_START_TICKS);
    expect(match.phase).toBe('double_speed');
    expect(match.result).toBeNull();
    expect(match.getTicksUntilDraw()).toBe(DOUBLE_SPEED_DRAW_INTERVAL_TICKS);
    expect(match.getDrawIntervalTicks()).toBe(DOUBLE_SPEED_DRAW_INTERVAL_TICKS);
    expect(match.getMaxHandSize()).toBe(HAND_LIMIT_DOUBLE_SPEED);

    stepTo(match, FINAL_START_TICKS);
    expect(match.phase).toBe('final');
    expect(match.result).toBeNull();
    expect(match.getTicksUntilDraw()).toBe(FINAL_DRAW_INTERVAL_TICKS);
    expect(match.getDrawIntervalTicks()).toBe(FINAL_DRAW_INTERVAL_TICKS);
    expect(match.getMaxHandSize()).toBe(HAND_LIMIT_FINAL);
  });

  it('可覆盖三阶段发牌间隔并夹住当前倒计时', () => {
    const match = createMatch();
    expect(match.getTicksUntilDraw()).toBe(NORMAL_DRAW_INTERVAL_TICKS);

    match.setDrawIntervals({
      normalTicks: 20,
      doubleSpeedTicks: 10,
      finalTicks: 8,
    });
    expect(match.getDrawIntervalTicks()).toBe(20);
    expect(match.getTicksUntilDraw()).toBe(20);

    stepTo(match, DOUBLE_SPEED_START_TICKS);
    expect(match.getDrawIntervalTicks()).toBe(10);
    expect(match.getTicksUntilDraw()).toBe(10);

    stepTo(match, FINAL_START_TICKS);
    expect(match.getDrawIntervalTicks()).toBe(8);
    expect(match.getTicksUntilDraw()).toBe(8);
  });

  it('一方基地被摧毁时立即结束', () => {
    const match = createMatch();
    castle(match, Faction.Red).hp = 0;

    match.step();

    expect(match.result).toMatchObject({
      winner: Faction.Blue,
      reason: 'base_destroyed',
      endTick: 1,
    });
    const tick = match.world.tick;
    match.step();
    expect(match.world.tick).toBe(tick);
  });

  it('双方基地同帧摧毁时判为平局', () => {
    const match = createMatch();
    castle(match, Faction.Blue).hp = 0;
    castle(match, Faction.Red).hp = 0;

    match.step();

    expect(match.result).toMatchObject({ winner: null, reason: 'simultaneous_destroyed' });
  });

  it('倍速结束时血量不同也不结算，决胜到点才比血', () => {
    const match = createMatch();
    castle(match, Faction.Red).hp -= 1;

    stepTo(match, FINAL_START_TICKS);
    expect(match.phase).toBe('final');
    expect(match.result).toBeNull();

    stepTo(match, MATCH_END_TICKS);
    expect(match.result).toMatchObject({ winner: Faction.Blue, reason: 'time_limit' });
  });

  it('决胜结束时血量相同则平局', () => {
    const match = createMatch();

    stepTo(match, MATCH_END_TICKS);

    expect(match.result).toMatchObject({ winner: null, reason: 'time_limit' });
  });

  it('可覆盖阶段时长、手牌上限和起手张数', () => {
    const match = createMatch();
    match.setPhaseDurations({
      normalTicks: TICK_RATE * 2,
      doubleSpeedTicks: TICK_RATE * 2,
      finalTicks: TICK_RATE * 2,
    });
    match.setHandLimits({ normal: 5, doubleSpeed: 6, final: 7 });
    match.setInitialHandSize(2);

    expect(match.decks[Faction.Blue].hand).toHaveLength(2);
    expect(match.getMaxHandSize()).toBe(5);

    stepTo(match, TICK_RATE * 2);
    expect(match.phase).toBe('double_speed');
    expect(match.getMaxHandSize()).toBe(6);

    stepTo(match, TICK_RATE * 4);
    expect(match.phase).toBe('final');
    expect(match.getMaxHandSize()).toBe(7);

    stepTo(match, TICK_RATE * 6);
    expect(match.result?.reason).toBe('time_limit');
  });
});

describe('MatchState 城堡保护卡包', () => {
  it('主堡血量低于半血保护线时掉落卡包，领取后无视上限补 5 张', () => {
    const match = createMatch();
    const before = match.decks[Faction.Blue].hand.length;
    castle(match, Faction.Blue).hp = fromFloat(CASTLE_PROTECT_HP - 1);

    match.step();
    expect(match.getCastlePackState(Faction.Blue)).toBe('pending');
    expect(match.getCastlePackState(Faction.Red)).toBe('none');
    expect(match.getCastleProtectHp(Faction.Blue)).toBe(CASTLE_PROTECT_HP);
    expect(CASTLE_PROTECT_HP).toBe(toFloat(match.getCastleMaxHp(Faction.Blue)) * 0.5);

    match.step([claimCastlePackCommand(Faction.Blue)]);
    expect(match.getCastlePackState(Faction.Blue)).toBe('claimed');
    expect(match.decks[Faction.Blue].hand.length).toBe(before + CASTLE_PROTECT_CARDS);
  });

  it('满手时领取仍能超过阶段上限', () => {
    const match = createMatch();
    while (match.decks[Faction.Blue].hand.length < match.getMaxHandSize()) {
      if (!match.decks[Faction.Blue].draw()) break;
    }
    const full = match.decks[Faction.Blue].hand.length;
    castle(match, Faction.Blue).hp = fromFloat(CASTLE_PROTECT_HP - 1);
    match.step();
    match.step([claimCastlePackCommand(Faction.Blue)]);
    expect(match.decks[Faction.Blue].hand.length).toBe(full + CASTLE_PROTECT_CARDS);
  });

  it('领取后回血再掉不再触发', () => {
    const match = createMatch();
    castle(match, Faction.Blue).hp = fromFloat(CASTLE_PROTECT_HP - 1);
    match.step();
    match.step([claimCastlePackCommand(Faction.Blue)]);
    castle(match, Faction.Blue).hp = fromFloat(CASTLE_PROTECT_HP + 500);
    match.step();
    castle(match, Faction.Blue).hp = fromFloat(CASTLE_PROTECT_HP - 100);
    match.step();
    expect(match.getCastlePackState(Faction.Blue)).toBe('claimed');
  });

  it('无待领取卡包时指令无效', () => {
    const match = createMatch();
    const before = match.decks[Faction.Blue].hand.length;
    expect(match.validate(claimCastlePackCommand(Faction.Blue))).toBe(false);
    match.step([claimCastlePackCommand(Faction.Blue)]);
    expect(match.decks[Faction.Blue].hand.length).toBe(before);
    expect(match.getCastlePackState(Faction.Blue)).toBe('none');
  });

  it('血量恰好等于保护线时不掉包', () => {
    const match = createMatch();
    castle(match, Faction.Blue).hp = fromFloat(CASTLE_PROTECT_HP);
    match.step();
    expect(match.getCastlePackState(Faction.Blue)).toBe('none');
  });

  it('调试掉落可在未受伤时强制出包，领取后也能再掉', () => {
    const match = createMatch();
    expect(match.debugDropCastlePack(Faction.Blue)).toBe(true);
    expect(match.getCastlePackState(Faction.Blue)).toBe('pending');
    match.step([claimCastlePackCommand(Faction.Blue)]);
    expect(match.getCastlePackState(Faction.Blue)).toBe('claimed');
    expect(match.debugDropCastlePack(Faction.Blue)).toBe(true);
    expect(match.getCastlePackState(Faction.Blue)).toBe('pending');
  });

  it('clear 重置卡包状态，且 hash 纳入该状态', () => {
    const left = createMatch();
    const right = createMatch();
    left.step();
    right.step();
    expect(left.hash()).toBe(right.hash());

    castle(left, Faction.Blue).hp = fromFloat(CASTLE_PROTECT_HP - 1);
    left.step();
    right.step();
    expect(left.getCastlePackState(Faction.Blue)).toBe('pending');
    expect(left.hash()).not.toBe(right.hash());

    left.clear();
    left.seedStartingCastles();
    expect(left.getCastlePackState(Faction.Blue)).toBe('none');
  });
});

function createMatch(): MatchState {
  const match = new MatchState(1);
  match.seedStartingCastles();
  return match;
}

function stepTo(match: MatchState, targetTick: number): void {
  while (match.world.tick < targetTick) match.step();
}

function castle(match: MatchState, faction: Faction) {
  const unit = match.world.units.find(
    (candidate) => candidate.faction === faction && candidate.typeId === 'building_base',
  );
  if (!unit) throw new Error('主堡未生成');
  return unit;
}
