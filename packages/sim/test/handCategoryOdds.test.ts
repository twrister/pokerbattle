import { describe, expect, it } from 'vitest';
import { createPokerCards, type PlayingCard } from '../src/cards/deck.js';
import { listPresentCategories } from '../src/cards/handCategory.js';
import {
  estimateHandCategoryOdds,
  HAND_ODDS_MAX_SIZE,
  HAND_ODDS_MIN_SIZE,
} from '../src/cards/handCategoryOdds.js';
import { Rng } from '../src/math/rng.js';

const ALL = createPokerCards();

/** 按牌 id 取牌，写错 id 时立刻失败。 */
function card(id: string): PlayingCard {
  const found = ALL.find((entry) => entry.id === id);
  if (!found) throw new Error(`测试牌不存在：${id}`);
  return found;
}

describe('listPresentCategories', () => {
  it('空手牌返回空', () => {
    expect(listPresentCategories([])).toEqual([]);
  });

  it('仅单张时只有 single', () => {
    expect(listPresentCategories([card('7-hearts')])).toEqual(['single']);
  });

  it('含对子时同时命中 pair 与 single', () => {
    expect(listPresentCategories([card('9-spades'), card('9-hearts'), card('3-clubs')])).toEqual([
      'pair',
      'single',
    ]);
  });

  it('同花顺同时计入 straight_flush / flush / straight5', () => {
    const hand = [
      card('6-spades'),
      card('7-spades'),
      card('8-spades'),
      card('9-spades'),
      card('10-spades'),
      card('2-hearts'),
    ];
    const present = listPresentCategories(hand);
    expect(present).toContain('straight_flush');
    expect(present).toContain('flush');
    expect(present).toContain('straight5');
    expect(present).toContain('single');
  });

  it('王炸计入 rocket 与 pair', () => {
    const present = listPresentCategories([
      card('joker-black'),
      card('joker-red'),
      card('4-diamonds'),
    ]);
    expect(present).toContain('rocket');
    expect(present).toContain('pair');
  });
});

describe('estimateHandCategoryOdds', () => {
  it('拒绝越界 handSize', () => {
    expect(() => estimateHandCategoryOdds({ handSize: HAND_ODDS_MIN_SIZE - 1 })).toThrow();
    expect(() => estimateHandCategoryOdds({ handSize: HAND_ODDS_MAX_SIZE + 1 })).toThrow();
  });

  it('handSize=5 时 single 概率为 1，且稀有牌型低于对子', () => {
    const result = estimateHandCategoryOdds({
      handSize: 5,
      trials: 2000,
      rng: new Rng(42),
    });
    expect(result.probabilities.single).toBe(1);
    expect(result.probabilities.pair).toBeGreaterThan(result.probabilities.rocket);
    expect(result.probabilities.pair).toBeGreaterThan(result.probabilities.straight_flush);
    expect(result.probabilities.bomb).toBeLessThan(result.probabilities.triple);
  });

  it('同一种子结果可复现', () => {
    const a = estimateHandCategoryOdds({ handSize: 8, trials: 500, rng: new Rng(7) });
    const b = estimateHandCategoryOdds({ handSize: 8, trials: 500, rng: new Rng(7) });
    expect(a.probabilities).toEqual(b.probabilities);
  });
});
