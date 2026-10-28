import { describe, expect, it } from 'vitest';
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
  buildWaveStage,
  buildWaveSteps,
  createPokerCards,
  createRun,
  getPokerCardById,
  isWildCard,
  rollBoonChoices,
  sanitizeRun,
  waveSpec,
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
