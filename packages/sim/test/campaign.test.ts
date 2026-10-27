import { describe, expect, it } from 'vitest';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  CAMPAIGN_STAGES,
  CAMPAIGN_STAGE_SECONDS,
  Faction,
  MatchState,
  ScriptedEnemy,
  StageRunner,
  TICK_RATE,
  fromFloat,
  getNextStage,
  getFormationsFor,
  getStageById,
  detectHandCategories,
  isWildCard,
  playFormationCommand,
  toFloat,
  type PlayingCard,
  type StageDef,
} from '../src/index.js';

/** 构造一局并套用关卡，复现客户端的创建顺序。 */
function createStageMatch(def: StageDef): { match: MatchState; runner: StageRunner } {
  const match = new MatchState(def.seed);
  match.seedStartingCastles();
  const runner = new StageRunner(def, match);
  return { match, runner };
}

/** 推进指定帧数，每帧带上敌方指令并更新目标判定。 */
function run(match: MatchState, runner: StageRunner, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    const command = runner.decide(match);
    match.step(command ? [command] : []);
    runner.update();
  }
}

const baseDef: StageDef = {
  id: 't',
  chapter: 1,
  index: 1,
  title: 't',
  seed: 7,
  enemy: { kind: 'none' },
  objectives: [{ kind: 'survive_seconds', seconds: 5 }],
};

describe('战役关卡数据', () => {
  it('第 1 章 3 关可加载，id 唯一且顺序连续', () => {
    const ids = CAMPAIGN_STAGES.map((stage) => stage.id);
    expect(ids).toEqual(['c1_1', 'c1_2', 'c1_3']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getStageById('c1_2')?.title).toBe('凑出炸弹');
    expect(getStageById('c1_3')?.title).toBe('万能牌');
    expect(getNextStage('c1_1')?.id).toBe('c1_2');
    expect(getNextStage('c1_2')?.id).toBe('c1_3');
    expect(getNextStage('c1_3')).toBeUndefined();
  });

  it('1-1 通关条件：打出任意兵种 + 摧毁敌方箭塔，文案不带进度数字', () => {
    const def = getStageById('c1_1')!;
    expect(def.objectives).toEqual([{ kind: 'play_any' }, { kind: 'destroy_towers' }]);
    const { match, runner } = createStageMatch(def);
    expect(runner.tracker.getProgress(match).map((item) => item.text)).toEqual([
      '打出任意兵种',
      '摧毁敌方箭塔',
    ]);
  });

  it('每一关都能创建并推进若干秒而不抛错', () => {
    for (const def of CAMPAIGN_STAGES) {
      const { match, runner } = createStageMatch(def);
      expect(() => run(match, runner, TICK_RATE * 3)).not.toThrow();
    }
  });
});

describe('StageRunner 规则覆盖与牌池', () => {
  it('规则覆盖生效：起手张数与手牌上限', () => {
    const { match } = createStageMatch({
      ...baseDef,
      rules: { initialHandSize: 3, normalHandLimit: 4, wildCardsEnabled: false },
    });
    expect(match.decks[Faction.Blue].hand).toHaveLength(3);
    expect(match.getMaxHandSize()).toBe(4);
  });

  it('限定点数后玩家手牌只含这些点数，且没有大小王', () => {
    const { match } = createStageMatch({
      ...baseDef,
      rules: { wildCardsEnabled: false },
      playerRanks: ['5', '6'],
      playerJokers: false,
    });
    const hand = match.decks[Faction.Blue].hand;
    expect(hand.length).toBeGreaterThan(0);
    for (const card of hand) expect(['5', '6']).toContain(card.rank);
  });

  it('同一关卡同一 seed 两次创建的世界指纹一致', () => {
    const first = createStageMatch(CAMPAIGN_STAGES[1]!);
    const second = createStageMatch(CAMPAIGN_STAGES[1]!);
    run(first.match, first.runner, TICK_RATE * 25);
    run(second.match, second.runner, TICK_RATE * 25);
    expect(first.match.hash()).toBe(second.match.hash());
  });
});

describe('ObjectiveTracker', () => {
  it('存活目标在时间到且基地未陷落时成功，并记录用时', () => {
    const { match, runner } = createStageMatch(baseDef);
    run(match, runner, TICK_RATE * 4);
    expect(runner.tracker.getStatus()).toBe('pending');
    run(match, runner, TICK_RATE * 2);
    expect(runner.tracker.getStatus()).toBe('success');
    expect(runner.tracker.getOutcome()?.seconds).toBeGreaterThanOrEqual(5);
  });

  it('摧毁箭塔目标：预置的敌塔存在时未完成，清掉后成功', () => {
    const { match, runner } = createStageMatch({
      ...baseDef,
      preset: [{ faction: 1, typeId: 'building_tower', x: 9, y: 24 }],
      objectives: [{ kind: 'destroy_towers' }],
    });
    run(match, runner, 2);
    expect(runner.tracker.getStatus()).toBe('pending');
    for (const unit of match.world.units) {
      if (unit.typeId === 'building_tower') {
        unit.hp = 0;
        unit.dead = true;
      }
    }
    run(match, runner, 1);
    expect(runner.tracker.getStatus()).toBe('success');
  });

  it('对局结束但目标未达成判定为失败', () => {
    const { match, runner } = createStageMatch({
      ...baseDef,
      objectives: [{ kind: 'destroy_base' }],
    });
    for (const unit of match.world.units) {
      if (unit.typeId === 'building_base' && unit.faction === Faction.Blue) {
        unit.hp = 0;
        unit.dead = true;
      }
    }
    run(match, runner, 2);
    expect(runner.tracker.getStatus()).toBe('fail');
  });

  it('结果落定后不再改动', () => {
    const { match, runner } = createStageMatch(baseDef);
    run(match, runner, TICK_RATE * 6);
    const first = runner.tracker.getOutcome();
    run(match, runner, TICK_RATE * 2);
    expect(runner.tracker.getOutcome()).toBe(first);
  });
});

describe('第 1 章试玩（无头仿真）', () => {
  /** 用当前手牌里指定的一张牌打出最弱的合法阵型；返回是否打出。 */
  function playOneCard(match: MatchState, card: PlayingCard): boolean {
    // 传牌面进去才会按点数/花色过滤，否则可能选中一条不匹配该牌的阵型
    const formation = getFormationsFor(detectHandCategories([card]), [card])[0];
    if (!formation) return false;
    match.step([
      playFormationCommand(Faction.Blue, formation.id, [card.id], fromFloat(9), fromFloat(8)),
    ]);
    return true;
  }

  it('1-1：起手 1 张、上限 5 张、常规 5 秒补一张，整副牌随机发', () => {
    const { match } = createStageMatch(getStageById('c1_1')!);
    expect(match.getMaxHandSize()).toBe(5);
    // 常规阶段默认就是最慢的 5 秒档
    expect(match.getDrawIntervalTicks()).toBe(TICK_RATE * 5);
    const hand = match.decks[Faction.Blue].hand;
    // 起手一张，牌堆仍留着除这张外的整副牌（万能牌关闭时为 54 张）
    expect(hand).toHaveLength(1);
    expect(match.decks[Faction.Blue].availableCount).toBe(53);
  });

  it('1-1：没出兵时第一个目标未完成，打出一张牌即完成', () => {
    const { match, runner } = createStageMatch(getStageById('c1_1')!);
    run(match, runner, TICK_RATE * 2);
    expect(runner.tracker.getProgress(match).map((item) => item.done)).toEqual([false, false]);

    const card = match.decks[Faction.Blue].hand[0]!;
    expect(playOneCard(match, card)).toBe(true);
    run(match, runner, 1);
    expect(runner.tracker.getProgress(match).map((item) => item.done)).toEqual([true, false]);
    expect(runner.tracker.getStatus()).toBe('pending');
  });

  it('1-1：敌方区域中间只有一座初级箭塔，双方都没有主堡', () => {
    const { match, runner } = createStageMatch(getStageById('c1_1')!);
    const redBuildings = match.world.units.filter(
      (unit) => unit.faction === Faction.Red && !unit.dead,
    );
    expect(redBuildings).toHaveLength(1);
    const tower = redBuildings[0]!;
    expect(tower.typeId).toBe('building_tower');
    // 落在敌方半场正中间：横向居中、位于对方半场中部
    expect(toFloat(tower.pos.x)).toBeCloseTo(toFloat(ARENA_WIDTH) / 2, 0);
    expect(toFloat(tower.pos.y)).toBeGreaterThan(toFloat(ARENA_HEIGHT) / 2);
    // 双方主堡都被移除，对局不会自己收局，通关只看关卡目标
    expect(match.world.units.some((unit) => unit.typeId === 'building_base')).toBe(false);
    expect(match.result).toBeNull();

    const card = match.decks[Faction.Blue].hand[0]!;
    expect(playOneCard(match, card)).toBe(true);
    tower.hp = 0;
    tower.dead = true;
    run(match, runner, 2);
    expect(runner.tracker.getStatus()).toBe('success');
  });

  it('1-2：固定手牌 8888776，无基地且不补牌', () => {
    const { match, runner } = createStageMatch(getStageById('c1_2')!);
    const hand = match.decks[Faction.Blue].hand;
    expect(hand).toHaveLength(7);
    // 手牌按点数从大到小排序，应正好是四个 8、两个 7、一个 6
    expect(hand.map((card) => card.rank)).toEqual(['8', '8', '8', '8', '7', '7', '6']);
    run(match, runner, TICK_RATE * 30);
    // 整局不补牌：手牌张数与牌堆余量都不变
    expect(match.decks[Faction.Blue].hand).toHaveLength(7);
    expect(match.decks[Faction.Blue].availableCount).toBe(0);
    // 双方都没有主堡，对局不会自己收局
    expect(match.world.units.some((unit) => unit.typeId === 'building_base')).toBe(false);
    expect(match.result).toBeNull();
    expect(runner.tracker.getStatus()).toBe('pending');
  });

  it('1-2：四张 8 凑成炸弹，一次炸光敌方全部部队后通关', () => {
    const { match, runner } = createStageMatch(getStageById('c1_2')!);
    const hand = match.decks[Faction.Blue].hand;
    const bomb = fourOfAKind(hand);
    expect(bomb).toHaveLength(4);
    match.step([
      playFormationCommand(Faction.Blue, 'bomb_giant_bomb', bomb.map((card) => card.id), fromFloat(9.6), fromFloat(21.7)),
    ]);
    // 炸弹从场地中线抛出，留出落地时间
    run(match, runner, TICK_RATE * 3);
    expect(match.world.units.filter((unit) => unit.faction === Faction.Red && !unit.dead)).toHaveLength(0);
    expect(runner.tracker.getStatus()).toBe('success');
  });

  it('1-2：全程不出牌，时间耗尽判定失败', () => {
    const { match, runner } = createStageMatch(getStageById('c1_2')!);
    run(match, runner, TICK_RATE * (CAMPAIGN_STAGE_SECONDS + 1));
    expect(runner.tracker.getStatus()).toBe('fail');
  });

  it('1-3：固定手牌含一张万能牌与三张 8，无基地且不补牌', () => {
    const { match, runner } = createStageMatch(getStageById('c1_3')!);
    const hand = match.decks[Faction.Blue].hand;
    // 手牌按牌力降序：万能牌最强排最前，其后三个 8、7、6、5
    expect(hand).toHaveLength(7);
    expect(hand.map((card) => card.rank)).toEqual(['WILD', '8', '8', '8', '7', '6', '5']);
    expect(hand.filter(isWildCard)).toHaveLength(1);
    run(match, runner, TICK_RATE * 30);
    expect(match.decks[Faction.Blue].hand).toHaveLength(7);
    expect(match.decks[Faction.Blue].availableCount).toBe(0);
    expect(match.world.units.some((unit) => unit.typeId === 'building_base')).toBe(false);
    expect(match.result).toBeNull();
    expect(runner.tracker.getStatus()).toBe('pending');
  });

  it('1-3：三张 8 单独不成炸弹，配万能牌才凑成炸弹', () => {
    const { match } = createStageMatch(getStageById('c1_3')!);
    const hand = match.decks[Faction.Blue].hand;
    const wild = hand.find(isWildCard)!;
    const eights = hand.filter((card) => card.rank === '8');
    expect(eights).toHaveLength(3);

    // 少了那张 8：三条不构成炸弹，阵型列表里也就没有炸弹方案
    expect(detectHandCategories(eights)).not.toContain('bomb');
    expect(getFormationsFor(detectHandCategories(eights), eights).some((item) => item.category === 'bomb')).toBe(false);
    // 万能牌补第四张 8：牌型与阵型都变成炸弹
    const withWild = [...eights, wild];
    expect(detectHandCategories(withWild)).toContain('bomb');
    expect(getFormationsFor(detectHandCategories(withWild), withWild).map((item) => item.id)).toContain(
      'bomb_giant_bomb',
    );
  });

  it('1-3：万能牌当第四张 8 凑成炸弹，一次炸光敌方全部部队后通关', () => {
    const { match, runner } = createStageMatch(getStageById('c1_3')!);
    const hand = match.decks[Faction.Blue].hand;
    const wild = hand.find(isWildCard)!;
    const eights = hand.filter((card) => card.rank === '8');
    const bomb = [...eights, wild];
    // 落点取敌阵中心：炸弹半径 4.5 格，敌阵 4×3 铺在 7.5～11.5，正对中心可全清
    match.step([
      playFormationCommand(Faction.Blue, 'bomb_giant_bomb', bomb.map((card) => card.id), fromFloat(9.5), fromFloat(22.8)),
    ]);
    run(match, runner, TICK_RATE * 4);
    expect(match.world.units.filter((unit) => unit.faction === Faction.Red && !unit.dead)).toHaveLength(0);
    expect(runner.tracker.getStatus()).toBe('success');
  });

  it('1-3：只出三条 8 兵力不足，清场目标仍未达成', () => {
    const { match, runner } = createStageMatch(getStageById('c1_3')!);
    const eights = match.decks[Faction.Blue].hand.filter((card) => card.rank === '8');
    const triple = getFormationsFor(detectHandCategories(eights), eights)[0]!;
    match.step([
      playFormationCommand(Faction.Blue, triple.id, eights.map((card) => card.id), fromFloat(9), fromFloat(12)),
    ]);
    run(match, runner, TICK_RATE * 60);
    // 六只民兵打不完十二个敌人：清场目标仍未达成
    expect(match.world.units.some((unit) => unit.faction === Faction.Red && !unit.dead)).toBe(true);
    expect(runner.tracker.getStatus()).toBe('pending');
  });

  it('1-3：全程不出牌，时间耗尽判定失败', () => {
    const { match, runner } = createStageMatch(getStageById('c1_3')!);
    run(match, runner, TICK_RATE * (CAMPAIGN_STAGE_SECONDS + 1));
    expect(runner.tracker.getStatus()).toBe('fail');
  });

  it('手牌出完且场上没兵、目标还没达成时提前判负', () => {
    // 固定两张单牌 + 一个敌方单位：两张开完后既无牌也无兵，清场目标仍未达成
    const { match, runner } = createStageMatch({
      ...baseDef,
      castles: false,
      periodicDraw: false,
      fixedHand: ['6', '7'],
      preset: [{ faction: 1, typeId: 'melee_grunt', x: 9, y: 26 }],
      objectives: [{ kind: 'clear_enemy_units' }],
    });
    for (const card of [...match.decks[Faction.Blue].hand]) playOneCard(match, card);
    run(match, runner, 1);
    expect(match.decks[Faction.Blue].hand).toHaveLength(0);
    // 兵还在场，此时不该判负
    expect(runner.tracker.getStatus()).toBe('pending');

    for (const unit of match.world.units) {
      if (unit.faction !== Faction.Blue) continue;
      unit.hp = 0;
      unit.dead = true;
    }
    run(match, runner, 1);
    expect(runner.tracker.getStatus()).toBe('fail');
  });

  it('战役固定 120 秒单段常规阶段，时间到直接按血量收局', () => {
    for (const def of CAMPAIGN_STAGES) {
      const { match } = createStageMatch(def);
      expect(match.getHudDeadlineTick()).toBe(TICK_RATE * CAMPAIGN_STAGE_SECONDS);
      expect(match.getPhaseDeadlineTick()).toBe(TICK_RATE * CAMPAIGN_STAGE_SECONDS);
    }
    // 前两关拆掉了主堡、不会自动收局，这里用一座主堡的临时关验证纯时间到收局
    const { match, runner } = createStageMatch({
      ...baseDef,
      objectives: [{ kind: 'survive_seconds', seconds: CAMPAIGN_STAGE_SECONDS + 60 }],
    });
    const phases = new Set<string>();
    for (let i = 0; i < TICK_RATE * CAMPAIGN_STAGE_SECONDS; i += 1) {
      const command = runner.decide(match);
      match.step(command ? [command] : []);
      phases.add(match.phase);
      if (match.result) break;
    }
    expect([...phases]).toEqual(['normal', 'ended']);
    expect(match.result?.reason).toBe('time_limit');
    expect(match.world.tick).toBe(TICK_RATE * CAMPAIGN_STAGE_SECONDS);
  });
});

/** 从手牌里找四张同点数的牌；没有返回空数组。 */
function fourOfAKind(hand: readonly PlayingCard[]): PlayingCard[] {
  for (const card of hand) {
    const same = hand.filter((other) => other.rank === card.rank);
    if (same.length >= 4) return same.slice(0, 4);
  }
  return [];
}

describe('ScriptedEnemy', () => {
  it('到点才出兵，同一步多个单位横向展开', () => {
    const match = new MatchState(3);
    match.seedStartingCastles();
    const enemy = new ScriptedEnemy([
      { atSeconds: 1, typeId: 'melee_grunt', count: 3, x: 9, y: 26 },
    ]);
    expect(enemy.remaining).toBe(3);
    expect(enemy.decide(match)).toBeNull();
    for (let i = 0; i < TICK_RATE + 5; i += 1) {
      const command = enemy.decide(match);
      match.step(command ? [command] : []);
    }
    expect(enemy.remaining).toBe(0);
    const reds = match.world.units.filter(
      (unit) => unit.faction === Faction.Red && unit.typeId === 'melee_grunt',
    );
    expect(reds).toHaveLength(3);
    expect(new Set(reds.map((unit) => unit.pos.x)).size).toBe(3);
  });
});
