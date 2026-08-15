import {
  HAND_CATEGORY_NAMES,
  HAND_CATEGORY_STRENGTH_ORDER,
  type HandCategory,
} from '../config/cardFormations.js';
import { formatRankTier, type Entry } from './entries.js';

/** 一场已折算到 A 视角的成对比分。 */
export interface PairObservation {
  aKey: string;
  bKey: string;
  scoreA: number;
  hpFracA: number;
  hpFracB: number;
}

/** 混战观察：队伍分 = 成员分之和。 */
export interface TeamObservation {
  teamA: readonly string[];
  teamB: readonly string[];
  scoreA: number;
}

export interface EntryRating {
  key: string;
  raw: number;
  score: number;
}

export interface PairAggregate {
  aKey: string;
  bKey: string;
  games: number;
  meanScore: number;
  winRate: number;
  meanHpFracA: number;
  meanHpFracB: number;
}

export interface MonotonicityViolation {
  kind: 'rank' | 'category';
  /** 稳定键，用于跨模式求交，如 rank:2>3 或 category:two_pair>straight4。 */
  pairKey: string;
  lowerId: string;
  higherId: string;
  lowerLabel: string;
  higherLabel: string;
  lowerScore: number;
  higherScore: number;
  message: string;
}

/** 同一相邻阶梯在独立与混战都倒挂时的对照。 */
export interface SharedViolation {
  kind: 'rank' | 'category';
  pairKey: string;
  lowerLabel: string;
  higherLabel: string;
  solo: MonotonicityViolation;
  melee: MonotonicityViolation;
}

/** 两种模式都跑过时，取出同一对相邻阶梯的双侧违例。 */
export function intersectViolations(
  solo: readonly MonotonicityViolation[],
  melee: readonly MonotonicityViolation[],
): SharedViolation[] {
  const meleeByKey = new Map(melee.map((row) => [row.pairKey, row]));
  const shared: SharedViolation[] = [];
  for (const row of solo) {
    const other = meleeByKey.get(row.pairKey);
    if (!other) continue;
    shared.push({
      kind: row.kind,
      pairKey: row.pairKey,
      lowerLabel: row.lowerLabel,
      higherLabel: row.higherLabel,
      solo: row,
      melee: other,
    });
  }
  return shared;
}

const SIGMOID_SCALE = 1;
const FIT_ITERS = 800;
const FIT_LR = 0.08;

/** 把多场 1v1 收成对局均值，供矩阵与拟合共用。 */
export function aggregatePairs(obs: readonly PairObservation[]): PairAggregate[] {
  const buckets = new Map<string, PairAggregate>();
  for (const row of obs) {
    const id = `${row.aKey}\t${row.bKey}`;
    const existing = buckets.get(id);
    if (!existing) {
      buckets.set(id, {
        aKey: row.aKey,
        bKey: row.bKey,
        games: 1,
        meanScore: row.scoreA,
        winRate: row.scoreA > 0.5 ? 1 : 0,
        meanHpFracA: row.hpFracA,
        meanHpFracB: row.hpFracB,
      });
      continue;
    }
    existing.games += 1;
    existing.meanScore += row.scoreA;
    existing.winRate += row.scoreA > 0.5 ? 1 : 0;
    existing.meanHpFracA += row.hpFracA;
    existing.meanHpFracB += row.hpFracB;
  }
  return [...buckets.values()].map((row) => ({
    ...row,
    meanScore: row.meanScore / row.games,
    winRate: row.winRate / row.games,
    meanHpFracA: row.meanHpFracA / row.games,
    meanHpFracB: row.meanHpFracB / row.games,
  }));
}

/** 独立对比：P(A 胜) = sigmoid(rA - rB)，拟合后线性映射到 0–100。 */
export function fitSoloRatings(
  entries: readonly Entry[],
  pairs: readonly PairAggregate[],
): Map<string, EntryRating> {
  return fitRatings(
    entries.map((entry) => entry.key),
    pairs.map((pair) => ({
      plus: [pair.aKey],
      minus: [pair.bKey],
      score: pair.meanScore,
    })),
  );
}

/** 混战：队伍分相加，拟合出的 r 是该条目在组合环境中的边际贡献。 */
export function fitMeleeRatings(
  entries: readonly Entry[],
  rounds: readonly TeamObservation[],
): Map<string, EntryRating> {
  return fitRatings(
    entries.map((entry) => entry.key),
    rounds.map((round) => ({
      plus: [...round.teamA],
      minus: [...round.teamB],
      score: round.scoreA,
    })),
  );
}

interface RatingSample {
  plus: readonly string[];
  minus: readonly string[];
  score: number;
}

/**
 * Bradley-Terry 梯度下降。孤立条目（从未出场）保持 50 分，避免被 min-max 拉飞。
 */
function fitRatings(keys: readonly string[], samples: readonly RatingSample[]): Map<string, EntryRating> {
  const index = new Map<string, number>();
  keys.forEach((key, i) => index.set(key, i));
  const raw = new Float64Array(keys.length);
  const seen = new Uint8Array(keys.length);
  for (const sample of samples) {
    for (const key of sample.plus) {
      const i = index.get(key);
      if (i !== undefined) seen[i] = 1;
    }
    for (const key of sample.minus) {
      const i = index.get(key);
      if (i !== undefined) seen[i] = 1;
    }
  }

  for (let iter = 0; iter < FIT_ITERS; iter++) {
    for (const sample of samples) {
      let delta = 0;
      for (const key of sample.plus) {
        const i = index.get(key);
        if (i !== undefined) delta += raw[i]!;
      }
      for (const key of sample.minus) {
        const i = index.get(key);
        if (i !== undefined) delta -= raw[i]!;
      }
      const predicted = sigmoid(delta * SIGMOID_SCALE);
      const error = predicted - sample.score;
      const step = FIT_LR * error;
      for (const key of sample.plus) {
        const i = index.get(key);
        if (i !== undefined) raw[i]! -= step;
      }
      for (const key of sample.minus) {
        const i = index.get(key);
        if (i !== undefined) raw[i]! += step;
      }
    }
  }

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < raw.length; i++) {
    if (!seen[i]) continue;
    const value = raw[i]!;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = max - min;
  const out = new Map<string, EntryRating>();
  keys.forEach((key, i) => {
    const value = raw[i]!;
    const score = !seen[i] ? 50 : span < 1e-9 ? 50 : ((value - min) / span) * 100;
    out.set(key, { key, raw: value, score });
  });
  return out;
}

function sigmoid(x: number): number {
  if (x > 20) return 1;
  if (x < -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

/** 牌位阶梯（single）与牌型阶梯的单调性校验，只报告不改数据。 */
export function checkMonotonicity(
  entries: readonly Entry[],
  ratings: Map<string, EntryRating>,
): MonotonicityViolation[] {
  const violations: MonotonicityViolation[] = [];
  const singles = entries
    .filter((entry) => entry.category === 'single' && entry.rankTier >= 0)
    .slice()
    .sort((a, b) => a.rankTier - b.rankTier || a.key.localeCompare(b.key));

  const byTier = new Map<number, Entry[]>();
  for (const entry of singles) {
    const list = byTier.get(entry.rankTier) ?? [];
    list.push(entry);
    byTier.set(entry.rankTier, list);
  }
  const tiers = [...byTier.keys()].sort((a, b) => a - b);
  for (let i = 0; i < tiers.length - 1; i++) {
    const lower = tiers[i]!;
    const higher = tiers[i + 1]!;
    const lowerScore = median(byTier.get(lower)!.map((entry) => ratings.get(entry.key)?.score ?? 50));
    const higherScore = median(byTier.get(higher)!.map((entry) => ratings.get(entry.key)?.score ?? 50));
    if (lowerScore > higherScore + 0.5) {
      const lowerLabel = formatRankTier(lower);
      const higherLabel = formatRankTier(higher);
      violations.push({
        kind: 'rank',
        pairKey: `rank:${lower}>${higher}`,
        lowerId: String(lower),
        higherId: String(higher),
        lowerLabel,
        higherLabel,
        lowerScore,
        higherScore,
        message: `${lowerLabel} (${fmt(lowerScore)}) > ${higherLabel} (${fmt(higherScore)})  [违例]`,
      });
    }
  }

  const catOrder = [...HAND_CATEGORY_STRENGTH_ORDER].reverse();
  const catScores: { category: HandCategory; score: number }[] = [];
  for (const category of catOrder) {
    const group = entries.filter((entry) => entry.category === category);
    if (group.length === 0) continue;
    catScores.push({
      category,
      score: median(group.map((entry) => ratings.get(entry.key)?.score ?? 50)),
    });
  }
  for (let i = 0; i < catScores.length - 1; i++) {
    const lower = catScores[i]!;
    const higher = catScores[i + 1]!;
    if (lower.score > higher.score + 0.5) {
      const lowerLabel = HAND_CATEGORY_NAMES[lower.category];
      const higherLabel = HAND_CATEGORY_NAMES[higher.category];
      violations.push({
        kind: 'category',
        pairKey: `category:${lower.category}>${higher.category}`,
        lowerId: lower.category,
        higherId: higher.category,
        lowerLabel,
        higherLabel,
        lowerScore: lower.score,
        higherScore: higher.score,
        message: `${lowerLabel} (${fmt(lower.score)}) > ${higherLabel} (${fmt(higher.score)})  [违例]`,
      });
    }
  }
  return violations;
}

/** 各牌型中位强度，按稀有度升序（单张 → 同花顺）。 */
export function categoryMedians(
  entries: readonly Entry[],
  ratings: Map<string, EntryRating>,
): { category: HandCategory; label: string; score: number; count: number }[] {
  const catOrder = [...HAND_CATEGORY_STRENGTH_ORDER].reverse();
  const rows: { category: HandCategory; label: string; score: number; count: number }[] = [];
  for (const category of catOrder) {
    const group = entries.filter((entry) => entry.category === category);
    if (group.length === 0) continue;
    rows.push({
      category,
      label: HAND_CATEGORY_NAMES[category],
      score: median(group.map((entry) => ratings.get(entry.key)?.score ?? 50)),
      count: group.length,
    });
  }
  return rows;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function fmt(value: number): string {
  return value.toFixed(1);
}
