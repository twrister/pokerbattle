import {
  CARD_FORMATIONS,
  matchRuleKey,
  type FormationMatchRule,
} from '../config/cardFormations.js';
import { HAND_CATEGORY_STRENGTH_ORDER, type HandCategory } from '../config/handCategories.js';
import { cardsMatchConcreteRule } from '../config/cardMapping.js';
import { compareCardsByStrength, isWildCard, type CardRank, type PlayingCard } from './deck.js';
import {
  categoriesFromMask,
  detectConcreteMask,
} from './handCategoryDetect.js';
import {
  detectWildMask,
  splitWildCards,
  strongestWildRanks,
  wildCardsMatchRule,
} from './wildRule.js';

export { detectConcreteCategories } from './handCategoryDetect.js';

/** 推荐列表中的一档：主牌型 + 映射情况 + 该档最小牌面。 */
export interface RecommendHand {
  category: HandCategory;
  matchKey: string;
  cards: PlayingCard[];
}

/**
 * 识别一组选中牌命中的全部牌型，按强度降序；不合法组合返回空数组。
 * 含万能牌时按解析式推导牌型，与暴力枚举替代方案的结果一致。
 */
export function detectHandCategories(cards: readonly PlayingCard[]): HandCategory[] {
  const count = cards.length;
  if (count < 1 || count > 5) return [];
  return categoriesFromMask(detectMask(cards));
}

/** 组合的牌型位掩码；万能牌走解析式判定，避免逐替身重复识别。 */
function detectMask(cards: readonly PlayingCard[]): number {
  const split = splitWildCards(cards);
  if (!split) return detectConcreteMask(cards);
  return detectWildMask(split, cards.length);
}

/** 一张万能牌被当作的牌面。 */
export interface WildSubstitutionCard {
  /** 万能牌自身 id，便于 UI 定位到具体那张牌。 */
  cardId: string;
  /** 被当作的点数；同花这类无点数含义的牌型为 null。 */
  rank: CardRank | null;
  /** 点数的短标签，与 rank 一致；rank 为 null 时为空串，由 UI 换成「同花色」。 */
  label: string;
}

/** 万能牌替身说明：命中牌型 + 每张万能牌被当作什么。 */
export interface WildSubstitutionInfo {
  /** 命中的最强牌型；万能牌无法成型时不会返回本结构。 */
  category: HandCategory;
  /** 按选中顺序列出全部万能牌；同花等无点数含义的牌型 rank 为 null。 */
  wilds: WildSubstitutionCard[];
}

/**
 * 描述含万能牌的组合实际打成了什么牌型、万能牌各自当作什么点数。
 *
 * 替身点数直接复用 strongestWildRanks，与 getFormationsFor 判定阵型时用的是同一档，
 * 所以提示里写的点数就是兵种按钮实际生效的点数，不会出现「提示 Q-K-A、按钮却是 J-Q-K」。
 *
 * 返回 null 的情形：不含万能牌、万能牌没能凑成牌型（含单独选万能牌、混入大小王）。
 * 这类「为什么不成型」的判断留给调用方，避免 UI 还要复述规则细节。
 */
export function describeWildSubstitution(
  cards: readonly PlayingCard[],
): WildSubstitutionInfo | null {
  const count = cards.length;
  if (count < 1 || count > 5) return null;
  const split = splitWildCards(cards);
  if (!split) return null;

  const category = strongestCategory(detectWildMask(split, count));
  if (!category) return null;

  // 同花只看花色，替身点数没有意义；其余牌型按最强替身逐张对应
  const ranks = strongestWildRanks(split, category);
  const wilds: WildSubstitutionCard[] = cards
    .filter((card) => isWildCard(card))
    .map((card) => {
      const rank = ranks?.shift() ?? null;
      // 点数标签直接给 UI 用；无点数含义时留空，由调用方按牌型换成「同花色」
      return { cardId: card.id, rank, label: rank ?? '' };
    });
  return { category, wilds };
}

/** 掩码里最强的一档；没有牌型返回 undefined。 */
function strongestCategory(mask: number): HandCategory | undefined {
  return categoriesFromMask(mask)[0];
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
      const top = strongestCategory(detectMask(combo));
      if (!top) return;
      const rank = categoryRankOf(top);
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
      const top = strongestCategory(detectMask(combo));
      if (!top) return;
      // 先取同档已存的更弱一组，命中后就不必再试匹配规则
      const rules = listUniqueMatchRules(top);
      for (const match of rules) {
        const matchKey = matchRuleKey(match);
        const slotKey = `${top}:${matchKey}`;
        const previous = bestBySlot.get(slotKey);
        // 同档保留更弱一组，把大牌留给后续出牌。
        if (previous && compareCombosByStrength(combo, previous.cards) <= 0) continue;
        if (!matchesAnySubstitution(combo, match)) continue;
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

/**
 * 枚举手牌全部 1～5 张组合，汇总「至少出现过一次」的牌型。
 * 同花顺会同时计入同花/五顺，与 detectHandCategories 一致；供概率统计使用。
 */
export function listPresentCategories(cards: readonly PlayingCard[]): HandCategory[] {
  if (cards.length === 0) return [];

  let mask = 0;
  const maxSize = Math.min(5, cards.length);
  for (let size = 1; size <= maxSize; size += 1) {
    forEachCombination(cards, size, (combo) => {
      mask |= detectMask(combo);
    });
  }
  return HAND_CATEGORY_STRENGTH_ORDER.filter((category) => categoriesFromMask(mask).includes(category));
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

/** 含万能牌时按解析式试匹配；无万能牌只跑一次，保持原性能。 */
function matchesAnySubstitution(cards: readonly PlayingCard[], match: FormationMatchRule): boolean {
  const split = splitWildCards(cards);
  if (!split) return cardsMatchConcreteRule(cards, match);
  return wildCardsMatchRule(split, match);
}

/** 牌型强度序号，越小越强。 */
function categoryRankOf(category: HandCategory): number {
  const index = HAND_CATEGORY_STRENGTH_ORDER.indexOf(category);
  return index < 0 ? 99 : index;
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
