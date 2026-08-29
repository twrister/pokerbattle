import {
  CARD_FORMATIONS,
  HAND_CATEGORY_STRENGTH_ORDER,
  matchRuleKey,
  type FormationMatchRule,
  type HandCategory,
} from '../config/cardFormations.js';
import { cardsMatchRule } from '../config/cardMapping.js';
import { compareCardsByStrength, type CardRank, type PlayingCard } from './deck.js';

/** 推荐列表中的一档：主牌型 + 映射情况 + 该档最小牌面。 */
export interface RecommendHand {
  category: HandCategory;
  matchKey: string;
  cards: PlayingCard[];
}

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

/** 强度序号：越小越强，与 HAND_CATEGORY_STRENGTH_ORDER 一致。 */
const CATEGORY_RANK = new Map(
  HAND_CATEGORY_STRENGTH_ORDER.map((category, index) => [category, index]),
);

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
  return [...hits].sort((left, right) => (CATEGORY_RANK.get(left) ?? 99) - (CATEGORY_RANK.get(right) ?? 99));
}

/**
 * 在整副手牌中枚举 1～5 张合法组合，返回牌型最强的一组。
 * 同牌型时按牌力从高到低逐张比较；空手牌返回空数组。
 */
export function findStrongestHand(cards: readonly PlayingCard[]): PlayingCard[] {
  if (cards.length === 0) return [];

  let bestCards: PlayingCard[] = [];
  let bestCategoryRank = Number.POSITIVE_INFINITY;

  const maxSize = Math.min(5, cards.length);
  for (let size = 1; size <= maxSize; size += 1) {
    forEachCombination(cards, size, (combo) => {
      const top = detectHandCategories(combo)[0];
      if (!top) return;
      const rank = CATEGORY_RANK.get(top) ?? 99;
      if (rank > bestCategoryRank) return;
      if (rank < bestCategoryRank || compareCombosByStrength(combo, bestCards) < 0) {
        bestCategoryRank = rank;
        bestCards = combo.slice();
      }
    });
  }
  return bestCards;
}

/**
 * 枚举当前手牌可凑出的全部推荐档：主牌型 × 映射情况各一条，每档取最小牌面。
 * 同花顺只记主牌型，避免同一组牌再占同花/五顺；空手牌返回空数组。
 */
export function listRecommendHands(cards: readonly PlayingCard[]): RecommendHand[] {
  if (cards.length === 0) return [];

  const bestBySlot = new Map<string, RecommendHand>();
  const maxSize = Math.min(5, cards.length);
  for (let size = 1; size <= maxSize; size += 1) {
    forEachCombination(cards, size, (combo) => {
      const top = detectHandCategories(combo)[0];
      if (!top) return;
      for (const match of listUniqueMatchRules(top)) {
        if (!cardsMatchRule(combo, match)) continue;
        const matchKey = matchRuleKey(match);
        const slotKey = `${top}:${matchKey}`;
        const previous = bestBySlot.get(slotKey);
        // 同档保留更弱一组，把大牌留给后续出牌。
        if (previous && compareCombosByStrength(combo, previous.cards) <= 0) continue;
        bestBySlot.set(slotKey, { category: top, matchKey, cards: combo.slice() });
      }
    });
  }

  const result: RecommendHand[] = [];
  for (const category of HAND_CATEGORY_STRENGTH_ORDER) {
    for (const match of listUniqueMatchRules(category)) {
      const entry = bestBySlot.get(`${category}:${matchRuleKey(match)}`);
      if (entry) result.push(entry);
    }
  }
  return result;
}

/** 该牌型阵型配置里按首次出现顺序去重后的映射情况。 */
function listUniqueMatchRules(category: HandCategory): FormationMatchRule[] {
  const seen = new Set<string>();
  const rules: FormationMatchRule[] = [];
  for (const formation of CARD_FORMATIONS[category]) {
    const key = matchRuleKey(formation.match);
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(formation.match);
  }
  return rules;
}

/**
 * 枚举手牌全部 1～5 张组合，汇总「至少出现过一次」的牌型。
 * 同花顺会同时计入同花/五顺，与 detectHandCategories 一致；供概率统计使用。
 */
export function listPresentCategories(cards: readonly PlayingCard[]): HandCategory[] {
  if (cards.length === 0) return [];

  const present = new Set<HandCategory>();
  const maxSize = Math.min(5, cards.length);
  for (let size = 1; size <= maxSize; size += 1) {
    forEachCombination(cards, size, (combo) => {
      for (const category of detectHandCategories(combo)) {
        present.add(category);
      }
    });
  }

  return HAND_CATEGORY_STRENGTH_ORDER.filter((category) => present.has(category));
}

/** 按牌力降序逐张比较两组牌；先出现更强牌的一侧更强。 */
function compareCombosByStrength(left: readonly PlayingCard[], right: readonly PlayingCard[]): number {
  const a = [...left].sort(compareCardsByStrength);
  const b = [...right].sort(compareCardsByStrength);
  const len = Math.max(a.length, b.length);
  for (let index = 0; index < len; index += 1) {
    const cardA = a[index];
    const cardB = b[index];
    if (!cardA) return 1;
    if (!cardB) return -1;
    const diff = compareCardsByStrength(cardA, cardB);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 枚举 cards 中恰好取 size 张的全部组合（顺序与原数组一致）。 */
function forEachCombination(
  cards: readonly PlayingCard[],
  size: number,
  visit: (combo: PlayingCard[]) => void,
): void {
  const combo: PlayingCard[] = [];
  const walk = (start: number): void => {
    if (combo.length === size) {
      visit(combo);
      return;
    }
    const remaining = size - combo.length;
    for (let index = start; index <= cards.length - remaining; index += 1) {
      combo.push(cards[index]!);
      walk(index + 1);
      combo.pop();
    }
  };
  walk(0);
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

/** 四张：炸弹 / 连对（相邻点数的两对） / 四顺。 */
function detectFour(cards: readonly PlayingCard[]): HandCategory[] {
  if (hasJoker(cards)) return [];
  const groups = rankCounts(cards);
  if (groups.length === 1 && groups[0] === 4) return ['bomb'];
  if (groups.length === 2 && groups[0] === 2 && groups[1] === 2 && isConsecutivePairRanks(cards)) {
    return ['two_pair'];
  }
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
  if (!cards.some((card) => card.rank === 'A')) return false;
  const lowValues = cards.map((card) =>
    card.rank === 'A' ? 1 : STRAIGHT_VALUE[card.rank as CardRank],
  );
  return isConsecutiveUnique(lowValues);
}

/** 两对点数是否相邻（如 3-3-4-4）；A 同顺子规则可作 1 或 14。 */
function isConsecutivePairRanks(cards: readonly PlayingCard[]): boolean {
  const ranks = [...new Set(cards.map((card) => card.rank))];
  if (ranks.length !== 2) return false;
  const highValues = ranks.map((rank) => STRAIGHT_VALUE[rank as CardRank]);
  if (isConsecutiveUnique(highValues)) return true;
  if (!ranks.includes('A')) return false;
  const lowValues = ranks.map((rank) => (rank === 'A' ? 1 : STRAIGHT_VALUE[rank as CardRank]));
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
