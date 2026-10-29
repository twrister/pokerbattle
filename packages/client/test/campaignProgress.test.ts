import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_PROGRESS_STORAGE_KEY,
  countCampaignStars,
  createCampaignProgressStore,
  emptyProgress,
  isStageUnlocked,
  recordStageClear,
  sanitizeProgress,
  totalCampaignStars,
} from '../src/campaign/progress.js';

/** 内存版 Storage，避免依赖 jsdom 的 localStorage。 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

describe('战役进度', () => {
  const order = ['a', 'b', 'c'];

  it('星数每关一颗，重复通关不叠加，已下线关卡不计入', () => {
    expect(countCampaignStars(emptyProgress(), order)).toEqual({ earned: 0, total: 3 });
    let progress = recordStageClear(emptyProgress(), { stageId: 'a', seconds: 50 });
    progress = recordStageClear(progress, { stageId: 'a', seconds: 40 });
    progress = recordStageClear(progress, { stageId: 'removed', seconds: 10 });
    expect(countCampaignStars(progress, order)).toEqual({ earned: 1, total: 3 });
  });

  it('总星数叠加无限防守守住波数，无记录或非法值按 0 计', () => {
    const stars = { earned: 2, total: 3 };
    expect(totalCampaignStars(stars, 5)).toBe(7);
    expect(totalCampaignStars(stars, 0)).toBe(2);
    expect(totalCampaignStars(stars, null)).toBe(2);
    expect(totalCampaignStars(stars, Number.NaN)).toBe(2);
    expect(totalCampaignStars(stars, -3)).toBe(2);
    expect(totalCampaignStars(stars, 4.8)).toBe(6);
  });

  it('第一关始终解锁，其余需上一关通关', () => {
    const progress = recordStageClear(emptyProgress(), { stageId: 'a', seconds: 50 });
    expect(isStageUnlocked(emptyProgress(), order, 'a')).toBe(true);
    expect(isStageUnlocked(emptyProgress(), order, 'b')).toBe(false);
    expect(isStageUnlocked(progress, order, 'b')).toBe(true);
    expect(isStageUnlocked(progress, order, 'c')).toBe(false);
    expect(isStageUnlocked(progress, order, 'unknown')).toBe(false);
  });

  it('重复通关用时取最短', () => {
    let progress = recordStageClear(emptyProgress(), { stageId: 'a', seconds: 80 });
    progress = recordStageClear(progress, { stageId: 'a', seconds: 60 });
    expect(progress.stages.a).toEqual({ bestSeconds: 60 });
    progress = recordStageClear(progress, { stageId: 'a', seconds: 90 });
    expect(progress.stages.a).toEqual({ bestSeconds: 60 });
  });

  it('清洗时丢弃非法条目，并兼容旧存档里的 stars 字段', () => {
    const progress = sanitizeProgress({
      stages: {
        ok: { stars: 9, bestSeconds: 10 },
        bad1: { bestSeconds: 'x' },
        bad2: null,
      },
    });
    expect(progress.stages).toEqual({ ok: { bestSeconds: 10 } });
    expect(sanitizeProgress('oops')).toEqual(emptyProgress());
  });

  it('仓库写入后可读回，损坏数据回落空进度', () => {
    const storage = memoryStorage();
    const store = createCampaignProgressStore(storage);
    store.recordClear({ stageId: 'a', seconds: 33 });
    expect(createCampaignProgressStore(storage).load().stages.a).toEqual({ bestSeconds: 33 });
    storage.setItem(CAMPAIGN_PROGRESS_STORAGE_KEY, '{not json');
    expect(store.load()).toEqual(emptyProgress());
  });
});
