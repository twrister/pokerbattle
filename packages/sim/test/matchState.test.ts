import { afterEach, describe, expect, it } from 'vitest';
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
  SETTLEMENT_START_TICKS,
  MatchState,
  NORMAL_DRAW_INTERVAL_TICKS,
  TICK_RATE,
  ARENA_HEIGHT,
  applyArenaConfigDraft,
  applyArenaPreset,
  claimCastlePackCommand,
  dumpDefaultArenaConfigDraft,
  fromFloat,
  playFormationCommand,
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
  it('默认时间线为 2+3+3 分钟发牌再加 1 分钟结算', () => {
    expect(DOUBLE_SPEED_START_TICKS).toBe(TICK_RATE * 120);
    expect(FINAL_START_TICKS).toBe(TICK_RATE * 300);
    expect(SETTLEMENT_START_TICKS).toBe(TICK_RATE * 480);
    expect(MATCH_END_TICKS).toBe(TICK_RATE * 540);
  });

  it('切阶段继承下一张牌倒计时，且不在倍速结束时结算', () => {
    const match = createMatch();
    shortenPhases(match);
    expect(match.getDrawIntervalTicks()).toBe(NORMAL_DRAW_INTERVAL_TICKS);
    expect(match.decks[Faction.Blue].hand).toHaveLength(INITIAL_HAND_SIZE);
    expect(match.getMaxHandSize()).toBe(HAND_LIMIT_NORMAL);

    stepTo(match, 30);
    expect(match.phase).toBe('double_speed');
    expect(match.result).toBeNull();
    // 常规剩余 100-30=70，夹到倍速间隔 60。
    expect(match.getTicksUntilDraw()).toBe(DOUBLE_SPEED_DRAW_INTERVAL_TICKS);
    expect(match.getDrawIntervalTicks()).toBe(DOUBLE_SPEED_DRAW_INTERVAL_TICKS);
    expect(match.getMaxHandSize()).toBe(HAND_LIMIT_DOUBLE_SPEED);

    stepTo(match, 60);
    expect(match.phase).toBe('final');
    expect(match.result).toBeNull();
    // 倍速段再走 30 tick，剩余 30，小于决胜间隔 40，原样继承。
    expect(match.getTicksUntilDraw()).toBe(30);
    expect(match.getDrawIntervalTicks()).toBe(FINAL_DRAW_INTERVAL_TICKS);
    expect(match.getMaxHandSize()).toBe(HAND_LIMIT_FINAL);
  });

  it('可覆盖三阶段发牌间隔并夹住当前倒计时', () => {
    const match = createMatch();
    shortenPhases(match);
    expect(match.getTicksUntilDraw()).toBe(NORMAL_DRAW_INTERVAL_TICKS);

    match.setDrawIntervals({
      normalTicks: 20,
      doubleSpeedTicks: 10,
      finalTicks: 8,
    });
    expect(match.getDrawIntervalTicks()).toBe(20);
    expect(match.getTicksUntilDraw()).toBe(20);

    stepTo(match, 30);
    expect(match.getDrawIntervalTicks()).toBe(10);
    // tick 20 已抽过，剩余 10，等于新间隔故看起来像满格，实际是继承后夹住。
    expect(match.getTicksUntilDraw()).toBe(10);

    stepTo(match, 60);
    expect(match.getDrawIntervalTicks()).toBe(8);
    // 切决胜时剩余恰好到点，同帧补抽后按新间隔 8 重开。
    expect(match.getTicksUntilDraw()).toBe(8);
  });

  it('满手待发只冻结该方，出牌同帧补发并只重启该方读条', () => {
    const match = createMatch();
    while (match.decks[Faction.Blue].hand.length < match.getMaxHandSize()) {
      if (!match.decks[Faction.Blue].draw()) break;
    }
    const blueFull = match.decks[Faction.Blue].hand.length;
    const redBefore = match.decks[Faction.Red].hand.length;
    expect(blueFull).toBe(HAND_LIMIT_NORMAL);

    stepTo(match, NORMAL_DRAW_INTERVAL_TICKS);
    expect(match.hasPendingDraw(Faction.Blue)).toBe(true);
    expect(match.hasPendingDraw(Faction.Red)).toBe(false);
    expect(match.decks[Faction.Blue].hand).toHaveLength(blueFull);
    expect(match.decks[Faction.Red].hand).toHaveLength(redBefore + 1);
    expect(match.getTicksUntilDraw(Faction.Blue)).toBe(0);
    expect(match.getTicksUntilDraw(Faction.Red)).toBe(NORMAL_DRAW_INTERVAL_TICKS);

    const numberCard = match.decks[Faction.Blue].hand.find(
      (card) => card.rank !== 'JOKER' && card.rank !== 'A' && card.rank !== 'J' && card.rank !== 'Q' && card.rank !== 'K',
    );
    expect(numberCard).toBeDefined();
    match.step([
      playFormationCommand(Faction.Blue, 'single_grunt', [numberCard!.id], fromFloat(9), fromFloat(4)),
    ]);

    expect(match.hasPendingDraw(Faction.Blue)).toBe(false);
    expect(match.decks[Faction.Blue].hand).toHaveLength(blueFull);
    expect(match.getTicksUntilDraw(Faction.Blue)).toBe(NORMAL_DRAW_INTERVAL_TICKS);
    expect(match.getTicksUntilDraw(Faction.Red)).toBe(NORMAL_DRAW_INTERVAL_TICKS - 1);
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

  it('倍速结束时血量不同也不结算，结算到点才比血', () => {
    const match = createMatch();
    shortenPhases(match);
    castle(match, Faction.Red).hp -= 1;

    stepTo(match, 60);
    expect(match.phase).toBe('final');
    expect(match.result).toBeNull();

    stepTo(match, 90);
    expect(match.phase).toBe('settlement');
    expect(match.result).toBeNull();

    stepTo(match, 120);
    expect(match.result).toMatchObject({ winner: Faction.Blue, reason: 'time_limit' });
  });

  it('结算结束时血量相同则平局', () => {
    const match = createMatch();
    shortenPhases(match);

    stepTo(match, 120);

    expect(match.result).toMatchObject({ winner: null, reason: 'time_limit' });
  });

  it('可覆盖阶段时长、手牌上限和起手张数', () => {
    const match = createMatch();
    match.setPhaseDurations({
      normalTicks: TICK_RATE * 2,
      doubleSpeedTicks: TICK_RATE * 2,
      finalTicks: TICK_RATE * 2,
      settlementTicks: TICK_RATE * 2,
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
    expect(match.phase).toBe('settlement');
    expect(match.result).toBeNull();

    stepTo(match, TICK_RATE * 8);
    expect(match.result?.reason).toBe('time_limit');
  });

  it('缩短阶段时长后立刻越过已到期边界', () => {
    const match = createMatch();
    stepTo(match, 50);
    expect(match.phase).toBe('normal');

    match.setPhaseDurations({
      normalTicks: 10,
      doubleSpeedTicks: 10,
      finalTicks: 10,
      settlementTicks: 10,
    });

    expect(match.phase).toBe('ended');
    expect(match.result?.reason).toBe('time_limit');
  });

  it('结算期停止补牌，读条视为 0', () => {
    const match = createMatch();
    match.setPhaseDurations({
      normalTicks: 1,
      doubleSpeedTicks: 1,
      finalTicks: 1,
      settlementTicks: TICK_RATE * 6,
    });
    stepTo(match, 3);
    expect(match.phase).toBe('settlement');
    const before = match.decks[Faction.Blue].hand.length;
    stepTo(match, 3 + NORMAL_DRAW_INTERVAL_TICKS);
    expect(match.phase).toBe('settlement');
    expect(match.decks[Faction.Blue].hand.length).toBe(before);
    expect(match.getTicksUntilDraw()).toBe(0);
    expect(match.hasPendingDraw(Faction.Blue)).toBe(false);
  });

  it('决胜期全员空手且无可移动单位时提前进入结算', () => {
    const match = createMatch();
    shortenPhases(match);
    stepTo(match, 60);
    expect(match.phase).toBe('final');

    emptyHands(match);
    match.step();

    expect(match.phase).toBe('settlement');
    expect(match.result).toBeNull();
    expect(match.getHudDeadlineTick()).toBe(match.world.tick + 30);
  });

  it('决胜期仍有手牌时不提前进入结算', () => {
    const match = createMatch();
    shortenPhases(match);
    stepTo(match, 60);
    expect(match.phase).toBe('final');
    expect(match.decks[Faction.Blue].hand.length).toBeGreaterThan(0);

    match.step();
    expect(match.phase).toBe('final');
  });

  it('决胜期场上有可移动单位时不提前进入结算', () => {
    const match = createMatch();
    shortenPhases(match);
    stepTo(match, 60);
    emptyHands(match);
    match.world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(9), fromFloat(8));

    match.step();
    expect(match.phase).toBe('final');
  });

  it('提前进入结算后停止补牌，到点仍按主堡血量结算', () => {
    const match = createMatch();
    shortenPhases(match);
    castle(match, Faction.Red).hp -= 1;
    stepTo(match, 60);
    emptyHands(match);
    match.step();
    expect(match.phase).toBe('settlement');

    const enterTick = match.world.tick;
    const before = match.decks[Faction.Blue].hand.length;
    // 结算窗只有 30 tick，短于默认补牌间隔；走几帧确认停抽即可。
    stepTo(match, enterTick + 10);
    expect(match.phase).toBe('settlement');
    expect(match.decks[Faction.Blue].hand.length).toBe(before);
    expect(match.getTicksUntilDraw()).toBe(0);

    stepTo(match, enterTick + 30);
    expect(match.result).toMatchObject({ winner: Faction.Blue, reason: 'time_limit' });
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

/** 把四段时长压到各 30 tick，避免测试空转默认 9 分钟。 */
function shortenPhases(match: MatchState): void {
  match.setPhaseDurations({
    normalTicks: 30,
    doubleSpeedTicks: 30,
    finalTicks: 30,
    settlementTicks: 30,
  });
}

function stepTo(match: MatchState, targetTick: number): void {
  while (match.world.tick < targetTick && !match.result) match.step();
}

/** 直接回堆清空手牌，不走 out 牌指令，避免场上刷出可移动单位。 */
function emptyHands(match: MatchState): void {
  for (const deck of match.decks) {
    deck.play(deck.hand.map((card) => card.id));
  }
}

function castle(match: MatchState, faction: Faction) {
  const unit = match.world.units.find(
    (candidate) => candidate.faction === faction && candidate.typeId === 'building_base',
  );
  if (!unit) throw new Error('主堡未生成');
  return unit;
}

function castleOfSlot(match: MatchState, slot: number) {
  const unit = match.world.units.find(
    (candidate) => candidate.ownerSlot === slot && candidate.typeId === 'building_base',
  );
  if (!unit) throw new Error(`席位 ${slot} 主堡未生成`);
  return unit;
}

describe('MatchState 2v2', () => {
  afterEach(() => {
    applyArenaPreset('1v1');
  });

  it('四席独立牌堆，主堡按队均分 X', () => {
    const match = new MatchState(1, '2v2');
    match.seedStartingCastles();
    expect(match.mode).toBe('2v2');
    expect(match.decks).toHaveLength(4);
    expect(match.decks[0]!.hand).toHaveLength(INITIAL_HAND_SIZE);
    expect(match.decks[3]!.hand).toHaveLength(INITIAL_HAND_SIZE);
    // 2v2 默认单边 (6,2)/(18,2)，偶数 footprint 吸附后仍是整数
    expect(match.getSlotCastlePosition(0)?.x).toBeCloseTo(6, 5);
    expect(match.getSlotCastlePosition(1)?.x).toBeCloseTo(18, 5);
    expect(match.getSlotCastlePosition(2)?.x).toBeCloseTo(6, 5);
    expect(match.getSlotCastlePosition(3)?.x).toBeCloseTo(18, 5);
    expect(match.world.units.filter((unit) => unit.typeId === 'building_base')).toHaveLength(4);
  });

  it('单边基地坐标写入后对岸只镜像 Y', () => {
    const match = new MatchState(1, '2v2');
    applyArenaConfigDraft({
      ...dumpDefaultArenaConfigDraft('2v2'),
      bases: [
        { x: 6, y: 4 },
        { x: 18, y: 3 },
      ],
    }, '2v2');
    match.seedStartingCastles();
    const fullH = toFloat(ARENA_HEIGHT);
    expect(match.getSlotCastlePosition(0)).toEqual({ x: 6, y: 4 });
    expect(match.getSlotCastlePosition(1)).toEqual({ x: 18, y: 3 });
    expect(match.getSlotCastlePosition(2)).toEqual({ x: 6, y: fullH - 4 });
    expect(match.getSlotCastlePosition(3)).toEqual({ x: 18, y: fullH - 3 });
  });

  it('单座阵亡后该席仍正常补牌且可打完手牌，对局继续', () => {
    const match = new MatchState(1, '2v2');
    match.seedStartingCastles();
    expect(match.world.units.filter((unit) => unit.typeId === 'building_base')).toHaveLength(4);
    const before = match.decks[0]!.hand.length;
    castleOfSlot(match, 0).hp = 0;
    match.step();
    expect(match.isSlotEliminated(0)).toBe(true);
    expect(match.isSlotEliminated(1)).toBe(false);
    expect(match.result).toBeNull();
    const tick = match.world.tick;
    match.step();
    match.step();
    expect(match.world.tick).toBe(tick + 2);
    expect(match.result).toBeNull();

    const numberCard = match.decks[0]!.hand.find(
      (card) => card.rank !== 'JOKER' && card.rank !== 'A' && card.rank !== 'J' && card.rank !== 'Q' && card.rank !== 'K',
    );
    expect(numberCard).toBeDefined();
    const play = playFormationCommand(
      Faction.Blue,
      'single_grunt',
      [numberCard!.id],
      fromFloat(4),
      fromFloat(4),
      0,
    );
    expect(match.validate(play)).toBe(true);
    match.step([play]);
    expect(match.decks[0]!.hand).toHaveLength(before - 1);

    stepTo(match, NORMAL_DRAW_INTERVAL_TICKS);
    expect(match.decks[0]!.hand.length).toBeGreaterThan(before - 1);
    expect(match.decks[1]!.hand.length).toBeGreaterThan(before);
  });

  it('队友阵亡后发牌间隔不变，全队仍按阶段正常补牌', () => {
    const match = new MatchState(1, '2v2');
    match.seedStartingCastles();
    castleOfSlot(match, 1).hp = 0;
    match.step();
    expect(match.getDrawIntervalTicksForSlot(0)).toBe(NORMAL_DRAW_INTERVAL_TICKS);
    expect(match.getDrawIntervalTicksForSlot(2)).toBe(NORMAL_DRAW_INTERVAL_TICKS);
  });

  it('一队两座全灭立即判负', () => {
    const match = new MatchState(1, '2v2');
    match.seedStartingCastles();
    castleOfSlot(match, 0).hp = 0;
    castleOfSlot(match, 1).hp = 0;
    match.step();
    expect(match.result).toMatchObject({ winner: Faction.Red, reason: 'base_destroyed' });
  });

  it('时间到比队伍主堡总血量，hash 对同一种子稳定', () => {
    const left = new MatchState(7, '2v2');
    const right = new MatchState(7, '2v2');
    left.seedStartingCastles();
    right.seedStartingCastles();
    left.setPhaseDurations({ normalTicks: 2, doubleSpeedTicks: 2, finalTicks: 2, settlementTicks: 2 });
    right.setPhaseDurations({ normalTicks: 2, doubleSpeedTicks: 2, finalTicks: 2, settlementTicks: 2 });
    castleOfSlot(left, 2).hp -= 10;
    castleOfSlot(right, 2).hp -= 10;
    stepTo(left, 8);
    stepTo(right, 8);
    expect(left.result).toMatchObject({ winner: Faction.Blue, reason: 'time_limit' });
    expect(left.hash()).toBe(right.hash());
  });
});
