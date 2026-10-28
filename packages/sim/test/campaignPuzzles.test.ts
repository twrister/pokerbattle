import { describe, expect, it } from 'vitest';
import {
  Faction,
  MatchState,
  StageRunner,
  TICK_RATE,
  detectHandCategories,
  fromFloat,
  getFormationsFor,
  getStageById,
  playFormationCommand,
  type StageOutcome,
} from '../src/index.js';

/** 一次出牌：第几秒、用哪些点数、选哪个阵型、落在哪。 */
interface Play {
  at: number;
  ranks: string[];
  formation: string;
  x: number;
  y: number;
}

/**
 * 无头跑一关：按时间表出牌，直到关卡结果落定或超时。
 * 阵型不在可选列表里直接抛错，避免关卡数据改坏后测试静默通过。
 */
function playStage(stageId: string, plays: Play[], seconds = 130): StageOutcome | null {
  const def = getStageById(stageId)!;
  const match = new MatchState(def.seed);
  match.seedStartingCastles();
  const runner = new StageRunner(def, match);
  const queue = [...plays];
  for (let tick = 0; tick < seconds * TICK_RATE; tick += 1) {
    const commands = [];
    const enemy = runner.decide(match);
    if (enemy) commands.push(enemy);
    while (queue[0] && queue[0].at * TICK_RATE <= tick) {
      const play = queue.shift()!;
      const hand = [...match.decks[Faction.Blue]!.hand];
      const cards = play.ranks.map((rank) => hand.splice(hand.findIndex((card) => card.rank === rank), 1)[0]!);
      const options = getFormationsFor(detectHandCategories(cards), cards).map((item) => item.id);
      if (!options.includes(play.formation)) throw new Error(`阵型 ${play.formation} 不可用：${options.join(',')}`);
      const ids = cards.map((card) => card.id);
      commands.push(playFormationCommand(Faction.Blue, play.formation, ids, fromFloat(play.x), fromFloat(play.y)));
    }
    match.step(commands);
    runner.update();
    const outcome = runner.tracker.getOutcome();
    if (outcome) return outcome;
  }
  return null;
}

const STRAIGHT = ['WILD', '7', '8', '9', 'J'];

describe('第 4 关：万能牌补顺子（要塞）', () => {
  it('万能牌补成五顺召唤飞龙，越过城墙拆塔', () => {
    const outcome = playStage('s4', [{ at: 0.5, ranks: STRAIGHT, formation: 'straight5_custom_14', x: 3, y: 12 }]);
    expect(outcome?.status).toBe('success');
  });

  it('同一手五顺出地面兵，被城门卫士挡住', () => {
    const outcome = playStage('s4', [{ at: 0.5, ranks: STRAIGHT, formation: 'straight5_78910J', x: 9, y: 12 }]);
    expect(outcome).toMatchObject({ status: 'fail', reason: 'timeout' });
  });

  it('限一手：先出对子再出顺子直接判负', () => {
    const outcome = playStage('s4', [
      { at: 0.5, ranks: ['3', '3'], formation: 'pair_grunt', x: 9, y: 10 },
      { at: 1, ranks: STRAIGHT, formation: 'straight5_custom_14', x: 3, y: 12 },
    ]);
    expect(outcome).toMatchObject({ status: 'fail', reason: 'too_many_plays' });
  });
});

describe('第 5 关：守住 30 秒（丛林）', () => {
  it('按三波来袭依次补兵，撑满 30 秒通关', () => {
    const outcome = playStage('s5', [
      { at: 1, ranks: ['9', '9', '9'], formation: 'triple_grunt', x: 9, y: 10 },
      { at: 9, ranks: ['4', '5', '6'], formation: 'straight3_number', x: 5, y: 9 },
      { at: 17, ranks: ['K'], formation: 'single_K', x: 13, y: 8 },
    ]);
    expect(outcome?.status).toBe('success');
    expect(outcome?.seconds).toBe(30);
  });

  it('不出牌时残血主堡撑不到 30 秒', () => {
    const outcome = playStage('s5', []);
    expect(outcome?.status).toBe('fail');
    expect(outcome!.seconds).toBeLessThan(30);
  });

  it('只出一张单牌同样守不住', () => {
    const outcome = playStage('s5', [{ at: 1, ranks: ['K'], formation: 'single_K', x: 9, y: 10 }]);
    expect(outcome?.status).toBe('fail');
  });
});

describe('第 6 关：禁用炸弹（海岛）', () => {
  it('四张 8 拆成两个对子分路出，清场通关', () => {
    const outcome = playStage('s6', [
      { at: 0.5, ranks: ['8', '8'], formation: 'pair_archer', x: 2, y: 12 },
      { at: 0.6, ranks: ['8', '8'], formation: 'pair_archer', x: 16, y: 12 },
      { at: 0.7, ranks: ['9', '9'], formation: 'pair_grunt', x: 9, y: 12 },
    ]);
    expect(outcome?.status).toBe('success');
  });

  it('手里的炸弹是诱饵：打出即判负', () => {
    const outcome = playStage('s6', [
      { at: 0.5, ranks: ['8', '8', '8', '8'], formation: 'bomb_giant_bomb', x: 9, y: 24 },
    ]);
    expect(outcome).toMatchObject({ status: 'fail', reason: 'forbidden_category' });
  });
});

describe('第 7 关：先拔投弹车（要塞）', () => {
  it('飞龙去拔投弹车，国王对子配民兵拆塔，三手内通关', () => {
    const outcome = playStage('s7', [
      { at: 0.5, ranks: ['7', '8', '9', '10', 'J'], formation: 'straight5_custom_14', x: 3, y: 12 },
      { at: 20, ranks: ['K', 'K'], formation: 'pair_K', x: 15, y: 12 },
      { at: 20.1, ranks: ['5', '5'], formation: 'pair_grunt', x: 15, y: 12 },
    ]);
    expect(outcome?.status).toBe('success');
  });

  it('五顺出地面兵：攻不进城墙，投弹车一直活着', () => {
    const outcome = playStage('s7', [
      { at: 0.5, ranks: ['7', '8', '9', '10', 'J'], formation: 'straight5_78910J', x: 9, y: 12 },
      { at: 1, ranks: ['K', 'K'], formation: 'pair_K', x: 4, y: 12 },
    ]);
    expect(outcome).toMatchObject({ status: 'fail', reason: 'timeout' });
  });

  it('不出飞龙只用对子，拆不掉投弹车', () => {
    const outcome = playStage('s7', [
      { at: 0.5, ranks: ['K', 'K'], formation: 'pair_K', x: 4, y: 12 },
      { at: 1, ranks: ['5', '5'], formation: 'pair_grunt', x: 4, y: 12 },
    ]);
    expect(outcome?.status).toBe('fail');
  });
});

describe('战役地图', () => {
  it('要塞城墙阻挡地面寻路，换回默认关卡后障碍清空', () => {
    const def = getStageById('s4')!;
    const match = new MatchState(def.seed);
    match.seedStartingCastles();
    new StageRunner(def, match);
    // 城墙 x∈[0,8)∪[10,18)、y∈[22,23)：墙上不可走，城门缺口可走
    expect(match.world.nav.isBlockedAt(fromFloat(4), fromFloat(22.5))).toBe(true);
    expect(match.world.nav.isBlockedAt(fromFloat(9), fromFloat(22.5))).toBe(false);
    expect(match.getCampaignArena()).toBe('fortress');

    const plain = new MatchState(1);
    expect(plain.world.nav.isBlockedAt(fromFloat(4), fromFloat(22.5))).toBe(false);
  });

  it('重开（clear）沿用本关地图', () => {
    const def = getStageById('s6')!;
    const match = new MatchState(def.seed);
    match.seedStartingCastles();
    new StageRunner(def, match);
    match.clear();
    // 海岛中间水潭 x∈[6,12)、y∈[12,15)
    expect(match.world.nav.isBlockedAt(fromFloat(9), fromFloat(13))).toBe(true);
  });
});
