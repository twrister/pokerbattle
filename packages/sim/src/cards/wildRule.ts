import { isWildCard, type CardRank, type PlayingCard } from './deck.js';
import { HAND_CATEGORY_STRENGTH_ORDER, type HandCategory } from '../config/handCategories.js';
import type { FormationMatchRule } from '../config/cardFormations.js';

/**
 * 万能牌（癞子）的解析式判定。
 *
 * 为什么不枚举「万能牌替身」再重复识别：一张万能牌就有 13 个点数可选，
 * 机器人每帧要扫上千种组合，实测 11 张手牌含 2 张万能牌时一次决策要 125ms，
 * 直接卡帧。这里把「万能牌能补成哪些牌型」「能否命中某条匹配规则」直接算出来，
 * 复杂度只跟手牌张数有关。结果与暴力枚举完全一致，
 * 由 wildCard.test.ts 里的暴力枚举做交叉校验。
 */

/** 牌型 → 位；顺序与 HAND_CATEGORY_STRENGTH_ORDER 一致。 */
const CATEGORY_BITS: Readonly<Record<HandCategory, number>> = Object.fromEntries(
  HAND_CATEGORY_STRENGTH_ORDER.map((category, index) => [category, 1 << index]),
) as Record<HandCategory, number>;

/** 点数牌力：A 默认按 14，顺子另试 1。 */
const RANK_VALUE: Readonly<Record<CardRank, number>> = {
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

/** 全部候选点数；万能牌可替成其中任意一个。 */
const ALL_RANKS: readonly CardRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** 点数由大到小；求「最强替代」时优先试高端，命中即可返回。 */
const RANKS_DESC: readonly CardRank[] = [...ALL_RANKS].sort((left, right) => RANK_VALUE[right] - RANK_VALUE[left]);

/** 顺子窗口内的数值反查点数；1 是 A 作低牌的解释，仍映射回 A。 */
const RANK_BY_VALUE: Readonly<Record<number, CardRank>> = {
  1: 'A',
  ...Object.fromEntries(ALL_RANKS.map((rank) => [RANK_VALUE[rank], rank])),
} as Record<number, CardRank>;

/** 各牌型的标准张数；与 totalCount 不一致时该牌型不成立。 */
const CATEGORY_CARD_COUNT: Readonly<Record<HandCategory, number>> = {
  single: 1,
  pair: 2,
  rocket: 2,
  triple: 3,
  straight3: 3,
  bomb: 4,
  two_pair: 4,
  straight4: 4,
  full_house: 5,
  straight5: 5,
  flush: 5,
  straight_flush: 5,
};

/** 万能牌 + 真牌的分解结果。 */
export interface WildSplit {
  /** 万能牌张数，恒大于 0。 */
  wildCount: number;
  /** 除万能牌外的真牌。 */
  concretes: PlayingCard[];
  /** 是否混入大小王：万能牌不能替代王牌，任何牌型与规则都不成立。 */
  hasJoker: boolean;
}

/** 拆出手牌里的万能牌与真牌；无万能牌返回 null。 */
export function splitWildCards(cards: readonly PlayingCard[]): WildSplit | null {
  let wildCount = 0;
  let hasJoker = false;
  const concretes: PlayingCard[] = [];
  for (const card of cards) {
    if (isWildCard(card)) wildCount += 1;
    else {
      if (card.joker !== undefined) hasJoker = true;
      concretes.push(card);
    }
  }
  return wildCount === 0 ? null : { wildCount, concretes, hasJoker };
}

/**
 * 含万能牌的牌型位掩码。
 * 全是万能牌、或混入大小王时返回 0：
 * 万能牌必须至少搭配一张真牌，且不能替代大小王。
 */
export function detectWildMask(split: WildSplit, totalCount: number): number {
  const { concretes, hasJoker } = split;
  // 单张万能牌不成牌型（规则上禁止单独打出）
  if (hasJoker || concretes.length === 0 || totalCount < 2 || totalCount > 5) return 0;

  let mask = 0;
  // 同点数类：对子/三条/炸弹，本质是让所有牌落到同一点数
  if (totalCount === 2 && sameRankTarget(split, 2)) mask |= CATEGORY_BITS.pair;
  if (totalCount === 3 && sameRankTarget(split, 3)) mask |= CATEGORY_BITS.triple;
  if (totalCount === 4 && sameRankTarget(split, 4)) mask |= CATEGORY_BITS.bomb;
  // 连对：两个相邻点数各凑两张
  if (totalCount === 4 && consecutivePairExists(split)) mask |= CATEGORY_BITS.two_pair;
  // 葫芦：三条 + 一对
  if (totalCount === 5 && tripleRanksOf(split, 5).length > 0) mask |= CATEGORY_BITS.full_house;

  const straight = totalCount >= 3 && straightAchievable(concretes, totalCount);
  if (straight) {
    if (totalCount === 3) mask |= CATEGORY_BITS.straight3;
    if (totalCount === 4) mask |= CATEGORY_BITS.straight4;
    if (totalCount === 5) mask |= CATEGORY_BITS.straight5;
  }
  // 同花：真牌同色即可，万能牌跟着同色补齐
  if (totalCount === 5 && isSameSuit(concretes)) {
    mask |= CATEGORY_BITS.flush;
    if (straight) mask |= CATEGORY_BITS.straight_flush;
  }
  return mask;
}

/**
 * 含万能牌时能否命中一条牌面匹配规则。
 * 语义与「枚举替身后逐条试匹配」一致，只是把枚举换成直接推导。
 */
export function wildCardsMatchRule(split: WildSplit, match: FormationMatchRule): boolean {
  const { wildCount, concretes, hasJoker } = split;
  // 万能牌不能替代大小王；没有真牌时也不算命中（禁止单出万能牌）
  if (hasJoker || concretes.length === 0) return false;

  const counts = rankCounts(concretes);
  switch (match.kind) {
    case 'any':
      return true;
    case 'numbers':
      // 万能牌可当任意数字，只要真牌都落在 2～10 即可
      return concretes.every(isNumberRank);
    case 'joker':
      return false;
    case 'ranks': {
      // 规则比对「去重后的点数集合」：真牌必须都在配置内，缺的点数由万能牌补
      for (const rank of counts.keys()) {
        if (!match.ranks.includes(rank)) return false;
      }
      const missing = match.ranks.filter((rank) => !counts.has(rank)).length;
      return missing <= wildCount;
    }
    case 'tripleRanks': {
      const tripleRanks = tripleRanksOf(split, concretes.length + wildCount);
      return tripleRanks.some((rank) => match.ranks.includes(rank));
    }
    case 'rankCount': {
      const wanted = new Set<CardRank>(match.ranks);
      const concreteWanted = concretes.filter((card) => wanted.has(card.rank as CardRank)).length;
      // 万能牌可以补进目标点数，也可以当别的点数；可达区间是 [c, c + 万能牌数]
      const low = concreteWanted;
      const high = concreteWanted + wildCount;
      if (match.min !== undefined && high < match.min) return false;
      if (match.max !== undefined && low > match.max) return false;
      return true;
    }
  }
}

/**
 * 含万能牌时该牌型下牌面最大的替身点数，长度等于万能牌张数。
 * 返回 null 表示该牌型无法成型，或该牌型没有点数含义（同花、王炸）。
 *
 * 用途：同一组真牌配万能牌可能补成不同点数（癞子 + K + Q 既能当 J-Q-K 也能当 Q-K-A），
 * 若按「任意替身都命中」列阵型，同一牌型会被拆成多条按钮。求出最强替身后，
 * 调用方只按这一种替身判定，按钮就只剩最强的一档。
 *
 * 与 wildCardsMatchRule 一样是解析式：Bot 每帧要扫上千个组合，不能退化成枚举替身。
 */
export function strongestWildRanks(split: WildSplit, category: HandCategory): CardRank[] | null {
  const { wildCount, concretes, hasJoker } = split;
  // 万能牌不能替代大小王，也必须至少搭配一张真牌
  if (hasJoker || concretes.length === 0) return null;
  const totalCount = concretes.length + wildCount;
  if (totalCount !== CATEGORY_CARD_COUNT[category]) return null;

  switch (category) {
    case 'single':
    case 'pair':
    case 'triple':
    case 'bomb':
      // 同点数类：替身必须跟真牌同点，没有选择余地
      return sameRankWildRanks(split);
    case 'two_pair':
      return bestConsecutivePairRanks(split);
    case 'straight3':
    case 'straight4':
    case 'straight5':
    case 'straight_flush':
      return bestStraightWildRanks(concretes, totalCount);
    case 'full_house':
      return bestFullHouseWildRanks(split);
    case 'flush':
    case 'rocket':
      // 无点数含义（同花只看花色、王炸不含万能牌），交回调用方按原牌面判定
      return null;
  }
}

/** 同点数类牌型的替身点数：真牌必须同点，其余由万能牌补齐。 */
function sameRankWildRanks(split: WildSplit): CardRank[] | null {
  const counts = rankCounts(split.concretes);
  if (counts.size !== 1) return null;
  const rank = [...counts.keys()][0]!;
  return repeatRank(rank, split.wildCount);
}

/** 顺子类牌型的替身点数：取窗顶最高的顺子，窗口内缺口由万能牌补齐。 */
function bestStraightWildRanks(concretes: readonly PlayingCard[], totalCount: number): CardRank[] | null {
  // 顺子要求点数互不相同，重复点数无论怎么替都成不了顺子
  if (new Set(concretes.map((card) => card.rank)).size !== concretes.length) return null;

  let best: { top: number; wilds: CardRank[] } | null = null;
  for (const values of straightValueVariants(concretes)) {
    const window = bestStraightWindow(values, totalCount);
    // 顺子比大小看最高张：窗顶更高的一侧更强
    if (!window || (best && window.top <= best.top)) continue;
    best = { top: window.top, wilds: window.missing.map((value) => RANK_BY_VALUE[value]!) };
  }
  return best ? best.wilds : null;
}

/** A 可作 14 或 1；无 A 时只有一套点数解释。 */
function straightValueVariants(cards: readonly PlayingCard[]): number[][] {
  const high = cards.map((card) => RANK_VALUE[card.rank as CardRank]);
  if (!cards.some((card) => card.rank === 'A')) return [high];
  return [high, cards.map((card) => (card.rank === 'A' ? 1 : RANK_VALUE[card.rank as CardRank]))];
}

/**
 * 在长度 totalCount 的连续窗口中找窗顶最高的合法解。
 * 真牌必须全部落进窗口；窗口内空位就是万能牌要补的点数。
 */
function bestStraightWindow(
  values: readonly number[],
  totalCount: number,
): { top: number; missing: number[] } | null {
  const min = Math.min(...values);
  const max = Math.max(...values);
  // 窗口长度固定，真牌跨度超出时任何窗口都装不下
  if (max - min > totalCount - 1) return null;
  // 起点越大越强，但不能越过真牌最小张，也不能让窗顶超过 A
  const start = Math.min(min, 14 - totalCount + 1);
  if (start < 1 || start + totalCount - 1 < max) return null;

  const present = new Set(values);
  const missing: number[] = [];
  for (let value = start; value < start + totalCount; value += 1) {
    if (!present.has(value)) missing.push(value);
  }
  return { top: start + totalCount - 1, missing };
}

/** 连对的替身点数：取较高一档的点数对，缺张由万能牌补齐。 */
function bestConsecutivePairRanks(split: WildSplit): CardRank[] | null {
  const { concretes, wildCount } = split;
  const counts = rankCounts(concretes);
  let best: { strength: number; wilds: CardRank[] } | null = null;

  for (const left of ALL_RANKS) {
    for (const right of ALL_RANKS) {
      if (left === right) continue;
      if (!areRanksConsecutive([left, right])) continue;
      if (!assignable(counts, wildCount, new Map([[left, 2], [right, 2]]))) continue;
      const strength = consecutivePairStrength(left, right);
      if (best && strength <= best.strength) continue;
      const wilds = [
        ...repeatRank(left, 2 - (counts.get(left) ?? 0)),
        ...repeatRank(right, 2 - (counts.get(right) ?? 0)),
      ];
      best = { strength, wilds };
    }
  }
  return best ? best.wilds : null;
}

/** 连对牌力：比较大的一对；A-2 里 A 作 1，强度就是 2。 */
function consecutivePairStrength(left: CardRank, right: CardRank): number {
  const high = [RANK_VALUE[left], RANK_VALUE[right]];
  if (Math.abs(high[0]! - high[1]!) === 1) return Math.max(...high);
  return Math.max(...high.map((value) => (value === 14 ? 1 : value)));
}

/** 葫芦的替身点数：取牌力最高的三条，对子点数不影响强弱，取最低可行档。 */
function bestFullHouseWildRanks(split: WildSplit): CardRank[] | null {
  const { concretes, wildCount } = split;
  const counts = rankCounts(concretes);
  const tripleRanks = tripleRanksOf(split, concretes.length + wildCount);

  for (const triple of RANKS_DESC) {
    if (!tripleRanks.includes(triple)) continue;
    for (const pair of ALL_RANKS) {
      if (pair === triple) continue;
      if (!assignable(counts, wildCount, new Map([[triple, 3], [pair, 2]]))) continue;
      return [
        ...repeatRank(triple, 3 - (counts.get(triple) ?? 0)),
        ...repeatRank(pair, 2 - (counts.get(pair) ?? 0)),
      ];
    }
  }
  return null;
}

/** 生成 count 张同点数占位，表示万能牌要替成的牌。 */
function repeatRank(rank: CardRank, count: number): CardRank[] {
  return count > 0 ? Array.from({ length: count }, () => rank) : [];
}

/** 是否存在某点数能让全部牌落成 size 张同点数。 */
function sameRankTarget(split: WildSplit, size: number): boolean {
  const { concretes, wildCount } = split;
  if (concretes.length === 0) return false;
  const counts = rankCounts(concretes);
  // 只能有一个点数，且真牌数不超过目标张数
  if (counts.size !== 1) return false;
  const have = [...counts.values()][0]!;
  return have <= size && size - have === wildCount;
}

/** 能否凑成两个相邻点数的连对（每个点数 2 张）。 */
function consecutivePairExists(split: WildSplit): boolean {
  const { concretes, wildCount } = split;
  const counts = rankCounts(concretes);
  for (const left of ALL_RANKS) {
    for (const right of ALL_RANKS) {
      if (left === right) continue;
      if (!areRanksConsecutive([left, right])) continue;
      if (assignable(counts, wildCount, new Map([[left, 2], [right, 2]]))) return true;
    }
  }
  return false;
}

/**
 * 万能牌能凑出的「三条」点数集合。
 * size=5 时按葫芦（三条 + 一对）严格校验；其余张数只要求「恰好 3 张同点数」，
 * 与 detectConcrete 的 tripleRankOf 语义保持一致。
 */
function tripleRanksOf(split: WildSplit, size: number): CardRank[] {
  const { concretes, wildCount } = split;
  if (concretes.length === 0) return [];
  const counts = rankCounts(concretes);

  if (size === 5) {
    // 葫芦必须是 3+2，缺一点都不算
    const result: CardRank[] = [];
    for (const triple of ALL_RANKS) {
      const hasPair = ALL_RANKS.some(
        (pair) => pair !== triple && assignable(counts, wildCount, new Map([[triple, 3], [pair, 2]])),
      );
      if (hasPair) result.push(triple);
    }
    return result;
  }

  const result: CardRank[] = [];
  for (const rank of ALL_RANKS) {
    const have = counts.get(rank) ?? 0;
    // 已经超过 3 张时无论怎么替都不可能「恰好 3 张」
    if (have > 3) continue;
    if (3 - have > wildCount) continue;
    // 其他点数不能已经恰好 3 张，否则最强的三条会被它抢走
    let conflict = false;
    for (const [other, count] of counts) {
      if (other !== rank && count === 3) {
        conflict = true;
        break;
      }
    }
    if (!conflict) result.push(rank);
  }
  return result;
}

/**
 * 判断真牌能否被「分配进目标点数配额」并由万能牌补齐。
 * 所有真牌都必须落在目标点数里，且缺口总数恰好等于万能牌张数。
 */
function assignable(
  counts: ReadonlyMap<CardRank, number>,
  wildCount: number,
  targets: ReadonlyMap<CardRank, number>,
): boolean {
  let deficit = 0;
  for (const [rank, need] of targets) {
    const have = counts.get(rank) ?? 0;
    if (have > need) return false;
    deficit += need - have;
  }
  let concreteTotal = 0;
  for (const [rank, have] of counts) {
    if (!targets.has(rank)) return false;
    concreteTotal += have;
  }
  return deficit === wildCount && concreteTotal + wildCount === [...targets.values()].reduce((sum, n) => sum + n, 0);
}

/** 真牌是否同色；万能牌可跟着补成同色。 */
function isSameSuit(cards: readonly PlayingCard[]): boolean {
  const suit = cards[0]?.suit;
  if (!suit) return false;
  return cards.every((card) => card.suit === suit);
}

/**
 * 真牌点数能否与万能牌一起补成 totalCount 张连续顺子。
 * 真牌点数必须互不相同，且整体落在长度为 totalCount 的连续窗口内。
 */
function straightAchievable(cards: readonly PlayingCard[], totalCount: number): boolean {
  if (cards.length === 0) return false;
  if (new Set(cards.map((card) => card.rank)).size !== cards.length) return false;

  const hasAce = cards.some((card) => card.rank === 'A');
  const variants = hasAce
    ? [
        cards.map((card) => RANK_VALUE[card.rank as CardRank]),
        cards.map((card) => (card.rank === 'A' ? 1 : RANK_VALUE[card.rank as CardRank])),
      ]
    : [cards.map((card) => RANK_VALUE[card.rank as CardRank])];

  for (const values of variants) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    // 窗口内的空位由万能牌补齐
    if (max - min <= totalCount - 1) return true;
  }
  return false;
}

/** 两个点数是否相邻；A 可作 1（A-2）或 14（K-A）。 */
function areRanksConsecutive(ranks: readonly [CardRank, CardRank] | readonly CardRank[]): boolean {
  if (ranks.length !== 2) return false;
  const [left, right] = ranks as [CardRank, CardRank];
  const high = [RANK_VALUE[left], RANK_VALUE[right]];
  if (Math.abs(high[0]! - high[1]!) === 1) return true;
  if (left !== 'A' && right !== 'A') return false;
  const low = high.map((value) => (value === 14 ? 1 : value));
  return Math.abs(low[0]! - low[1]!) === 1;
}

/** 点数出现次数统计。 */
function rankCounts(cards: readonly PlayingCard[]): Map<CardRank, number> {
  const counts = new Map<CardRank, number>();
  for (const card of cards) {
    const rank = card.rank as CardRank;
    counts.set(rank, (counts.get(rank) ?? 0) + 1);
  }
  return counts;
}

/** 数字牌 2～10。 */
function isNumberRank(card: PlayingCard): boolean {
  return ['2', '3', '4', '5', '6', '7', '8', '9', '10'].includes(card.rank);
}
