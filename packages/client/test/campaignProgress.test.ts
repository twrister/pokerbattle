import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_PROGRESS_STORAGE_KEY,
  createCampaignProgressStore,
  emptyProgress,
  isStageUnlocked,
  recordStageClear,
  sanitizeProgress,
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
