import { describe, expect, it } from 'vitest';
import { createRun } from '@pb/sim';
import {
  createEndlessProgressStore,
  isBetterBest,
  sanitizeEndlessSave,
  type EndlessBest,
} from '../src/campaign/endlessProgress.js';

/** 内存版 Storage，避免依赖 jsdom。 */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

const best = (bestWave: number, hpRatio: number): EndlessBest => ({
  bestWave,
  hpRatio,
  totalSeconds: 0,
  runSeed: 1,
  boons: [],
});

describe('无限防守存档', () => {
  it('先比波数，同波数比剩余血量', () => {
    expect(isBetterBest(best(3, 0.1), best(2, 1))).toBe(true);
    expect(isBetterBest(best(3, 0.5), best(3, 0.6))).toBe(false);
    expect(isBetterBest(best(3, 0.7), best(3, 0.6))).toBe(true);
    expect(isBetterBest(best(0, 1), null)).toBe(false);
  });

  it('保存续玩、结束挑战后清空并刷新最佳', () => {
    const store = createEndlessProgressStore(memoryStorage());
    const run = { ...createRun(9), wave: 4 };
    store.saveRun(run);
    expect(store.load().run?.wave).toBe(4);
    expect(store.finishRun(run, 3)).toBe(true);
    expect(store.load()).toMatchObject({ run: null, best: { bestWave: 3 } });
    // 更差的成绩不覆盖最佳
    expect(store.finishRun(run, 1)).toBe(false);
    expect(store.load().best?.bestWave).toBe(3);
  });

  it('坏数据回落为空存档', () => {
    expect(sanitizeEndlessSave('x')).toEqual({ run: null, best: null });
    expect(sanitizeEndlessSave({ run: { wave: 2 }, best: { bestWave: 'a' } })).toEqual({ run: null, best: null });
  });

  it('存下继承阵容与手牌，旧存档缺字段时按未继承处理', () => {
    const store = createEndlessProgressStore(memoryStorage());
    const run = {
      ...createRun(9),
      wave: 3,
      carriedUnits: [{ faction: 0 as const, typeId: 'melee_grunt' as const, x: 9, y: 5, hpRatio: 0.5 }],
      carriedHand: ['A-spades', 'K-hearts'],
    };
    store.saveRun(run);
    expect(store.load().run?.carriedUnits).toHaveLength(1);
    expect(store.load().run?.carriedHand).toEqual(['A-spades', 'K-hearts']);

    const legacy = { ...createRun(4) } as Record<string, unknown>;
    delete legacy.carriedUnits;
    delete legacy.carriedHand;
    store.saveRun(legacy as never);
    expect(store.load().run?.carriedUnits).toEqual([]);
    // 手牌缺字段表示还没继承过：续玩时走默认起手，而不是空手开局
    expect(store.load().run?.carriedHand).toBeUndefined();
  });
});
