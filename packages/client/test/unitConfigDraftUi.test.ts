import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyUnitConfigDrafts, dumpUnitConfigDrafts, resetUnitConfigsToDefault } from '@pb/sim';
import {
  clearRememberedUnitDrafts,
  peekRememberedUnitDrafts,
  rememberUnitDrafts,
  syncUnitConfigsForBalance,
  syncUnitConfigsFromDevServer,
} from '../src/debug/unitConfigDraftUi.js';

describe('单位配置开发服同步', () => {
  beforeEach(() => {
    resetUnitConfigsToDefault();
    clearRememberedUnitDrafts();
  });

  afterEach(() => {
    clearRememberedUnitDrafts();
    resetUnitConfigsToDefault();
    vi.unstubAllGlobals();
  });

  it('把开发服返回的新配置应用到运行时', async () => {
    const drafts = dumpUnitConfigDrafts();
    drafts.melee_grunt.maxHp = 1234;
    drafts.melee_grunt.damage = 88;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => drafts,
      }),
    );

    await expect(syncUnitConfigsFromDevServer()).resolves.toEqual({ applied: true });
    expect(dumpUnitConfigDrafts().melee_grunt.maxHp).toBe(1234);
    expect(dumpUnitConfigDrafts().melee_grunt.damage).toBe(88);
  });

  it('404 时沿用当前配置，不抛错', async () => {
    const before = dumpUnitConfigDrafts().melee_grunt.maxHp;
    applyUnitConfigDrafts({
      ...dumpUnitConfigDrafts(),
      melee_grunt: { ...dumpUnitConfigDrafts().melee_grunt, maxHp: 777 },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 404,
        ok: false,
        json: async () => ({ error: 'not found' }),
      }),
    );

    await expect(syncUnitConfigsFromDevServer()).resolves.toEqual({
      applied: false,
      reason: 'unavailable',
    });
    expect(dumpUnitConfigDrafts().melee_grunt.maxHp).toBe(777);
    expect(dumpUnitConfigDrafts().melee_grunt.maxHp).not.toBe(before);
  });

  it('非法响应拒绝应用，运行时保持原值', async () => {
    const before = dumpUnitConfigDrafts().melee_grunt.maxHp;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ melee_grunt: { maxHp: 999, damage: 1 } }),
      }),
    );

    await expect(syncUnitConfigsFromDevServer()).rejects.toThrow('缺少兵种');
    expect(dumpUnitConfigDrafts().melee_grunt.maxHp).toBe(before);
  });

  it('开发服读盘失败时抛出原因', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 500,
        ok: false,
        json: async () => ({ error: 'units.json is not valid JSON' }),
      }),
    );

    await expect(syncUnitConfigsFromDevServer()).rejects.toThrow(
      '读取单位配置失败：units.json is not valid JSON',
    );
  });

  it('有未保存草稿时验证优先用草稿，不读盘', async () => {
    const drafts = dumpUnitConfigDrafts();
    drafts.melee_grunt.maxHp = 2468;
    drafts.melee_grunt.damage = 99;
    rememberUnitDrafts(drafts);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(syncUnitConfigsForBalance()).resolves.toEqual({ applied: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dumpUnitConfigDrafts().melee_grunt.maxHp).toBe(2468);
    expect(dumpUnitConfigDrafts().melee_grunt.damage).toBe(99);
    expect(peekRememberedUnitDrafts()?.melee_grunt.maxHp).toBe(2468);
  });

  it('没有未保存草稿时验证才去读盘', async () => {
    const drafts = dumpUnitConfigDrafts();
    drafts.melee_grunt.maxHp = 1357;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => drafts,
      }),
    );

    await expect(syncUnitConfigsForBalance()).resolves.toEqual({ applied: true });
    expect(dumpUnitConfigDrafts().melee_grunt.maxHp).toBe(1357);
  });
});
