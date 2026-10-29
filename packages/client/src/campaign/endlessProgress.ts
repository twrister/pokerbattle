import { sanitizeRun, type EndlessRunState } from '@pb/sim';

/** 无限防守本地存储键；结构变更时升级后缀。 */
export const ENDLESS_STORAGE_KEY = 'pb.campaign.endless.v1';

/** 历史最佳成绩，后续服务端排行榜按同一结构上报。 */
export interface EndlessBest {
  /** 撑过的波数（完整守住的波）。 */
  bestWave: number;
  /** 达成最佳时剩余主堡血量比例，同波数时比它。 */
  hpRatio: number;
  totalSeconds: number;
  runSeed: number;
  boons: string[];
}

/** 存档：进行中的挑战（可续玩）与历史最佳。 */
export interface EndlessSave {
  run: EndlessRunState | null;
  best: EndlessBest | null;
}

/** 无限防守存档仓库。 */
export interface EndlessProgressStore {
  load(): EndlessSave;
  /** 保存进行中的挑战（每次选完强化后调用）。 */
  saveRun(run: EndlessRunState): void;
  /** 挑战结束：清掉进行中的存档，按成绩刷新最佳；返回是否刷新了最佳。 */
  finishRun(run: EndlessRunState, clearedWaves: number): boolean;
}

/** 新成绩是否优于旧最佳：先比波数，再比剩余血量。 */
export function isBetterBest(next: EndlessBest, previous: EndlessBest | null): boolean {
  if (!previous) return next.bestWave > 0;
  if (next.bestWave !== previous.bestWave) return next.bestWave > previous.bestWave;
  return next.hpRatio > previous.hpRatio;
}

/** 清洗任意存储载荷，坏数据回落为空存档。 */
export function sanitizeEndlessSave(raw: unknown): EndlessSave {
  const save: EndlessSave = { run: null, best: null };
  if (typeof raw !== 'object' || raw === null) return save;
  const { run, best } = raw as Partial<EndlessSave>;
  // 老存档没有 carriedUnits：sanitizeRun 会补成空数组，续玩时当作没有继承阵容
  if (run && typeof run === 'object' && Array.isArray(run.boons)) save.run = sanitizeRun(run);
  if (best && typeof best === 'object' && Number.isFinite(best.bestWave)) {
    save.best = {
      bestWave: Math.max(0, Math.floor(best.bestWave)),
      hpRatio: Number(best.hpRatio) || 0,
      totalSeconds: Number(best.totalSeconds) || 0,
      runSeed: Number(best.runSeed) >>> 0,
      boons: Array.isArray(best.boons) ? best.boons.filter((id) => typeof id === 'string') : [],
    };
  }
  return save;
}

/** 基于 localStorage 的无限防守存档；写失败静默忽略，不影响本局。 */
export function createEndlessProgressStore(storage: Storage = localStorage): EndlessProgressStore {
  const read = (): EndlessSave => {
    try {
      const raw = storage.getItem(ENDLESS_STORAGE_KEY);
      return raw ? sanitizeEndlessSave(JSON.parse(raw)) : { run: null, best: null };
    } catch {
      return { run: null, best: null };
    }
  };
  const write = (save: EndlessSave): void => {
    try {
      storage.setItem(ENDLESS_STORAGE_KEY, JSON.stringify(save));
    } catch {
      // 写盘失败只丢续玩，不影响当前展示
    }
  };
  return {
    load: read,
    saveRun(run) {
      write({ ...read(), run });
    },
    finishRun(run, clearedWaves) {
      const previous = read().best;
      const next: EndlessBest = {
        bestWave: clearedWaves,
        hpRatio: run.castleHpRatio,
        totalSeconds: run.totalSeconds,
        runSeed: run.runSeed,
        boons: [...run.boons],
      };
      const improved = isBetterBest(next, previous);
      write({ run: null, best: improved ? next : previous });
      return improved;
    },
  };
}
