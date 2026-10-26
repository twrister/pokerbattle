import { describe, expect, it } from 'vitest';
import {
  PokerDeck,
  WILD_CARD_IDS,
  WILD_CARD_RANK,
  createPokerCards,
  isWildCard,
  type PlayingCard,
} from '../src/cards/deck.js';
import { detectConcreteCategories } from '../src/cards/handCategoryDetect.js';
import { detectHandCategories, describeWildSubstitution } from '../src/cards/handCategory.js';
import { expandWildSubstitutions } from '../src/cards/wildCard.js';
import { Rng } from '../src/math/rng.js';
import { getFormationsFor, type FormationMatchRule } from '../src/config/cardFormations.js';
import type { UnitTypeId } from '../src/config/units.js';
import {
  cardsMatchConcreteRule,
  cardsMatchRule,
  resolveFuseBombDamage,
  resolveMappedRows,
} from '../src/config/cardMapping.js';
import { fromFloat } from '../src/math/fixed.js';

const ALL = createPokerCards({ wildCards: true });
const PLAIN = createPokerCards();
const ALL_BY_ID = new Map(ALL.map((card) => [card.id, card]));

/** 按牌 id 取牌，写错 id 时立刻失败。 */
function card(id: string): PlayingCard {
  const found = ALL_BY_ID.get(id);
  if (!found) throw new Error(`测试牌不存在：${id}`);
  return found;
}

const WILD = WILD_CARD_IDS.map(card);

/** 暴力基准：枚举替代方案后逐条识别，与解析式实现交叉校验。 */
function bruteCategories(cards: readonly PlayingCard[]): string[] {
  const hits = new Set<string>();
  for (const variant of expandWildSubstitutions(cards)) {
    for (const category of detectConcreteCategories(variant)) hits.add(category);
  }
  return [...hits].sort();
}

/** 暴力基准：枚举替代方案后逐条试匹配。 */
function bruteMatch(cards: readonly PlayingCard[], match: FormationMatchRule): boolean {
  return expandWildSubstitutions(cards).some((variant) => cardsMatchConcreteRule(variant, match));
}

describe('万能牌牌堆', () => {
  it('开关关闭保持 54 张，开启后追加 2 张万能牌', () => {
    expect(PLAIN).toHaveLength(54);
    expect(ALL).toHaveLength(56);
    expect(ALL.filter(isWildCard)).toHaveLength(2);
    expect(
      ALL.filter((entry) => entry.rank === WILD_CARD_RANK)
        .map((entry) => entry.id),
    ).toEqual([...WILD_CARD_IDS]);
  });

  it('牌堆按开关建牌，且 reset 不丢万能牌', () => {
    const deck = new PokerDeck(createPokerCards({ wildCards: true }), new Rng(1));
    expect(deck.hand.length + deck.availableCount).toBe(56);

    deck.reset();
    expect(deck.hand.length + deck.availableCount).toBe(56);

    const plainDeck = new PokerDeck(createPokerCards(), new Rng(1));
    expect(plainDeck.hand.length + plainDeck.availableCount).toBe(54);
  });

  it('万能牌牌力最高，排在大小王之上', () => {
    const deck = new PokerDeck([...WILD, card('joker-red')], new Rng(1));
    deck.drawMany(3);
    expect(deck.hand.map((entry) => entry.id)).toEqual([
      WILD_CARD_IDS[0],
      WILD_CARD_IDS[1],
      'joker-red',
    ]);
  });
});

describe('万能牌替代枚举（暴力基准）', () => {
  it('无万能牌时原样返回一组', () => {
    const cards = [card('9-spades'), card('9-hearts')];
    expect(expandWildSubstitutions(cards)).toEqual([cards]);
  });

  it('全是万能牌或混入大小王时不产生替代方案', () => {
    expect(expandWildSubstitutions([WILD[0]!, WILD[1]!])).toEqual([]);
    expect(expandWildSubstitutions([WILD[0]!, card('joker-black')])).toEqual([]);
  });

  it('替身沿用万能牌自身 id，便于扣牌与回放', () => {
    const variants = expandWildSubstitutions([WILD[0]!, card('9-hearts')]);
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.every((variant) => variant[0]!.id === WILD_CARD_IDS[0])).toBe(true);
  });
});

describe('万能牌牌型识别', () => {
  it('万能牌补对子', () => {
    expect(detectHandCategories([WILD[0]!, card('9-hearts')])).toEqual(['pair']);
  });

  it('万能牌补三条与炸弹', () => {
    expect(detectHandCategories([WILD[0]!, card('9-spades'), card('9-hearts')])).toEqual(['triple']);
    expect(
      detectHandCategories([WILD[0]!, card('9-spades'), card('9-hearts'), card('9-clubs')]),
    ).toEqual(['bomb']);
  });

  it('万能牌补顺子与同花顺', () => {
    expect(
      detectHandCategories([WILD[0]!, card('3-hearts'), card('4-clubs'), card('5-spades')]),
    ).toContain('straight4');
    expect(
      detectHandCategories([
        WILD[0]!,
        card('7-spades'),
        card('8-spades'),
        card('9-spades'),
        card('10-spades'),
      ]),
    ).toContain('straight_flush');
  });

  it('万能牌不能组成王炸，也不能替代大小王', () => {
    expect(detectHandCategories([WILD[0]!, card('joker-red')])).toEqual([]);
    expect(detectHandCategories([WILD[0]!, WILD[1]!])).toEqual([]);
  });

  it('解析式牌型与暴力枚举完全一致（全组合抽样）', () => {
    const pool = [
      WILD[0]!,
      WILD[1]!,
      card('5-spades'),
      card('5-hearts'),
      card('6-spades'),
      card('7-spades'),
      card('8-hearts'),
      card('A-diamonds'),
      card('K-clubs'),
    ];
    const checked = checkCombinations(pool, 5, (combo) => {
      expect(detectHandCategories(combo).slice().sort()).toEqual(bruteCategories(combo));
    });
    expect(checked).toBeGreaterThan(300);
  });
});

describe('万能牌替身说明', () => {
  it('无万能牌时不返回说明', () => {
    expect(describeWildSubstitution([card('9-spades'), card('9-hearts')])).toBeNull();
  });

  it('同点数类给出被当作的点数', () => {
    expect(describeWildSubstitution([WILD[0]!, card('9-hearts')])).toEqual({
      category: 'pair',
      wilds: [{ cardId: WILD_CARD_IDS[0], rank: '9', label: '9' }],
    });
    expect(
      describeWildSubstitution([WILD[0]!, card('9-spades'), card('9-hearts'), card('9-clubs')]),
    ).toEqual({
      category: 'bomb',
      wilds: [{ cardId: WILD_CARD_IDS[0], rank: '9', label: '9' }],
    });
  });

  it('顺子的替身与阵型判定取同一档', () => {
    // 癞子 + K + Q 补 A 成 Q-K-A，与 getFormationsFor 收敛到的档位一致
    expect(describeWildSubstitution([WILD[0]!, card('K-hearts'), card('Q-spades')])).toEqual({
      category: 'straight3',
      wilds: [{ cardId: WILD_CARD_IDS[0], rank: 'A', label: 'A' }],
    });
    // 3-4-5 补 6，窗顶最高
    expect(describeWildSubstitution([WILD[0]!, card('3-hearts'), card('4-clubs'), card('5-spades')]))
      .toEqual({
        category: 'straight4',
        wilds: [{ cardId: WILD_CARD_IDS[0], rank: '6', label: '6' }],
      });
  });

  it('两张万能牌按张数逐个列出', () => {
    expect(describeWildSubstitution([WILD[0]!, WILD[1]!, card('J-spades')])).toEqual({
      category: 'triple',
      wilds: [
        { cardId: WILD_CARD_IDS[0], rank: 'J', label: 'J' },
        { cardId: WILD_CARD_IDS[1], rank: 'J', label: 'J' },
      ],
    });
  });

  it('同花没有点数含义，替身点数留空', () => {
    const info = describeWildSubstitution([
      WILD[0]!,
      card('2-spades'),
      card('5-spades'),
      card('9-spades'),
      card('K-spades'),
    ]);
    expect(info && info.category).toBe('flush');
    expect(info && info.wilds).toEqual([{ cardId: WILD_CARD_IDS[0], rank: null, label: '' }]);
  });

  it('凑不成牌型时不返回说明', () => {
    expect(describeWildSubstitution([WILD[0]!])).toBeNull();
    expect(describeWildSubstitution([WILD[0]!, WILD[1]!])).toBeNull();
    expect(describeWildSubstitution([WILD[0]!, card('joker-red')])).toBeNull();
  });
});

describe('万能牌阵型匹配', () => {
  // 交叉校验覆盖「有唯一解析语义」的规则；tripleRanks 单独用例覆盖（见下方葫芦用例）
  const rules: readonly FormationMatchRule[] = [
    { kind: 'any' },
    { kind: 'numbers' },
    { kind: 'ranks', ranks: ['A'] },
    { kind: 'ranks', ranks: ['5'] },
    { kind: 'ranks', ranks: ['7', '8', '9'] },
    { kind: 'ranks', ranks: ['10', 'J', 'Q', 'K', 'A'] },
    { kind: 'rankCount', ranks: ['J', 'Q', 'K', 'A'], min: 2 },
    { kind: 'rankCount', ranks: ['J', 'Q', 'K', 'A'], max: 1 },
    { kind: 'joker', joker: 'red' },
  ];

  it('解析式匹配与暴力枚举完全一致（规则 × 组合抽样）', () => {
    const pool = [
      WILD[0]!,
      WILD[1]!,
      card('5-spades'),
      card('5-hearts'),
      card('7-clubs'),
      card('8-hearts'),
      card('J-spades'),
      card('A-diamonds'),
      card('joker-black'),
    ];
    let checked = 0;
    checkCombinations(pool, 5, (combo) => {
      for (const rule of rules) {
        expect([combo.map((entry) => entry.id).join('+'), cardsMatchRule(combo, rule)]).toEqual([
          combo.map((entry) => entry.id).join('+'),
          bruteMatch(combo, rule),
        ]);
        checked += 1;
      }
    });
    expect(checked).toBeGreaterThan(2000);
  });

  it('葫芦的三条点数决定 tripleRanks 命中', () => {
    // 万能牌补三条 J：JJJ + 2 2 命中 J～A 档，不命中 2～10 档
    const pairWild = [WILD[0]!, card('J-spades'), card('J-hearts'), card('2-clubs'), card('2-diamonds')];
    expect(cardsMatchRule(pairWild, { kind: 'tripleRanks', ranks: ['J', 'Q', 'K', 'A'] })).toBe(true);
    expect(cardsMatchRule(pairWild, { kind: 'tripleRanks', ranks: ['5', '6', '7'] })).toBe(false);

    // 两条万能牌补成 JJJ + 2 2 也成立
    const twoWild = [WILD[0]!, WILD[1]!, card('J-spades'), card('2-clubs'), card('2-diamonds')];
    expect(cardsMatchRule(twoWild, { kind: 'tripleRanks', ranks: ['J'] })).toBe(true);
  });


  it('rows 展开与匹配规则一致', () => {
    const rows: UnitTypeId[][] = [['melee_grunt']];
    expect(resolveMappedRows(rows, { kind: 'ranks', ranks: ['Q'] }, [WILD[0]!, card('Q-hearts')])).toEqual([
      [{ typeId: 'melee_grunt' }],
    ]);
    expect(resolveMappedRows(rows, { kind: 'joker', joker: 'red' }, [WILD[0]!, card('joker-red')])).toBeNull();
  });

  it('引信炸弹按万能牌能替到的最高点数取伤害档', () => {
    const wish = { category: 'bomb' as const, rankDamage: { '2-10': 600, A: 1000 } };
    expect(
      resolveFuseBombDamage(wish, [WILD[0]!, card('3-hearts'), card('3-spades'), card('3-clubs')]),
    ).toBe(fromFloat(1000));
  });
});

describe('万能牌阵型档位收敛', () => {
  /** 选中这组牌后可选的阵型 id；无牌型时返回空数组。 */
  function formationIds(cardIds: readonly string[]): string[] {
    const cards = cardIds.map(card);
    return getFormationsFor(detectHandCategories(cards), cards).map((formation) => formation.id);
  }

  it('癞子 + K + Q 收敛到 Q-K-A，不再列 J-Q-K', () => {
    expect(formationIds(['wild-1', 'K-hearts', 'Q-spades'])).toEqual([
      'straight3_QKA',
      'straight3_QKA_special__ranged_ballista',
      'straight3_QKA_special__melee_charge_wagon',
    ]);
  });

  it('癞子补顺子取窗顶最高的一档', () => {
    // 癞子补 Q 成 10-J-Q，而不是补 9 成 9-10-J
    expect(formationIds(['wild-1', '10-spades', 'J-hearts'])).toEqual(['straight3_10JQ']);
    // A 只能作低牌，窗口固定 A-2-3，不会滑到 2-3-4
    expect(formationIds(['wild-1', 'A-spades', '2-hearts'])).toEqual(['straight3_A23']);
    // 癞子补 4 成 2-3-4（数字档），不残留 A-2-3
    expect(formationIds(['wild-1', '2-spades', '3-hearts'])).toEqual(['straight3_number']);
  });

  it('癞子补连对与葫芦都取点数更大的一档', () => {
    // K-K + A + 癞子 → K-K-A-A，而不是把 A 当 2 的 A-A-2-2
    expect(formationIds(['wild-1', 'K-spades', 'K-hearts', 'A-clubs'])[0]).toBe('two_pair_KA');
    // 癞子补三条 J 成 JJJ + 2 2，走 J～A 档而不落回 2～10 档
    expect(formationIds(['wild-1', '9-spades', '9-hearts', 'J-clubs', 'J-diamonds'])[0]).toBe(
      'full_house_JA__building_tower_triple',
    );
  });

  it('无点数含义的牌型与无万能牌时保持原样', () => {
    // 同花顺只看花色，不因替身收敛
    expect(formationIds(['wild-1', '7-spades', '8-spades', '9-spades', '10-spades'])).toEqual([
      'straight_flush_chariot',
      'straight_flush_dragon',
    ]);
    // 无万能牌：J-Q-K 用自己的方案，不会跳到 Q-K-A
    expect(formationIds(['J-spades', 'Q-hearts', 'K-clubs'])[0]).toBe('straight3_JQK');
  });
});

/** 枚举 pool 中 1～maxSize 张全部组合并回调；返回检查过的组合数。 */
function checkCombinations(
  pool: readonly PlayingCard[],
  maxSize: number,
  visit: (combo: PlayingCard[]) => void,
): number {
  let count = 0;
  const combo: PlayingCard[] = [];
  const walk = (start: number, size: number): void => {
    if (combo.length === size) {
      visit([...combo]);
      count += 1;
      return;
    }
    for (let index = start; index <= pool.length - (size - combo.length); index += 1) {
      combo.push(pool[index]!);
      walk(index + 1, size);
      combo.pop();
    }
  };
  for (let size = 1; size <= maxSize; size += 1) walk(0, size);
  return count;
}
