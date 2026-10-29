/** 战役进度本地存储键；结构变更时升级后缀。 */
export const CAMPAIGN_PROGRESS_STORAGE_KEY = 'pb.campaign.progress.v1';

/** 单关最佳成绩；未通关的关卡不会出现在记录里。 */
export interface StageBest {
  /** 最短通关用时，秒。 */
  bestSeconds: number;
}

/** 战役进度：只记已通关的关卡。 */
export interface CampaignProgress {
  stages: Record<string, StageBest>;
}

/** 一次通关上报。 */
export interface StageClearInput {
  stageId: string;
  seconds: number;
}

/** 空进度。 */
export function emptyProgress(): CampaignProgress {
  return { stages: {} };
}

/** 清洗任意存储载荷，丢弃非法条目；旧存档里多余的 stars 字段会被忽略。 */
export function sanitizeProgress(raw: unknown): CampaignProgress {
  const progress = emptyProgress();
  if (typeof raw !== 'object' || raw === null) return progress;
  const stages = (raw as { stages?: unknown }).stages;
  if (typeof stages !== 'object' || stages === null) return progress;
  for (const [stageId, value] of Object.entries(stages)) {
    if (typeof value !== 'object' || value === null) continue;
    const { bestSeconds } = value as Partial<StageBest>;
    if (typeof bestSeconds !== 'number' || !Number.isFinite(bestSeconds)) continue;
    progress.stages[stageId] = { bestSeconds: Math.max(0, bestSeconds) };
  }
  return progress;
}

/** 合并一次通关成绩：用时取更短；返回新对象，不改入参。 */
export function recordStageClear(
  progress: CampaignProgress,
  input: StageClearInput,
): CampaignProgress {
  const previous = progress.stages[input.stageId];
  const next: StageBest = {
    bestSeconds: previous ? Math.min(previous.bestSeconds, input.seconds) : input.seconds,
  };
  return { stages: { ...progress.stages, [input.stageId]: next } };
}

/**
 * 关卡是否已解锁：序列中第一关永远解锁，其余需要上一关已通关。
 * orderedStageIds 必须按战役顺序传入。
 */
export function isStageUnlocked(
  progress: CampaignProgress,
  orderedStageIds: readonly string[],
  stageId: string,
): boolean {
  const index = orderedStageIds.indexOf(stageId);
  if (index < 0) return false;
  if (index === 0) return true;
  return progress.stages[orderedStageIds[index - 1]!] !== undefined;
}

/** 战役星数：每关通关得 1 颗，重复通关不叠加。 */
export interface CampaignStars {
  earned: number;
  total: number;
}

/**
 * 统计战役星数：只计当前关卡表里存在的关卡，已下线关卡的旧记录不算。
 * 后续排行榜直接上报 earned。
 */
export function countCampaignStars(
  progress: CampaignProgress,
  orderedStageIds: readonly string[],
): CampaignStars {
  const earned = orderedStageIds.filter((stageId) => progress.stages[stageId] !== undefined).length;
  return { earned, total: orderedStageIds.length };
}

/**
 * 战役总星数（排行榜与选关页标题共用）：关卡首通星 + 无限防守守住波数。
 * 无限防守每守住一波算 1 星，历史最佳不叠加，因此取 bestWave 即可。
 */
export function totalCampaignStars(stars: CampaignStars, endlessBestWave: number | null): number {
  const endless = endlessBestWave != null && Number.isFinite(endlessBestWave)
    ? Math.max(0, Math.floor(endlessBestWave))
    : 0;
  return stars.earned + endless;
}

/** 进度仓库：读写 localStorage，写失败时静默保留内存态。 */
export interface CampaignProgressStore {
  load(): CampaignProgress;
  recordClear(input: StageClearInput): CampaignProgress;
}

/** 基于 localStorage 的进度仓库。 */
export function createCampaignProgressStore(storage: Storage = localStorage): CampaignProgressStore {
  const read = (): CampaignProgress => {
    try {
      const raw = storage.getItem(CAMPAIGN_PROGRESS_STORAGE_KEY);
      return raw ? sanitizeProgress(JSON.parse(raw)) : emptyProgress();
    } catch {
      return emptyProgress();
    }
  };
  return {
    load: read,
    recordClear(input) {
      const next = recordStageClear(read(), input);
      try {
        storage.setItem(CAMPAIGN_PROGRESS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // 写盘失败不影响本局结算展示
      }
      return next;
    },
  };
}
