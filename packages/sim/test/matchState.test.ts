import { describe, expect, it } from 'vitest';
import { Faction } from '../src/entity/unit.js';
import {
  DOUBLE_SPEED_DRAW_INTERVAL_TICKS,
  DOUBLE_SPEED_START_TICKS,
  MatchState,
  NORMAL_DRAW_INTERVAL_TICKS,
  NORMAL_PHASE_TICKS,
  OVERTIME_DRAW_INTERVAL_TICKS,
  OVERTIME_END_TICKS,
} from '../src/match/matchState.js';

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
    expect(blueDeck.hand).toHaveLength(3);
    expect(redDeck.hand).toHaveLength(3);
  });
});

describe('MatchState 对局规则', () => {
  it('按阶段重置下一张牌倒计时', () => {
    const match = createMatch();
    expect(match.getDrawIntervalTicks()).toBe(NORMAL_DRAW_INTERVAL_TICKS);

    stepTo(match, DOUBLE_SPEED_START_TICKS);
    expect(match.phase).toBe('double_speed');
    expect(match.getTicksUntilDraw()).toBe(60);
    expect(match.getDrawIntervalTicks()).toBe(DOUBLE_SPEED_DRAW_INTERVAL_TICKS);

    stepTo(match, NORMAL_PHASE_TICKS);
    expect(match.phase).toBe('overtime');
    expect(match.getTicksUntilDraw()).toBe(40);
    expect(match.getDrawIntervalTicks()).toBe(OVERTIME_DRAW_INTERVAL_TICKS);
  });

  it('可覆盖三阶段发牌间隔并夹住当前倒计时', () => {
    const match = createMatch();
    expect(match.getTicksUntilDraw()).toBe(NORMAL_DRAW_INTERVAL_TICKS);

    match.setDrawIntervals({
      normalTicks: 20,
      doubleSpeedTicks: 10,
      overtimeTicks: 8,
    });
    expect(match.getDrawIntervalTicks()).toBe(20);
    expect(match.getTicksUntilDraw()).toBe(20);

    stepTo(match, DOUBLE_SPEED_START_TICKS);
    expect(match.getDrawIntervalTicks()).toBe(10);
    expect(match.getTicksUntilDraw()).toBe(10);

    stepTo(match, NORMAL_PHASE_TICKS);
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

  it('三分钟基地血量不同则高血量方获胜', () => {
    const match = createMatch();
    castle(match, Faction.Red).hp -= 1;

    stepTo(match, NORMAL_PHASE_TICKS);

    expect(match.result).toMatchObject({ winner: Faction.Blue, reason: 'time_limit' });
  });

  it('加时赛结束时血量相同则平局', () => {
    const match = createMatch();

    stepTo(match, OVERTIME_END_TICKS);

    expect(match.result).toMatchObject({ winner: null, reason: 'time_limit' });
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
