import { HAND_CATEGORY_ORDER, type HandCategory } from '@pb/sim';
import type { CardRank, PlayingCard } from './deck.js';

/**
 * 顺子专用点数表，与手牌显示用的斗地主牌力解耦。
 * A 同时可作 1 与 14，由 isStraight 分别尝试。
 */
const STRAIGHT_VALUE: Readonly<Record<CardRank, number>> = {
  A: 14,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
};

/** 识别一组选中牌命中的全部牌型，按强度降序；不合法组合返回空数组。 */
export function detectHandCategories(cards: readonly PlayingCard[]): HandCategory[] {
  const count = cards.length;
  if (count < 1 || count > 5) return [];

  let hits: HandCategory[];
  switch (count) {
    case 1:
      hits = ['single'];
      break;
    case 2:
      hits = detectTwo(cards);
      break;
    case 3:
      hits = detectThree(cards);
      break;
    case 4:
      hits = detectFour(cards);
      break;
    case 5:
      hits = detectFive(cards);
      break;
    default:
      hits = [];
  }

  if (hits.length <= 1) return hits;
  const order = new Map(HAND_CATEGORY_ORDER.map((category, index) => [category, index]));
  return [...hits].sort((left, right) => (order.get(left) ?? 99) - (order.get(right) ?? 99));
}

/** 两张：对子；大小王额外命中王炸。 */
function detectTwo(cards: readonly PlayingCard[]): HandCategory[] {
  const [a, b] = cards;
  if (!a || !b) return [];
  if (a.joker && b.joker && a.joker !== b.joker) return ['rocket', 'pair'];
  if (!a.joker && !b.joker && a.rank === b.rank) return ['pair'];
  return [];
}

/** 三张：三条或三顺。 */
function detectThree(cards: readonly PlayingCard[]): HandCategory[] {
  if (hasJoker(cards)) return [];
  const groups = rankCounts(cards);
  if (groups.length === 1 && groups[0] === 3) return ['triple'];
  if (isStraight(cards)) return ['straight3'];
  return [];
}

/** 四张：炸弹 / 四顺 / 三带一 / 双对。 */
function detectFour(cards: readonly PlayingCard[]): HandCategory[] {
  if (hasJoker(cards)) return [];
  const groups = rankCounts(cards);
  if (groups.length === 1 && groups[0] === 4) return ['bomb'];
  if (groups.length === 2 && groups[0] === 3 && groups[1] === 1) return ['triple_with_one'];
  if (groups.length === 2 && groups[0] === 2 && groups[1] === 2) return ['two_pair'];
  if (isStraight(cards)) return ['straight4'];
  return [];
}

/** 五张：葫芦 / 同花顺 / 同花 / 五顺。同花顺同时命中三者。 */
function detectFive(cards: readonly PlayingCard[]): HandCategory[] {
  if (hasJoker(cards)) return [];
  const groups = rankCounts(cards);
  if (groups.length === 2 && groups[0] === 3 && groups[1] === 2) return ['full_house'];

  const flush = isFlush(cards);
  const straight = isStraight(cards);
  if (flush && straight) return ['straight_flush', 'flush', 'straight5'];
  if (flush) return ['flush'];
  if (straight) return ['straight5'];
  return [];
}

function hasJoker(cards: readonly PlayingCard[]): boolean {
  return cards.some((card) => card.joker !== undefined);
}

/** 按点数出现次数降序返回，如葫芦 → [3, 2]。 */
function rankCounts(cards: readonly PlayingCard[]): number[] {
  const counts = new Map<string, number>();
  for (const card of cards) {
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  }
  return [...counts.values()].sort((a, b) => b - a);
}

function isFlush(cards: readonly PlayingCard[]): boolean {
  const suit = cards[0]?.suit;
  if (!suit) return false;
  return cards.every((card) => card.suit === suit);
}

/**
 * 判断是否为连续顺子。
 * A 同时尝试高牌 14 与低牌 1，以覆盖 A-2-3-4-5 与 J-Q-K-A。
 */
function isStraight(cards: readonly PlayingCard[]): boolean {
  if (cards.length < 3 || hasJoker(cards)) return false;
  const highValues = cards.map((card) => STRAIGHT_VALUE[card.rank as CardRank]);
  if (isConsecutiveUnique(highValues)) return true;
  // 含 A 时再把 A 当作 1 试一次（轮转低顺）。
  if (!cards.some((card) => card.rank === 'A')) return false;
  const lowValues = cards.map((card) =>
    card.rank === 'A' ? 1 : STRAIGHT_VALUE[card.rank as CardRank],
  );
  return isConsecutiveUnique(lowValues);
}

/** 去重后排序，长度不变且相邻差均为 1 才算顺。 */
function isConsecutiveUnique(values: readonly number[]): boolean {
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.length !== values.length) return false;
  for (let index = 1; index < unique.length; index += 1) {
    if (unique[index]! - unique[index - 1]! !== 1) return false;
  }
  return true;
}
