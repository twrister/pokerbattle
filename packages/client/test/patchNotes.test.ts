import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyPatchNotes,
  parsePatchNotes,
  persistPatchNotes,
  PATCH_NOTES,
  resetPatchNotesToDefault,
  validatePatchNotes,
} from '../src/data/patchNotes.js';

describe('更新公告数据', () => {
  afterEach(() => {
    resetPatchNotesToDefault();
    vi.unstubAllGlobals();
  });

  it('合法列表通过校验并去掉版本号 v 前缀与空行', () => {
    const notes = parsePatchNotes([
      { version: 'v1.2.3', date: '2026-08-17', items: ['  第一条  ', '', '第二条'] },
    ]);
    expect(notes).toEqual([
      { version: '1.2.3', date: '2026-08-17', items: ['第一条', '第二条'] },
    ]);
    expect(validatePatchNotes(notes)).toBeUndefined();
  });

  it('缺版本或日期格式不对时拒绝', () => {
    expect(validatePatchNotes({ version: '1.0.0' })).toBe('公告必须是数组');
    expect(validatePatchNotes([{ version: '', date: '2026-08-17', items: ['x'] }])).toContain(
      '版本号',
    );
    expect(validatePatchNotes([{ version: '1.0.0', date: '08-17', items: ['x'] }])).toContain(
      '日期',
    );
    expect(validatePatchNotes([{ version: '1.0.0', date: '2026-08-17', items: [] }])).toContain(
      '更新说明',
    );
  });

  it('apply 后运行时列表被替换', () => {
    applyPatchNotes([{ version: '9.9.9', date: '2026-01-01', items: ['仅测试'] }]);
    expect(PATCH_NOTES).toEqual([{ version: '9.9.9', date: '2026-01-01', items: ['仅测试'] }]);
    resetPatchNotesToDefault();
    expect(PATCH_NOTES[0]?.version).not.toBe('9.9.9');
  });

  it('persist 成功时返回 ok，404 提示需在开发服保存', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      }),
    );
    await expect(
      persistPatchNotes([{ version: '1.0.0', date: '2026-08-17', items: ['x'] }]),
    ).resolves.toEqual({ ok: true });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      }),
    );
    await expect(
      persistPatchNotes([{ version: '1.0.0', date: '2026-08-17', items: ['x'] }]),
    ).resolves.toEqual({ ok: false, error: '需在 pnpm dev 下保存' });
  });
});
