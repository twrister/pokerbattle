import {
  HAND_CATEGORY_STRENGTH_ORDER,
  type HandCategory,
} from '../config/cardFormations.js';
import { Rng } from '../math/rng.js';
import { createPokerCards, type PlayingCard } from './deck.js';
import { listPresentCategories } from './handCategory.js';

/** 工具允许的手牌张数范围（可高于局内 MAX_HAND_SIZE，仅作策划参考）。 */
export const HAND_ODDS_MIN_SIZE = 5;
export const HAND_ODDS_MAX_SIZE = 12;
export const HAND_ODDS_DEFAULT_TRIALS = 5000;

export interface HandCategoryOddsOptions {
  handSize: number;
  trials?: number;
  /** 可注入以固定种子；默认新建 Rng。 */
  rng?: Rng;
  /** 牌库；默认完整 54 张。 */
  deck?: readonly PlayingCard[];
}

export interface HandCategoryOddsResult {
  handSize: number;
  trials: number;
  /** 各牌型「手牌中至少可打出一次」的频率，范围 [0, 1]。 */
  probabilities: Readonly<Record<HandCategory, number>>;
}

export interface HandCategoryOddsSweepResult {
  trials: number;
  handSizes: readonly number[];
  /** 按 handSizes 顺序，每档一张数的概率表。 */
  byHandSize: readonly HandCategoryOddsResult[];
}

/** 校验手牌张数是否在工具支持范围内。 */
export function isValidHandOddsSize(handSize: number): boolean {
  return (
    Number.isInteger(handSize) &&
    handSize >= HAND_ODDS_MIN_SIZE &&
    handSize <= HAND_ODDS_MAX_SIZE
  );
}

/**
 * 蒙特卡洛：反复从牌库抽 handSize 张，统计各牌型可打出频率。
 * 同步跑完；UI 侧应分片调用 estimateHandCategoryOddsChunk 以免卡死。
 */
export function estimateHandCategoryOdds(options: HandCategoryOddsOptions): HandCategoryOddsResult {
  const handSize = options.handSize;
  if (!isValidHandOddsSize(handSize)) {
    throw new Error(`handSize 须为 ${HAND_ODDS_MIN_SIZE}～${HAND_ODDS_MAX_SIZE} 的整数`);
  }
  const trials = options.trials ?? HAND_ODDS_DEFAULT_TRIALS;
  if (!Number.isInteger(trials) || trials <= 0) {
    throw new Error('trials 须为正整数');
  }

  const deck = options.deck ?? createPokerCards();
  if (deck.length < handSize) {
    throw new Error(`牌库仅 ${deck.length} 张，无法抽 ${handSize} 张`);
  }

  const rng = options.rng ?? new Rng(1);
  const hits = createHitCounters();
  const pool = deck.slice();

  for (let trial = 0; trial < trials; trial += 1) {
    const hand = sampleHand(pool, handSize, rng);
    for (const category of listPresentCategories(hand)) {
      hits[category] += 1;
    }
  }

  return {
    handSize,
    trials,
    probabilities: toProbabilities(hits, trials),
  };
}

/**
 * 跑一段 trials，累加到外部 counters；供 UI 分片推进。
 * 返回本次实际完成的次数。
 */
export function runHandCategoryOddsChunk(params: {
  handSize: number;
  trials: number;
  hits: Record<HandCategory, number>;
  rng: Rng;
  deck?: readonly PlayingCard[];
}): number {
  const { handSize, trials, hits, rng } = params;
  if (!isValidHandOddsSize(handSize) || trials <= 0) return 0;
  const deck = params.deck ?? createPokerCards();
  const pool = deck.slice();
  for (let trial = 0; trial < trials; trial += 1) {
    const hand = sampleHand(pool, handSize, rng);
    for (const category of listPresentCategories(hand)) {
      hits[category] += 1;
    }
  }
  return trials;
}

/** 对 5～12 张各跑一遍蒙特卡洛，供折线对比。 */
export function estimateHandCategoryOddsSweep(options: {
  trials?: number;
  rng?: Rng;
  deck?: readonly PlayingCard[];
  minSize?: number;
  maxSize?: number;
}): HandCategoryOddsSweepResult {
  const minSize = options.minSize ?? HAND_ODDS_MIN_SIZE;
  const maxSize = options.maxSize ?? HAND_ODDS_MAX_SIZE;
  const trials = options.trials ?? HAND_ODDS_DEFAULT_TRIALS;
  const rng = options.rng ?? new Rng(1);
  const deck = options.deck ?? createPokerCards();
  const handSizes: number[] = [];
  const byHandSize: HandCategoryOddsResult[] = [];
  for (let handSize = minSize; handSize <= maxSize; handSize += 1) {
    handSizes.push(handSize);
    byHandSize.push(estimateHandCategoryOdds({ handSize, trials, rng, deck }));
  }
  return { trials, handSizes, byHandSize };
}

/** 创建全零命中计数表。 */
export function createHitCounters(): Record<HandCategory, number> {
  const hits = {} as Record<HandCategory, number>;
  for (const category of HAND_CATEGORY_STRENGTH_ORDER) {
    hits[category] = 0;
  }
  return hits;
}

/** 命中次数转概率。 */
export function toProbabilities(
  hits: Readonly<Record<HandCategory, number>>,
  trials: number,
): Record<HandCategory, number> {
  const probabilities = {} as Record<HandCategory, number>;
  const denom = trials > 0 ? trials : 1;
  for (const category of HAND_CATEGORY_STRENGTH_ORDER) {
    probabilities[category] = (hits[category] ?? 0) / denom;
  }
  return probabilities;
}

/**
 * Fisher–Yates 局部打乱前 handSize 张后取样。
 * 复用 pool 缓冲，避免每 trial 复制整副牌。
 */
function sampleHand(pool: PlayingCard[], handSize: number, rng: Rng): PlayingCard[] {
  for (let index = 0; index < handSize; index += 1) {
    const swapWith = index + rng.nextInt(pool.length - index);
    const tmp = pool[index]!;
    pool[index] = pool[swapWith]!;
    pool[swapWith] = tmp;
  }
  return pool.slice(0, handSize);
}
