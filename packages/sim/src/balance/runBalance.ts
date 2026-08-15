import { HAND_CATEGORY_STRENGTH_ORDER } from '../config/cardFormations.js';
import { Rng } from '../math/rng.js';
import { runDuel, runMelee, type MeleeResult } from './duel.js';
import { listBalanceEntries, type Entry } from './entries.js';
import {
  aggregatePairs,
  checkMonotonicity,
  fitMeleeRatings,
  fitSoloRatings,
  intersectViolations,
  type EntryRating,
  type MonotonicityViolation,
  type PairAggregate,
  type PairObservation,
  type SharedViolation,
  type TeamObservation,
} from './rating.js';

export type BalanceMode = 'solo' | 'melee' | 'all';

export interface BalanceAnalysisOptions {
  mode?: BalanceMode;
  seeds?: number;
  rounds?: number;
  teamSize?: number;
  seed?: number;
}

export interface BalanceProgress {
  phase: 'solo' | 'melee';
  done: number;
  total: number;
}

export interface BalanceAnalysisHooks {
  onProgress?: (progress: BalanceProgress) => void;
  /** 分片让出主线程；缺省用 setTimeout(0)，Node CLI 也可安全 await。 */
  shouldYield?: () => Promise<void>;
}

export interface BalanceReport {
  entries: Entry[];
  soloRatings: Map<string, EntryRating> | null;
  meleeRatings: Map<string, EntryRating> | null;
  pairs: PairAggregate[];
  soloViolations: MonotonicityViolation[];
  meleeViolations: MonotonicityViolation[];
  sharedViolations: SharedViolation[];
  seeds: number;
  meleeRounds: number;
}

export const DEFAULT_BALANCE_OPTIONS = {
  mode: 'all' as const,
  seeds: 6,
  rounds: 400,
  teamSize: 3,
  seed: 1,
};

const SOLO_YIELD_EVERY = 8;
const MELEE_YIELD_EVERY = 20;

/** 让出一帧，避免浏览器里连续 World.step 卡死界面。 */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    const schedule = (globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown }).setTimeout;
    if (schedule) {
      schedule(resolve, 0);
      return;
    }
    void Promise.resolve().then(resolve);
  });
}

/**
 * 跑独立 +/或 混战对拆并拟合强度分。
 * 浏览器与 CLI 共用；进度通过 hooks 回传。
 */
export async function runBalanceAnalysis(
  options: BalanceAnalysisOptions = {},
  hooks: BalanceAnalysisHooks = {},
): Promise<BalanceReport> {
  const mode = options.mode ?? DEFAULT_BALANCE_OPTIONS.mode;
  const seeds = options.seeds ?? DEFAULT_BALANCE_OPTIONS.seeds;
  const rounds = options.rounds ?? DEFAULT_BALANCE_OPTIONS.rounds;
  const teamSize = options.teamSize ?? DEFAULT_BALANCE_OPTIONS.teamSize;
  const seed = options.seed ?? DEFAULT_BALANCE_OPTIONS.seed;
  const yieldFn = hooks.shouldYield ?? yieldToUi;

  const entries = listBalanceEntries();
  if (entries.length === 0) throw new Error('没有可对拆的阵型条目');

  let pairs: PairAggregate[] = [];
  let soloRatings: Map<string, EntryRating> | null = null;
  let meleeRatings: Map<string, EntryRating> | null = null;
  let meleeRounds = 0;
  const soloViolations: MonotonicityViolation[] = [];
  const meleeViolations: MonotonicityViolation[] = [];

  if (mode === 'solo' || mode === 'all') {
    const matchups = buildSoloMatchups(entries);
    const observations = await runSoloMatchups(matchups, seeds, seed, hooks.onProgress, yieldFn);
    pairs = aggregatePairs(observations);
    soloRatings = fitSoloRatings(entries, pairs);
    soloViolations.push(...checkMonotonicity(entries, soloRatings));
  }

  if (mode === 'melee' || mode === 'all') {
    const meleeResults = await runMeleeRounds(
      entries,
      { rounds, teamSize, seed },
      hooks.onProgress,
      yieldFn,
    );
    meleeRounds = meleeResults.length;
    const teamObs: TeamObservation[] = meleeResults.map((round) => ({
      teamA: round.teamA,
      teamB: round.teamB,
      scoreA: round.scoreA,
    }));
    meleeRatings = fitMeleeRatings(entries, teamObs);
    meleeViolations.push(...checkMonotonicity(entries, meleeRatings));
  }

  return {
    entries,
    soloRatings,
    meleeRatings,
    pairs,
    soloViolations,
    meleeViolations,
    sharedViolations: intersectViolations(soloViolations, meleeViolations),
    seeds,
    meleeRounds,
  };
}

/** 同牌型全对拆 + 相邻稀有度按同档位抽样，避免跨牌型 O(n²)。 */
function buildSoloMatchups(entries: readonly Entry[]): [Entry, Entry][] {
  const pairs: [Entry, Entry][] = [];
  const seen = new Set<string>();
  const add = (a: Entry, b: Entry) => {
    if (a.key === b.key) return;
    const id = a.key < b.key ? `${a.key}\t${b.key}` : `${b.key}\t${a.key}`;
    if (seen.has(id)) return;
    seen.add(id);
    pairs.push(a.key < b.key ? [a, b] : [b, a]);
  };

  const byCategory = new Map<string, Entry[]>();
  for (const entry of entries) {
    const list = byCategory.get(entry.category) ?? [];
    list.push(entry);
    byCategory.set(entry.category, list);
  }
  for (const group of byCategory.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) add(group[i]!, group[j]!);
    }
  }

  const catOrder = [...HAND_CATEGORY_STRENGTH_ORDER].reverse();
  for (let i = 0; i < catOrder.length - 1; i++) {
    const prev = byCategory.get(catOrder[i]!) ?? [];
    const next = byCategory.get(catOrder[i + 1]!) ?? [];
    if (prev.length === 0 || next.length === 0) continue;
    for (const a of prev) {
      const sameTier = next.filter((b) => b.rankTier === a.rankTier && a.rankTier >= 0);
      if (sameTier.length > 0) {
        for (const b of sameTier) add(a, b);
      } else {
        add(a, next[0]!);
      }
    }
  }
  return pairs;
}

/** 每对按多种子 × 换边累积连续分，供后续拟合成一维强度。 */
async function runSoloMatchups(
  matchups: readonly [Entry, Entry][],
  seeds: number,
  baseSeed: number,
  onProgress: BalanceAnalysisHooks['onProgress'],
  yieldFn: () => Promise<void>,
): Promise<PairObservation[]> {
  const observations: PairObservation[] = [];
  let done = 0;
  for (const [a, b] of matchups) {
    for (let s = 0; s < seeds; s++) {
      const seed = mixSeed(baseSeed, done, s);
      for (const swap of [false, true]) {
        const result = runDuel(a, b, seed + (swap ? 10_007 : 0), swap);
        observations.push({
          aKey: a.key,
          bKey: b.key,
          scoreA: result.scoreA,
          hpFracA: result.hpFracA,
          hpFracB: result.hpFracB,
        });
      }
    }
    done += 1;
    onProgress?.({ phase: 'solo', done, total: matchups.length });
    if (done % SOLO_YIELD_EVERY === 0) await yieldFn();
  }
  return observations;
}

/** 每组队伍跑正反两场，轮数不够就截断，避免报表把换边算成双倍轮次。 */
async function runMeleeRounds(
  entries: readonly Entry[],
  options: { rounds: number; teamSize: number; seed: number },
  onProgress: BalanceAnalysisHooks['onProgress'],
  yieldFn: () => Promise<void>,
): Promise<MeleeResult[]> {
  const rng = new Rng(options.seed ^ 0x5bd1e995);
  const results: MeleeResult[] = [];
  const pairings = Math.max(1, Math.ceil(options.rounds / 2));
  for (let i = 0; i < pairings; i++) {
    const picked = pickDistinct(rng, entries, options.teamSize * 2);
    const teamA = picked.slice(0, options.teamSize);
    const teamB = picked.slice(options.teamSize, options.teamSize * 2);
    if (teamA.length === 0 || teamB.length === 0) break;
    const seed = mixSeed(options.seed, i, 99);
    results.push(runMelee(teamA, teamB, seed, false));
    results.push(runMelee(teamA, teamB, seed + 10_007, true));
    const done = Math.min(results.length, options.rounds);
    onProgress?.({ phase: 'melee', done, total: options.rounds });
    if ((i + 1) % MELEE_YIELD_EVERY === 0) await yieldFn();
  }
  return results.slice(0, options.rounds);
}

/** Fisher-Yates 抽不重复条目；混战 A/B 队从同一洗牌结果切分，避免两边抽到同一搭配。 */
function pickDistinct(rng: Rng, items: readonly Entry[], count: number): Entry[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy.slice(0, Math.min(count, copy.length));
}

/** 把对局序号混进种子，避免所有对拆共用同一个 World.rng 初值。 */
function mixSeed(base: number, a: number, b: number): number {
  let x = (base | 0) ^ (a * 0x9e3779b9) ^ (b * 0x85ebca6b);
  if ((x | 0) === 0) x = 0x9e3779b9;
  return x | 0;
}
