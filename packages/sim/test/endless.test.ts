import { afterEach, describe, expect, it } from 'vitest';
import {
  BOONS,
  ENDLESS_WAVE_SECONDS,
  ENDLESS_WAVE_SECONDS_MAX,
  ENDLESS_WAVE_SECONDS_MIN,
  Faction,
  MAX_HAND_SIZE,
  MAX_WILD_CARDS,
  MatchState,
  StageRunner,
  TICK_RATE,
  advanceWave,
  applyBoon,
  applyEndlessConfigDraft,
  buildWaveStage,
  buildWaveSteps,
  collectHand,
  collectSurvivors,
  createPokerCards,
  createRun,
  dumpEndlessConfigDraft,
  fromFloat,
  getEndlessWaveOverride,
  getPokerCardById,
  isBuildingConfig,
  isWildCard,
  rollBoonChoices,
  sanitizeEndlessConfigDraft,
  sanitizeRun,
  toFloat,
  validateEndlessConfigDraft,
  waveSpec,
  waveWindowSeconds,
  type EndlessRunState,
  type StageDef,
} from '../src/index.js';

/** 复现客户端的建局顺序。 */
function createStageMatch(def: StageDef): { match: MatchState; runner: StageRunner } {
  const match = new MatchState(def.seed);
  match.seedStartingCastles();
  const runner = new StageRunner(def, match);
  return { match, runner };
}

/** 推进指定帧数，每帧带上敌方指令并更新目标判定。 */
function run(match: MatchState, runner: StageRunner, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    if (runner.tracker.getOutcome()) return;
    const command = runner.decide(match);
    match.step(command ? [command] : []);
    runner.update();
  }
}

/**
 * 推进一步并在当帧直接清空红方单位。
 * 用于把「场上已经没敌人」这个条件提前满足，从而验证判定只卡在出兵队列上。
 */
function stepAndClearRed(match: MatchState, runner: StageRunner): void {
  const command = runner.decide(match);
  match.step(command ? [command] : []);
  for (const unit of match.world.units) {
    if (unit.faction !== Faction.Red || isBuildingConfig(unit.config)) continue;
    unit.hp = 0;
    unit.dead = true;
  }
  match.world.removeDeadUnits();
  runner.update();
}

describe('万能牌张数', () => {
  it('可追加到 4 张，id 连续且都能按 id 还原', () => {
    const cards = createPokerCards({ wildCards: true, wildCount: MAX_WILD_CARDS });
    const wilds = cards.filter(isWildCard).map((card) => card.id);
    expect(wilds).toEqual(['wild-1', 'wild-2', 'wild-3', 'wild-4']);
    for (const id of wilds) expect(getPokerCardById(id)?.wild).toBe(true);
  });

  it('缺省仍是 2 张，超上限被夹住', () => {
    expect(createPokerCards({ wildCards: true }).filter(isWildCard)).toHaveLength(2);
    expect(createPokerCards({ wildCards: true, wildCount: 9 }).filter(isWildCard)).toHaveLength(4);
  });

  it('关卡 wildCount 写进对局牌堆', () => {
    const state: EndlessRunState = { ...createRun(5), wildCards: 3 };
    const { match } = createStageMatch(buildWaveStage(state));
    const deck = match.decks[Faction.Blue]!;
    const total = deck.availableCount + deck.hand.length;
    expect(total).toBe(54 + 3);
  });
});

describe('波次生成', () => {
  const seconds = ENDLESS_WAVE_SECONDS;

  it('同种子同波次结果一致', () => {
    expect(buildWaveSteps(42, 3, seconds)).toEqual(buildWaveSteps(42, 3, seconds));
  });

  it('预算随波次单调递增，出兵间隔不低于下限', () => {
    for (let wave = 1; wave < 30; wave += 1) {
      expect(waveSpec(wave + 1).budget).toBeGreaterThan(waveSpec(wave).budget);
      expect(waveSpec(wave).intervalSeconds).toBeGreaterThanOrEqual(6);
    }
  });

  it('Boss 波带 Boss 单位，前两波没有远程', () => {
    expect(buildWaveSteps(1, 5, seconds).some((step) => step.typeId === 'melee_golem')).toBe(true);
    for (const wave of [1, 2]) {
      expect(buildWaveSteps(9, wave, seconds).some((step) => step.typeId === 'ranged_archer')).toBe(false);
    }
  });

  it('出兵时间都在出兵窗口内', () => {
    for (const step of buildWaveSteps(3, 12, seconds)) {
      expect(step.atSeconds).toBeLessThan(seconds);
    }
  });

  it('出兵窗口缩短后出兵点同步收缩', () => {
    const short = buildWaveSteps(3, 12, ENDLESS_WAVE_SECONDS_MIN);
    const long = buildWaveSteps(3, 12, ENDLESS_WAVE_SECONDS_MAX);
    const latest = (steps: readonly { atSeconds: number }[]): number =>
      steps.reduce((end, step) => Math.max(end, step.atSeconds), 0);
    expect(latest(short)).toBeLessThanOrEqual(ENDLESS_WAVE_SECONDS_MIN);
    expect(latest(long)).toBeGreaterThan(latest(short));
  });
});

describe('强化', () => {
  it('三选一不重复，且都处于可选状态', () => {
    const state = createRun(11);
    const choices = rollBoonChoices(state, false);
    expect(choices).toHaveLength(3);
    expect(new Set(choices.map((boon) => boon.id)).size).toBe(3);
    for (const boon of choices) expect(boon.available(state)).toBe(true);
  });

  it('Boss 波后只给稀有', () => {
    const choices = rollBoonChoices({ ...createRun(2), castleHpRatio: 0.5 }, true);
    expect(choices.every((boon) => boon.rarity === 'rare')).toBe(true);
  });

  it('到上限的强化不再出现，强行应用也不生效', () => {
    const maxed: EndlessRunState = { ...createRun(3), handLimit: MAX_HAND_SIZE, wildCards: MAX_WILD_CARDS };
    for (let wave = 1; wave < 20; wave += 1) {
      const ids = rollBoonChoices({ ...maxed, wave }, false).map((boon) => boon.id);
      expect(ids).not.toContain('hand_limit');
      expect(ids).not.toContain('wild_card');
    }
    expect(applyBoon(maxed, 'hand_limit')).toBe(maxed);
  });

  it('应用强化会记入已选列表', () => {
    const next = applyBoon(createRun(1), 'hand_limit');
    expect(next.handLimit).toBe(8);
    expect(next.boons).toEqual(['hand_limit']);
    expect(BOONS.length).toBeGreaterThan(3);
  });

  it('推进波次继承残血并叠加每波回血', () => {
    const next = advanceWave({ ...createRun(1), regenPerWave: 0.1 }, 0.5, 42);
    expect(next.wave).toBe(2);
    expect(next.castleHpRatio).toBeCloseTo(0.6);
    // 清场流没有固定时长，累计的是本波实际用时
    expect(next.totalSeconds).toBe(42);
  });

  it('缺省按出兵窗口累计时长', () => {
    const next = advanceWave(createRun(1), 1);
    expect(next.totalSeconds).toBe(createRun(1).waveSeconds);
  });

  it('读档时补齐并夹紧出兵窗口', () => {
    const legacy = { ...createRun(1), waveSeconds: undefined } as unknown as EndlessRunState;
    expect(sanitizeRun(legacy).waveSeconds).toBe(ENDLESS_WAVE_SECONDS);
    expect(sanitizeRun({ ...createRun(1), waveSeconds: 5 }).waveSeconds).toBe(ENDLESS_WAVE_SECONDS_MIN);
    expect(sanitizeRun({ ...createRun(1), waveSeconds: 9999 }).waveSeconds).toBe(ENDLESS_WAVE_SECONDS_MAX);
  });
});

describe('无限防守对局判定', () => {
  it('敌方没有主堡也不会立即收局，清完这一波判成功', () => {
    // 敌方不出兵，只验证结束判定：出兵窗口过后场上没敌人即清场
    const def: StageDef = {
      ...buildWaveStage(createRun(1)),
      enemy: { kind: 'none' },
      objectives: [{ kind: 'clear_wave', spawnEndSeconds: 5 }],
    };
    const { match, runner } = createStageMatch(def);
    expect(match.getCastleMaxHp(Faction.Red)).toBe(0);
    run(match, runner, 10);
    expect(match.result).toBeNull();
    expect(runner.tracker.getOutcome()).toBeNull();
    run(match, runner, 5 * TICK_RATE);
    expect(runner.tracker.getOutcome()?.status).toBe('success');
  });

  it('出兵没放完时场上空着也不算清场', () => {
    const def: StageDef = {
      ...buildWaveStage(createRun(1)),
      enemy: { kind: 'none' },
      objectives: [{ kind: 'clear_wave', spawnEndSeconds: 60 }],
    };
    const { match, runner } = createStageMatch(def);
    run(match, runner, 30 * TICK_RATE);
    expect(runner.tracker.getOutcome()).toBeNull();
    run(match, runner, 31 * TICK_RATE);
    expect(runner.tracker.getOutcome()?.status).toBe('success');
  });

  it('出兵队列还剩敌人时，场上空着也不判清场', () => {
    // 同一出兵点排了 3 只敌人：队列每帧只下发一条，时间门槛到了也还有兵没进场
    const def: StageDef = {
      ...buildWaveStage(createRun(1)),
      enemy: {
        kind: 'script',
        steps: [{ atSeconds: 2, typeId: 'melee_grunt', count: 3, x: 9, y: 24 }],
      },
      objectives: [{ kind: 'clear_wave', spawnEndSeconds: 2 }],
    };
    const { match, runner } = createStageMatch(def);
    // 每帧都把红方清空：模拟「时间已到且场上没有敌人」，但队列里还有待下发的兵
    for (let i = 0; i < TICK_RATE * 2; i += 1) {
      stepAndClearRed(match, runner);
    }
    expect(runner.tracker.getOutcome()).toBeNull();
    expect(runner.hasPendingEnemySpawns()).toBe(true);

    // 队列放完后再清一次场，才允许判定这一波结束
    for (let i = 0; i < 10 && runner.hasPendingEnemySpawns(); i += 1) {
      stepAndClearRed(match, runner);
    }
    expect(runner.hasPendingEnemySpawns()).toBe(false);
    stepAndClearRed(match, runner);
    expect(runner.tracker.getOutcome()?.status).toBe('success');
  });

  it('真实波次里不会在最后一个敌人进场前判清场', () => {
    // 波次脚本最后一个出兵点有多只敌人，要分多帧才进场；判定必须等它们都生成
    const def = buildWaveStage(createRun(12345));
    const { match, runner } = createStageMatch(def);
    let queueDrainedTick = -1;
    let judgeTick = -1;
    for (let i = 0; i < TICK_RATE * 120; i += 1) {
      stepAndClearRed(match, runner);
      if (queueDrainedTick < 0 && !runner.hasPendingEnemySpawns()) queueDrainedTick = match.world.tick;
      if (runner.tracker.getOutcome()) {
        judgeTick = match.world.tick;
        break;
      }
    }
    expect(queueDrainedTick).toBeGreaterThan(0);
    expect(judgeTick).toBeGreaterThanOrEqual(queueDrainedTick);
    // 出兵结束时刻之后仍要继续等最后一个出兵点的兵进场，不能卡在 spawnEnd 那一帧
    const spawnEnd = (def.objectives[0] as { spawnEndSeconds: number }).spawnEndSeconds;
    expect(judgeTick).toBeGreaterThan(spawnEnd * TICK_RATE);
  });

  it('波次关卡的目标是清场，且不带存活时长条件', () => {
    const def = buildWaveStage(createRun(1));
    expect(def.objectives).toHaveLength(1);
    expect(def.objectives[0]?.kind).toBe('clear_wave');
  });

  it('继承的残血写到玩家主堡上', () => {
    const { match } = createStageMatch(buildWaveStage({ ...createRun(1), castleHpRatio: 0.4 }));
    expect(match.getCastleHpRatio(Faction.Blue)).toBeCloseTo(0.4, 2);
  });

  it('玩家主堡陷落判失败', () => {
    const def: StageDef = { ...buildWaveStage(createRun(1)), enemy: { kind: 'none' } };
    const { match, runner } = createStageMatch(def);
    const castle = match.world.units.find((unit) => unit.typeId === 'building_base' && unit.faction === Faction.Blue)!;
    castle.hp = 0;
    run(match, runner, 3);
    expect(match.result?.winner).toBe(Faction.Red);
    expect(runner.tracker.getOutcome()?.status).toBe('fail');
  });
});

describe('单位继承', () => {
  it('撑过一波时记下存活单位，下一波原位置摆回场上', () => {
    const survivors = [
      { faction: 0 as const, typeId: 'melee_grunt' as const, x: 9, y: 6, hpRatio: 0.5 },
      { faction: 0 as const, typeId: 'ranged_archer' as const, x: 5, y: 8, hpRatio: 1 },
    ];
    const next = advanceWave(createRun(1), 0.7, 30, survivors);
    expect(next.carriedUnits).toHaveLength(2);

    const def = buildWaveStage(next);
    expect(def.preset).toHaveLength(2);
    const { match } = createStageMatch(def);
    const grunt = match.world.units.find((unit) => unit.typeId === 'melee_grunt' && unit.faction === Faction.Blue)!;
    expect(toFloat(grunt.pos.x)).toBeCloseTo(9, 1);
    // 残血按比例折算，至少留 1 点，不能开局就判死
    expect(toFloat(grunt.hp)).toBeCloseTo(toFloat(grunt.config.maxHp) * 0.5, 0);
  });

  it('没有存活单位时下一波不带 preset', () => {
    expect(advanceWave(createRun(1), 1, 30).carriedUnits).toEqual([]);
    expect(buildWaveStage(advanceWave(createRun(1), 1, 30)).preset).toBeUndefined();
  });

  it('collectSurvivors 收集玩家方存活单位，主堡不继承、箭塔继承', () => {
    const { match } = createStageMatch(buildWaveStage(createRun(1)));
    match.world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(8), fromFloat(5));
    match.world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(4), fromFloat(4));
    match.world.spawnUnit(Faction.Red, 'melee_grunt', fromFloat(8), fromFloat(24));
    const tower = match.world.spawnBuilding(Faction.Blue, 'building_tower', fromFloat(3), fromFloat(6))!;
    tower.hp = Math.round(tower.config.maxHp * 0.5);
    const survivors = collectSurvivors(match);
    expect(survivors.map((unit) => unit.typeId).sort()).toEqual(['building_tower', 'melee_grunt', 'ranged_archer']);
    expect(survivors.every((unit) => unit.faction === 0)).toBe(true);
    // 塔按残血继承，下一波仍是半血
    expect(survivors.find((unit) => unit.typeId === 'building_tower')?.hpRatio).toBeCloseTo(0.5, 2);
    // 主堡每波重新播种，不参与继承
    expect(survivors.some((unit) => unit.typeId === 'building_base')).toBe(false);
  });

  it('过河的单位不继承，己方半场的单位继承', () => {
    const { match } = createStageMatch(buildWaveStage(createRun(1)));
    match.world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(8), fromFloat(5));
    match.world.spawnUnit(Faction.Blue, 'ranged_archer', fromFloat(8), fromFloat(22));
    const survivors = collectSurvivors(match);
    expect(survivors.map((unit) => unit.typeId)).toEqual(['melee_grunt']);
  });

  it('阵亡单位不继承', () => {
    const { match } = createStageMatch(buildWaveStage(createRun(1)));
    const unit = match.world.spawnUnit(Faction.Blue, 'melee_grunt', fromFloat(8), fromFloat(5));
    unit.dead = true;
    expect(collectSurvivors(match)).toEqual([]);
  });

  it('继承的箭塔在下一波开局保留残血与位置', () => {
    const survivors = [
      { faction: 0 as const, typeId: 'building_tower' as const, x: 4, y: 6, hpRatio: 0.4 },
    ];
    const next = advanceWave(createRun(1), 1, 30, survivors);
    const { match } = createStageMatch(buildWaveStage(next));
    const tower = match.world.units.find(
      (unit) => unit.typeId === 'building_tower' && unit.faction === Faction.Blue,
    )!;
    expect(toFloat(tower.pos.x)).toBeCloseTo(4, 1);
    expect(toFloat(tower.pos.y)).toBeCloseTo(6, 1);
    expect(toFloat(tower.hp)).toBeCloseTo(toFloat(tower.config.maxHp) * 0.4, 0);
  });

  it('箭塔落点非法时跳过该预置单位，不抛错', () => {
    const survivors = [
      // 占格与主堡重叠：主堡每波都播在场地底边，这里直接压到它的位置上
      { faction: 0 as const, typeId: 'building_tower' as const, x: 9, y: 2, hpRatio: 1 },
    ];
    const next = advanceWave(createRun(1), 1, 30, survivors);
    let match: MatchState | undefined;
    expect(() => {
      match = createStageMatch(buildWaveStage(next)).match;
    }).not.toThrow();
    // 被主堡占格挡掉，场上一座箭塔都没有，主堡仍在
    expect(match!.world.units.some((unit) => unit.typeId === 'building_tower')).toBe(false);
    expect(match!.world.units.some((unit) => unit.typeId === 'building_base')).toBe(true);
  });

  it('读档时清洗非法继承单位并夹紧数量与血量', () => {
    const dirty = {
      ...createRun(1),
      carriedUnits: [
        { faction: 0, typeId: 'melee_grunt', x: 3, y: 4, hpRatio: 0.4 },
        { faction: 0, typeId: 'not_a_unit', x: 3, y: 4 },
        { faction: 0, typeId: 'melee_grunt', x: Number.NaN, y: 4 },
        { faction: 0, typeId: 'building_tower', x: 4, y: 6, hpRatio: 0.3 },
        { faction: 0, typeId: 'building_base', x: 9, y: 2 },
        { faction: 0, typeId: 'dragon', x: 1, y: 2, hpRatio: 9 },
      ],
    } as unknown as EndlessRunState;
    const units = sanitizeRun(dirty).carriedUnits;
    // 箭塔优先排在前面，主堡被丢弃
    expect(units.map((unit) => unit.typeId)).toEqual(['building_tower', 'melee_grunt', 'dragon']);
    expect(units[0]!.hpRatio).toBeCloseTo(0.3, 2);
    expect(units[2]!.hpRatio).toBe(1);
  });

  it('旧存档没有 carriedUnits 时按空阵容续玩', () => {
    const legacy = { ...createRun(1) } as Partial<EndlessRunState>;
    delete legacy.carriedUnits;
    expect(sanitizeRun(legacy as EndlessRunState).carriedUnits).toEqual([]);
  });
});

describe('手牌继承', () => {
  it('撑过一波时记下手牌，下一波开局原样发回手上', () => {
    const { match } = createStageMatch(buildWaveStage(createRun(1)));
    const handIds = collectHand(match);
    expect(handIds.length).toBeGreaterThan(0);
    const next = advanceWave(createRun(1), 1, 30, [], handIds);
    expect(next.carriedHand).toEqual(handIds);

    // 继承手牌按原张数与牌面出现，不再按规则里的起手张数重抽
    const inherited = createStageMatch(buildWaveStage(next)).match;
    expect(inherited.decks[Faction.Blue]!.hand.map((card) => card.id)).toEqual(handIds);
  });

  it('继承后手牌不会出现重复牌面', () => {
    const { match } = createStageMatch(buildWaveStage(createRun(2)));
    const next = advanceWave(createRun(2), 1, 30, [], collectHand(match));
    const hand = createStageMatch(buildWaveStage(next)).match.decks[Faction.Blue]!.hand;
    const ids = hand.map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('牌堆里没有的牌 id 被跳过，其余手牌照常发回', () => {
    const { match } = createStageMatch(buildWaveStage(createRun(3)));
    const handed = collectHand(match);
    expect(handed.length).toBeGreaterThan(0);
    const next = advanceWave(createRun(3), 1, 30, [], [...handed.slice(0, 1), 'not-a-card']);
    const def = buildWaveStage(next);
    expect(def.carriedHand).toEqual([handed[0], 'not-a-card']);
    const hand = createStageMatch(def).match.decks[Faction.Blue]!.hand;
    expect(hand.map((card) => card.id)).toEqual([handed[0]]);
  });

  it('首波不带 carriedHand（还没继承），继承后即使空手也显式带空数组', () => {
    expect(buildWaveStage(createRun(1)).carriedHand).toBeUndefined();
    // 不传 hand 表示这次不继承：下一波仍走默认起手
    expect(advanceWave(createRun(1), 1, 30).carriedHand).toBeUndefined();
    expect(buildWaveStage(advanceWave(createRun(1), 1, 30)).carriedHand).toBeUndefined();
    // 传空数组 = 上一波把牌打空了，不能再发默认起手
    const emptied = advanceWave(createRun(1), 1, 30, [], []);
    expect(emptied.carriedHand).toEqual([]);
    expect(buildWaveStage(emptied).carriedHand).toEqual([]);
    expect(createStageMatch(buildWaveStage(emptied)).match.decks[Faction.Blue]!.hand).toHaveLength(0);
  });

  it('读档时清洗继承手牌：去空、去重并按手牌上限截断', () => {
    const dirty = {
      ...createRun(1),
      handLimit: 2,
      carriedHand: ['A-spades', '', 'A-spades', null, 'K-hearts', 'Q-clubs'],
    } as unknown as EndlessRunState;
    expect(sanitizeRun(dirty).carriedHand).toEqual(['A-spades', 'K-hearts']);
  });

  it('旧存档没有 carriedHand 时按默认起手续玩', () => {
    const legacy = { ...createRun(1) } as Partial<EndlessRunState>;
    delete legacy.carriedHand;
    expect(sanitizeRun(legacy as EndlessRunState).carriedHand).toBeUndefined();
  });
});

describe('每关参数覆盖', () => {
  const original = dumpEndlessConfigDraft();

  afterEach(() => {
    // 每个用例跑完都把运行时配置还原，避免串味到其它 describe
    applyEndlessConfigDraft({ waveSeconds: original.waveSeconds, waves: original.waves });
  });

  it('没配置时全部走公式', () => {
    applyEndlessConfigDraft({ waveSeconds: 120, waves: [] });
    expect(waveSpec(3).budget).toBeCloseTo(14 * 1.18 ** 2, 5);
    expect(getEndlessWaveOverride(3)).toBeUndefined();
  });

  it('配置了预算与间隔就以覆盖值为准', () => {
    applyEndlessConfigDraft({
      waveSeconds: 120,
      waves: [{ wave: 2, budget: 40, intervalSeconds: 9 }],
    });
    const spec = waveSpec(2);
    expect(spec.budget).toBe(40);
    expect(spec.intervalSeconds).toBe(9);
    // 其它波继续走公式
    expect(waveSpec(3).budget).not.toBe(40);
  });

  it('覆盖出兵窗口后，出兵点跟着新窗口收缩', () => {
    applyEndlessConfigDraft({ waveSeconds: 120, waves: [{ wave: 4, waveSeconds: 40 }] });
    expect(waveWindowSeconds(4, 120)).toBe(40);
    const steps = buildWaveSteps(7, 4, waveWindowSeconds(4, 120));
    const latest = steps.reduce((end, step) => Math.max(end, step.atSeconds), 0);
    expect(latest).toBeLessThanOrEqual(40);
  });

  it('覆盖兵种池后只出配置的兵种', () => {
    applyEndlessConfigDraft({
      waveSeconds: 120,
      waves: [{ wave: 1, budget: 20, intervalSeconds: 6, units: [{ typeId: 'melee_guard', weight: 1 }] }],
    });
    const types = new Set(buildWaveSteps(5, 1, 120).map((step) => step.typeId));
    expect([...types]).toEqual(['melee_guard']);
  });

  it('超出已配置波数继续走公式', () => {
    applyEndlessConfigDraft({ waveSeconds: 120, waves: [{ wave: 1, budget: 30 }] });
    expect(waveSpec(1).budget).toBe(30);
    expect(waveSpec(2).budget).toBeCloseTo(14 * 1.18, 5);
  });

  it('校验拦下非法覆盖项', () => {
    expect(validateEndlessConfigDraft({ waveSeconds: 120, waves: [{ wave: 0 }] })).toContain('wave');
    expect(validateEndlessConfigDraft({ waveSeconds: 120, waves: [{ wave: 1, budget: -1 }] })).toContain('budget');
    expect(
      validateEndlessConfigDraft({ waveSeconds: 120, waves: [{ wave: 1, units: [{ typeId: 'nope', weight: 1 }] }] }),
    ).toContain('未知兵种');
    expect(validateEndlessConfigDraft({ waveSeconds: 120, waves: [{ wave: 1, units: [] }] })).toBeUndefined();
  });

  it('清洗覆盖项时按波号排序去重', () => {
    const draft = sanitizeEndlessConfigDraft({
      waveSeconds: 120,
      waves: [
        { wave: 3, budget: 20 },
        { wave: 1, budget: 10 },
        { wave: 3, budget: 99 },
      ],
    });
    expect(draft.waves.map((wave) => wave.wave)).toEqual([1, 3]);
    expect(draft.waves[1]!.budget).toBe(20);
  });
});
