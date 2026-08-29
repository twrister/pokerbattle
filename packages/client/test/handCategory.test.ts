import { describe, expect, it } from 'vitest';
import { createPokerCards, type PlayingCard } from '../src/cards/deck.js';
import { detectHandCategories, findStrongestHand, listRecommendHands } from '../src/cards/handCategory.js';

const ALL = createPokerCards();

/** 按牌 id 取牌，写错 id 时立刻失败，避免静默测到 undefined。 */
function card(id: string): PlayingCard {
  const found = ALL.find((entry) => entry.id === id);
  if (!found) throw new Error(`测试牌不存在：${id}`);
  return found;
}

describe('牌型识别 detectHandCategories', () => {
  it('单张命中 single', () => {
    expect(detectHandCategories([card('7-hearts')])).toEqual(['single']);
  });

  it('同点数两张命中 pair', () => {
    expect(detectHandCategories([card('9-spades'), card('9-hearts')])).toEqual(['pair']);
  });

  it('王炸同时命中 rocket 与 pair，且 rocket 排前', () => {
    expect(detectHandCategories([card('joker-black'), card('joker-red')])).toEqual([
      'rocket',
      'pair',
    ]);
  });

  it('三张相同命中 triple', () => {
    expect(
      detectHandCategories([card('5-spades'), card('5-hearts'), card('5-clubs')]),
    ).toEqual(['triple']);
  });

  it('三顺命中 straight3', () => {
    expect(
      detectHandCategories([card('3-diamonds'), card('4-hearts'), card('5-spades')]),
    ).toEqual(['straight3']);
  });

  it('四张相同命中 bomb', () => {
    expect(
      detectHandCategories([
        card('8-spades'),
        card('8-hearts'),
        card('8-clubs'),
        card('8-diamonds'),
      ]),
    ).toEqual(['bomb']);
  });

  it('三带一不再识别为合法牌型', () => {
    expect(
      detectHandCategories([
        card('6-spades'),
        card('6-hearts'),
        card('6-clubs'),
        card('K-diamonds'),
      ]),
    ).toEqual([]);
  });

  it('相邻两对命中连对 two_pair', () => {
    expect(
      detectHandCategories([
        card('4-spades'),
        card('4-hearts'),
        card('5-clubs'),
        card('5-diamonds'),
      ]),
    ).toEqual(['two_pair']);
  });

  it('不相邻的两对不算连对', () => {
    expect(
      detectHandCategories([
        card('4-spades'),
        card('4-hearts'),
        card('J-clubs'),
        card('J-diamonds'),
      ]),
    ).toEqual([]);
  });

  it('四顺命中 straight4；A-2-3-4 与 J-Q-K-A 均成立', () => {
    expect(
      detectHandCategories([
        card('7-spades'),
        card('8-hearts'),
        card('9-clubs'),
        card('10-diamonds'),
      ]),
    ).toEqual(['straight4']);

    expect(
      detectHandCategories([
        card('A-spades'),
        card('2-hearts'),
        card('3-clubs'),
        card('4-diamonds'),
      ]),
    ).toEqual(['straight4']);

    expect(
      detectHandCategories([
        card('J-spades'),
        card('Q-hearts'),
        card('K-clubs'),
        card('A-diamonds'),
      ]),
    ).toEqual(['straight4']);
  });

  it('葫芦命中 full_house', () => {
    expect(
      detectHandCategories([
        card('Q-spades'),
        card('Q-hearts'),
        card('Q-clubs'),
        card('2-diamonds'),
        card('2-spades'),
      ]),
    ).toEqual(['full_house']);
  });

  it('同花命中 flush', () => {
    expect(
      detectHandCategories([
        card('2-hearts'),
        card('5-hearts'),
        card('8-hearts'),
        card('J-hearts'),
        card('K-hearts'),
      ]),
    ).toEqual(['flush']);
  });

  it('五顺命中 straight5；A-2-3-4-5 与 J-Q-K-A 均成立', () => {
    expect(
      detectHandCategories([
        card('A-spades'),
        card('2-hearts'),
        card('3-clubs'),
        card('4-diamonds'),
        card('5-spades'),
      ]),
    ).toEqual(['straight5']);

    expect(
      detectHandCategories([
        card('J-spades'),
        card('Q-hearts'),
        card('K-clubs'),
        card('A-diamonds'),
        card('10-spades'),
      ]),
    ).toEqual(['straight5']);
  });

  it('Q-K-A-2 不是合法四张牌型', () => {
    expect(
      detectHandCategories([
        card('Q-spades'),
        card('K-hearts'),
        card('A-clubs'),
        card('2-diamonds'),
      ]),
    ).toEqual([]);
  });

  it('同花顺三重命中，按强度降序', () => {
    expect(
      detectHandCategories([
        card('6-spades'),
        card('7-spades'),
        card('8-spades'),
        card('9-spades'),
        card('10-spades'),
      ]),
    ).toEqual(['straight_flush', 'flush', 'straight5']);
  });

  it('含王的顺子/同花不成立', () => {
    expect(
      detectHandCategories([
        card('joker-black'),
        card('3-hearts'),
        card('4-clubs'),
      ]),
    ).toEqual([]);
    expect(
      detectHandCategories([
        card('joker-red'),
        card('2-hearts'),
        card('5-hearts'),
        card('8-hearts'),
        card('J-hearts'),
      ]),
    ).toEqual([]);
  });

  it('点数不同的两张、六张均返回空', () => {
    expect(detectHandCategories([card('3-spades'), card('7-hearts')])).toEqual([]);
    expect(
      detectHandCategories([
        card('3-spades'),
        card('4-hearts'),
        card('5-clubs'),
        card('6-diamonds'),
        card('7-spades'),
        card('8-hearts'),
      ]),
    ).toEqual([]);
  });
});

describe('findStrongestHand', () => {
  it('优先选更强牌型，同花顺压过对子', () => {
    const best = findStrongestHand([
      card('6-spades'),
      card('7-spades'),
      card('8-spades'),
      card('9-spades'),
      card('10-spades'),
      card('3-hearts'),
      card('3-clubs'),
    ]);
    expect(best.map((entry) => entry.id).sort()).toEqual([
      '10-spades',
      '6-spades',
      '7-spades',
      '8-spades',
      '9-spades',
    ]);
  });

  it('同牌型时选牌力更高的一组', () => {
    const best = findStrongestHand([
      card('8-spades'),
      card('8-hearts'),
      card('8-clubs'),
      card('8-diamonds'),
      card('3-spades'),
      card('3-hearts'),
      card('3-clubs'),
      card('3-diamonds'),
    ]);
    expect(best.map((entry) => entry.id).sort()).toEqual([
      '8-clubs',
      '8-diamonds',
      '8-hearts',
      '8-spades',
    ]);
  });

  it('空手牌返回空', () => {
    expect(findStrongestHand([])).toEqual([]);
  });
});

describe('listRecommendHands', () => {
  it('空手牌返回空', () => {
    expect(listRecommendHands([])).toEqual([]);
  });

  it('同花顺优先，对子档取最小牌面而不是更大对子', () => {
    const hands = listRecommendHands([
      card('6-spades'),
      card('7-spades'),
      card('8-spades'),
      card('9-spades'),
      card('10-spades'),
      card('3-hearts'),
      card('3-clubs'),
      card('5-hearts'),
      card('5-clubs'),
    ]);
    expect(hands[0]?.category).toBe('straight_flush');
    expect(sortedIds(hands[0]!.cards)).toEqual([
      '10-spades',
      '6-spades',
      '7-spades',
      '8-spades',
      '9-spades',
    ]);
    const pair = hands.find((entry) => entry.category === 'pair');
    expect(sortedIds(pair?.cards ?? [])).toEqual(['3-clubs', '3-hearts']);
  });

  it('两副炸弹只推更小的一档', () => {
    const hands = listRecommendHands([
      card('8-spades'),
      card('8-hearts'),
      card('8-clubs'),
      card('8-diamonds'),
      card('3-spades'),
      card('3-hearts'),
      card('3-clubs'),
      card('3-diamonds'),
    ]);
    const bomb = hands.find((entry) => entry.category === 'bomb');
    expect(sortedIds(bomb?.cards ?? [])).toEqual([
      '3-clubs',
      '3-diamonds',
      '3-hearts',
      '3-spades',
    ]);
  });

  it('葫芦 2～10 与 J～A 分成两档，各取该档最小牌面', () => {
    const hands = listRecommendHands([
      card('3-spades'),
      card('3-hearts'),
      card('3-clubs'),
      card('2-diamonds'),
      card('2-spades'),
      card('5-spades'),
      card('5-hearts'),
      card('5-clubs'),
      card('4-diamonds'),
      card('4-spades'),
      card('J-spades'),
      card('J-hearts'),
      card('J-clubs'),
      card('K-diamonds'),
      card('K-spades'),
    ]);
    const houses = hands.filter((entry) => entry.category === 'full_house');
    expect(houses).toHaveLength(2);
    expect(sortedIds(houses[0]!.cards)).toEqual([
      '2-diamonds',
      '2-spades',
      '3-clubs',
      '3-hearts',
      '3-spades',
    ]);
    // 5 档只看三条点数，对子取最小：JJJ 配 2 而不是 K。
    expect(sortedIds(houses[1]!.cards)).toEqual([
      '2-diamonds',
      '2-spades',
      'J-clubs',
      'J-hearts',
      'J-spades',
    ]);
  });

  it('对子 3 与对子 J 分成两档', () => {
    const hands = listRecommendHands([
      card('3-hearts'),
      card('3-clubs'),
      card('5-hearts'),
      card('5-clubs'),
      card('J-spades'),
      card('J-hearts'),
    ]);
    const pairs = hands.filter((entry) => entry.category === 'pair');
    expect(pairs).toHaveLength(2);
    expect(sortedIds(pairs[0]!.cards)).toEqual(['3-clubs', '3-hearts']);
    expect(sortedIds(pairs[1]!.cards)).toEqual(['J-hearts', 'J-spades']);
  });
});

/** 排序牌 id，避免组合枚举顺序影响断言。 */
function sortedIds(cards: readonly PlayingCard[]): string[] {
  return cards.map((entry) => entry.id).sort();
}
