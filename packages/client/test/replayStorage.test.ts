import { describe, expect, it, vi } from 'vitest';
import { Faction } from '@pb/sim';
import { createReplayStore } from '../src/replay/storage.js';
import {
  MAX_REPLAYS,
  REPLAY_SCHEMA_VERSION,
  REPLAY_STORAGE_KEY,
  type ReplayRecord,
  type ReplayRecordInput,
} from '../src/replay/types.js';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();
  /** 写入条数超过该值时抛配额错误，0 表示不限制。 */
  failAbove = 0;

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failAbove > 0) {
      const parsed = JSON.parse(value) as { replays?: unknown[] };
      if ((parsed.replays?.length ?? 0) > this.failAbove) {
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      }
    }
    this.data.set(key, value);
  }
}

function input(overrides: Partial<ReplayRecordInput> = {}): ReplayRecordInput {
  return {
    seed: 1,
    matchMode: '1v1',
    endTick: 20,
    result: { winner: Faction.Blue, reason: 'base_destroyed' },
    context: { localFaction: Faction.Blue, localName: '甲', opponentName: '乙' },
    frames: [],
    arenaSignature: 'sig',
    ...overrides,
  };
}

describe('本地录像仓库', () => {
  it('新录像插到队首，超出 10 场丢掉最旧', () => {
    const storage = new MemoryStorage();
    let nextId = 0;
    const store = createReplayStore({
      storage,
      now: () => 1000 + nextId,
      createId: () => `id-${nextId++}`,
    });
    for (let i = 0; i < MAX_REPLAYS + 1; i += 1) {
      store.save(input({ seed: i }));
    }
    const list = store.list();
    expect(list).toHaveLength(MAX_REPLAYS);
    expect(list[0]?.seed).toBe(MAX_REPLAYS);
    expect(list[0]?.id).toBe(`id-${MAX_REPLAYS}`);
    expect(list.at(-1)?.seed).toBe(1);
  });

  it('损坏数据与错误 schema 整仓丢弃', () => {
    const storage = new MemoryStorage();
    storage.setItem(REPLAY_STORAGE_KEY, '{not-json');
    expect(createReplayStore({ storage }).list()).toEqual([]);

    storage.setItem(
      REPLAY_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 99, replays: [input()] }),
    );
    expect(createReplayStore({ storage }).list()).toEqual([]);
  });

  it('配额不足时丢掉最旧再写，仍失败则不抛错', () => {
    const storage = new MemoryStorage();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createReplayStore({
      storage,
      now: () => 1,
      createId: () => 'new',
    });
    store.save(input({ seed: 1 }));
    store.save(input({ seed: 2 }));
    expect(store.list()).toHaveLength(2);

    storage.failAbove = 1;
    expect(store.save(input({ seed: 3 }))).toBe(true);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.seed).toBe(3);

    storage.failAbove = 0;
    storage.setItem = () => {
      const error = new Error('quota');
      error.name = 'QuotaExceededError';
      throw error;
    };
    expect(store.save(input({ seed: 4 }))).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('合法记录带当前 schema 写回', () => {
    const storage = new MemoryStorage();
    const store = createReplayStore({
      storage,
      now: () => 42,
      createId: () => 'fixed',
    });
    expect(store.save(input())).toBe(true);
    const raw = JSON.parse(storage.getItem(REPLAY_STORAGE_KEY)!) as { schemaVersion: number; replays: ReplayRecord[] };
    expect(raw.schemaVersion).toBe(REPLAY_SCHEMA_VERSION);
    expect(raw.replays[0]?.id).toBe('fixed');
    expect(raw.replays[0]?.recordedAt).toBe(42);
  });
});
