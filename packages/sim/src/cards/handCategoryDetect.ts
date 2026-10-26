import { isWildCard, type CardRank, type PlayingCard } from './deck.js';
import { HAND_CATEGORY_STRENGTH_ORDER, type HandCategory } from '../config/handCategories.js';

/**
 * 具体牌面（无万能牌）的牌型识别。
 *
 * 单独成文件是为了打断循环依赖：牌型常量在 handCategories.ts，
 * 阵型配置与牌面匹配都只依赖它，识别逻辑本身不再反向依赖阵型表。
 *
 * 内部用位掩码而不是数组：牌型判定是热路径（Bot 每帧扫上千组合），
 * 每步都分配 Set/数组会明显拉高单帧耗时。
 */

/** 牌型 → 位；顺序与 HAND_CATEGORY_STRENGTH_ORDER 一致，便于按强度输出。 */
const CATEGORY_BITS: Readonly<Record<HandCategory, number>> = Object.fromEntries(
  HAND_CATEGORY_STRENGTH_ORDER.map((category, index) => [category, 1 << index]),
) as Record<HandCategory, number>;

/**
 * 顺子专用点数表：A 同时可作 1 与 14，由 isStraight 分别尝试。
 * 与手牌排序牌力一致（2 最小），但顺子不走大小王。
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

/** 位掩码转按强度降序的牌型数组；同一位只出一次。 */
export function categoriesFromMask(mask: number): HandCategory[] {
  if (mask === 0) return [];
  const result: HandCategory[] = [];
  for (const category of HAND_CATEGORY_STRENGTH_ORDER) {
    if (mask & CATEGORY_BITS[category]) result.push(category);
  }
  return result;
}

/** 按强度降序排列牌型并去重。 */
export function sortCategoriesByStrength(categories: Iterable<HandCategory>): HandCategory[] {
  let mask = 0;
  for (const category of categories) mask |= CATEGORY_BITS[category];
  return categoriesFromMask(mask);
}

/** 牌型强度序号；越小越强，未知牌型排最后。 */
export function categoryStrengthOf(category: HandCategory): number {
  return HAND_CATEGORY_STRENGTH_ORDER.indexOf(category);
}

/**
 * 识别一组「已替换完万能牌」的牌命中的全部牌型，按强度降序。
 * 入参含万能牌时直接返回空数组：调用方必须先做替代枚举。
 */
export function detectConcreteCategories(cards: readonly PlayingCard[]): HandCategory[] {
  return categoriesFromMask(detectConcreteMask(cards));
}

/**
 * 识别具体牌面并返回位掩码；含万能牌时返回 0，交由调用方先做替代枚举。
 * 这是热路径入口：不分配数组，只做点数比较。
 */
export function detectConcreteMask(cards: readonly PlayingCard[]): number {
  const count = cards.length;
  if (count < 1 || count > 5) return 0;

  for (const card of cards) {
    if (isWildCard(card)) return 0;
  }

  switch (count) {
    case 1:
      return CATEGORY_BITS.single;
    case 2:
      return detectTwo(cards);
    case 3:
      return detectThree(cards);
    case 4:
      return detectFour(cards);
    case 5:
      return detectFive(cards);
    default:
      return 0;
  }
}

/** 两张：对子；大小王额外命中王炸。 */
function detectTwo(cards: readonly PlayingCard[]): number {
  const a = cards[0]!;
  const b = cards[1]!;
  if (a.joker && b.joker && a.joker !== b.joker) return CATEGORY_BITS.rocket | CATEGORY_BITS.pair;
  if (!a.joker && !b.joker && a.rank === b.rank) return CATEGORY_BITS.pair;
  return 0;
}

/** 三张：三条或三顺。 */
function detectThree(cards: readonly PlayingCard[]): number {
  if (hasJoker(cards)) return 0;
  if (cards[0]!.rank === cards[1]!.rank && cards[1]!.rank === cards[2]!.rank) return CATEGORY_BITS.triple;
  if (isStraight(cards)) return CATEGORY_BITS.straight3;
  return 0;
}

/** 四张：炸弹 / 连对（相邻点数的两对） / 四顺。 */
function detectFour(cards: readonly PlayingCard[]): number {
  if (hasJoker(cards)) return 0;
  const groups = rankCounts(cards);
  if (groups[0] === 4) return CATEGORY_BITS.bomb;
  if (groups.length === 2 && groups[0] === 2 && groups[1] === 2 && isConsecutivePairRanks(cards)) {
    return CATEGORY_BITS.two_pair;
  }
  if (isStraight(cards)) return CATEGORY_BITS.straight4;
  return 0;
}

/** 五张：葫芦 / 同花顺 / 同花 / 五顺。同花顺同时命中三者。 */
function detectFive(cards: readonly PlayingCard[]): number {
  if (hasJoker(cards)) return 0;
  const groups = rankCounts(cards);
  if (groups.length === 2 && groups[0] === 3 && groups[1] === 2) return CATEGORY_BITS.full_house;

  const flush = isFlush(cards);
  const straight = isStraight(cards);
  if (flush && straight) {
    return CATEGORY_BITS.straight_flush | CATEGORY_BITS.flush | CATEGORY_BITS.straight5;
  }
  if (flush) return CATEGORY_BITS.flush;
  if (straight) return CATEGORY_BITS.straight5;
  return 0;
}

function hasJoker(cards: readonly PlayingCard[]): boolean {
  for (const card of cards) {
    if (card.joker !== undefined) return true;
  }
  return false;
}

/** 按点数出现次数降序返回，如葫芦 → [3, 2]。最多 5 张，用定长数组避免 Map 分配。 */
function rankCounts(cards: readonly PlayingCard[]): number[] {
  const ranks: string[] = [];
  const counts: number[] = [];
  for (const card of cards) {
    const index = ranks.indexOf(card.rank);
    if (index >= 0) counts[index]! += 1;
    else {
      ranks.push(card.rank);
      counts.push(1);
    }
  }
  return counts.sort((a, b) => b - a);
}

function isFlush(cards: readonly PlayingCard[]): boolean {
  const suit = cards[0]?.suit;
  if (!suit) return false;
  for (const card of cards) {
    if (card.suit !== suit) return false;
  }
  return true;
}

/**
 * 判断是否为连续顺子。
 * A 同时尝试高牌 14 与低牌 1，以覆盖 A-2-3-4-5 与 J-Q-K-A。
 */
function isStraight(cards: readonly PlayingCard[]): boolean {
  if (cards.length < 3 || hasJoker(cards)) return false;
  const highValues: number[] = [];
  let hasAce = false;
  for (const card of cards) {
    const rank = card.rank as CardRank;
    highValues.push(STRAIGHT_VALUE[rank]);
    if (rank === 'A') hasAce = true;
  }
  if (isConsecutiveUnique(highValues)) return true;
  if (!hasAce) return false;
  return isConsecutiveUnique(highValues.map((value) => (value === 14 ? 1 : value)));
}

/** 两对点数是否相邻（如 3-3-4-4）；A 同顺子规则可作 1 或 14。 */
function isConsecutivePairRanks(cards: readonly PlayingCard[]): boolean {
  const first = cards[0]!.rank as CardRank;
  let second: CardRank | null = null;
  for (const card of cards) {
    if (card.rank !== first) {
      second = card.rank as CardRank;
      break;
    }
  }
  if (!second) return false;
  const high = [STRAIGHT_VALUE[first], STRAIGHT_VALUE[second]];
  if (isConsecutiveUnique(high)) return true;
  if (first !== 'A' && second !== 'A') return false;
  return isConsecutiveUnique(high.map((value) => (value === 14 ? 1 : value)));
}

/** 去重后排序，长度不变且相邻差均为 1 才算顺。最多 5 个值，直接插入排序更省。 */
function isConsecutiveUnique(values: readonly number[]): boolean {
  const sorted = [...values].sort((a, b) => a - b);
  for (let index = 1; index < sorted.length; index += 1) {
    const diff = sorted[index]! - sorted[index - 1]!;
    if (diff === 0) return false;
    if (diff !== 1) return false;
  }
  return sorted.length === values.length;
}
