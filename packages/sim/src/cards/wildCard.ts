import { isWildCard, type CardRank, type CardSuit, type PlayingCard } from './deck.js';

/**
 * 万能牌（癞子）替代枚举。
 *
 * 运行期判定走 wildRule.ts 的解析式实现；这里保留枚举是为了两件事：
 * 1. 测试里用暴力枚举交叉校验解析式结果，防止规则漂移；
 * 2. 需要「具体替身牌面」的场景（例如展示某条阵型实际用的点数）。
 */

/** 普通点数（不含王牌与万能牌），按由小到大排列。 */
const CONCRETE_RANKS: readonly CardRank[] = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
  'A',
];
/** 花色顺序与牌力一致，避免同一组替代方案随环境变化。 */
const CONCRETE_SUITS: readonly CardSuit[] = ['spades', 'hearts', 'clubs', 'diamonds'];

/** 花色符号，替身牌的 label 用。 */
const SUIT_SYMBOLS: Readonly<Record<CardSuit, string>> = {
  spades: '♠',
  hearts: '♥',
  clubs: '♣',
  diamonds: '♦',
};

/**
 * 枚举一小段组合中万能牌的全部替代方案。
 * - 无万能牌：返回原组合一份，调用方无需分支。
 * - 全是万能牌：返回空数组（万能牌必须至少搭配一张真牌才算成型）。
 * - 混入大小王：同样返回空，万能牌不能替代大小王。
 *
 * 花色只取「与真牌同色」和「不同色」两种策略：牌型只由点数多重集与是否同花决定，
 * 枚举 4 种花色纯属重复。
 */
export function expandWildSubstitutions(cards: readonly PlayingCard[]): PlayingCard[][] {
  const wildIndexes: number[] = [];
  const concreteCards: PlayingCard[] = [];
  cards.forEach((card, index) => {
    if (isWildCard(card)) wildIndexes.push(index);
    else concreteCards.push(card);
  });
  if (wildIndexes.length === 0) return [[...cards]];
  if (concreteCards.length === 0) return [];
  if (concreteCards.some((card) => card.joker !== undefined)) return [];

  const uniformSuit = concreteCards[0]!.suit ?? CONCRETE_SUITS[0]!;
  const allSameSuit = concreteCards.every((card) => card.suit === uniformSuit);
  const suitStrategies = allSameSuit
    ? [uniformSuit, CONCRETE_SUITS.find((suit) => suit !== uniformSuit) ?? uniformSuit]
    : [uniformSuit];

  const result: PlayingCard[][] = [];
  for (const ranks of rankMultisets(wildIndexes.length)) {
    for (const wildSuit of suitStrategies) {
      const variant = [...cards];
      wildIndexes.forEach((target, offset) => {
        const original = cards[target]!;
        const rank = ranks[offset]!;
        // 替身沿用万能牌自身 id：出牌扣牌、回放与指纹都按 id 走
        variant[target] = {
          id: original.id,
          rank,
          suit: wildSuit,
          label: `${rank}${SUIT_SYMBOLS[wildSuit]}`,
        };
      });
      result.push(variant);
    }
  }
  return result;
}

/**
 * 把万能牌替换成指定点数的具体牌面，用于「只按最强替身判定阵型」。
 * - 只替换万能牌，id 沿用原牌（扣牌、回放、指纹都按 id 走）；
 * - 花色跟随真牌：真牌同色时全部取该花色，否则取第一张真牌的花色，
 *   这样同花/同花顺判定不会被万能牌自己拆掉；
 * - ranks 比万能牌少时，多出来的万能牌保持原样，交由调用方兜底。
 */
export function substituteWildCards(
  cards: readonly PlayingCard[],
  ranks: readonly CardRank[],
): PlayingCard[] {
  const wildIndexes: number[] = [];
  const concretes: PlayingCard[] = [];
  cards.forEach((card, index) => {
    if (isWildCard(card)) wildIndexes.push(index);
    else concretes.push(card);
  });
  if (wildIndexes.length === 0) return [...cards];

  const suit = pickSubstituteSuit(concretes);
  const result = [...cards];
  wildIndexes.forEach((target, offset) => {
    const rank = ranks[offset];
    // 点数不足时保留原万能牌，调用方仍能按原牌面兜底
    if (!rank) return;
    result[target] = {
      id: result[target]!.id,
      rank,
      suit,
      label: `${rank}${SUIT_SYMBOLS[suit]}`,
    };
  });
  return result;
}

/** 替身花色：取第一张真牌的花色，真牌本就同色时也保住同花判定。 */
function pickSubstituteSuit(concretes: readonly PlayingCard[]): CardSuit {
  return concretes[0]?.suit ?? CONCRETE_SUITS[0]!;
}

/**
 * 生成 size 个点数的非降序多重集（允许重复），即替代方案的点数部分。
 * 非降序即可覆盖全部组合，避免 1,2 与 2,1 这样的重复枚举。
 */
function rankMultisets(size: number): CardRank[][] {
  const result: CardRank[][] = [];
  const current: CardRank[] = [];
  const walk = (start: number): void => {
    if (current.length === size) {
      result.push([...current]);
      return;
    }
    for (let index = start; index < CONCRETE_RANKS.length; index += 1) {
      current.push(CONCRETE_RANKS[index]!);
      walk(index);
      current.pop();
    }
  };
  walk(0);
  return result;
}
