import seed from './patchNotes.json' with { type: 'json' };

export interface PatchNote {
  version: string;
  date: string;
  items: string[];
}

const DEFAULT_PATCH_NOTES: PatchNote[] = clonePatchNotes(seed);

/** 更新公告条目，新版本追加到数组开头。开发服保存后就地替换。 */
export const PATCH_NOTES: PatchNote[] = clonePatchNotes(DEFAULT_PATCH_NOTES);

/** 深拷贝公告列表，避免编辑草稿与运行时/种子互相污染。 */
export function clonePatchNotes(notes: readonly PatchNote[]): PatchNote[] {
  return notes.map((note) => ({
    version: note.version,
    date: note.date,
    items: [...note.items],
  }));
}

/** 用新列表替换运行时公告，供开发服保存后立刻刷新弹层。 */
export function applyPatchNotes(notes: readonly PatchNote[]): void {
  PATCH_NOTES.splice(0, PATCH_NOTES.length, ...clonePatchNotes(notes));
}

/** 测试用：恢复为打包进包的种子数据。 */
export function resetPatchNotesToDefault(): void {
  applyPatchNotes(DEFAULT_PATCH_NOTES);
}

/** 写盘前校验，避免把残缺公告写进 patchNotes.json。 */
export function validatePatchNotes(value: unknown): string | undefined {
  if (!Array.isArray(value)) return '公告必须是数组';
  for (let i = 0; i < value.length; i++) {
    const note = value[i];
    if (!note || typeof note !== 'object' || Array.isArray(note)) {
      return `第 ${i + 1} 条公告格式无效`;
    }
    const rec = note as { version?: unknown; date?: unknown; items?: unknown };
    if (typeof rec.version !== 'string' || !rec.version.trim()) {
      return `第 ${i + 1} 条缺少版本号`;
    }
    if (typeof rec.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rec.date)) {
      return `第 ${i + 1} 条日期须为 YYYY-MM-DD`;
    }
    if (!Array.isArray(rec.items) || rec.items.length === 0) {
      return `第 ${i + 1} 条至少需要一条更新说明`;
    }
    if (rec.items.some((item) => typeof item !== 'string' || !item.trim())) {
      return `第 ${i + 1} 条更新说明不能为空`;
    }
  }
  return undefined;
}

/** 校验并通过后得到可写盘的公告列表；空行会被丢掉，避免文本框末尾换行误判。 */
export function parsePatchNotes(value: unknown): PatchNote[] {
  if (!Array.isArray(value)) throw new Error('公告必须是数组');
  const normalized = value.map((note) => {
    if (!note || typeof note !== 'object' || Array.isArray(note)) return note;
    const rec = note as { version?: unknown; date?: unknown; items?: unknown };
    return {
      version: typeof rec.version === 'string' ? rec.version.trim().replace(/^v/i, '') : rec.version,
      date: rec.date,
      items: Array.isArray(rec.items)
        ? rec.items
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean)
        : rec.items,
    };
  });
  const error = validatePatchNotes(normalized);
  if (error) throw new Error(error);
  return normalized as PatchNote[];
}

/** POST 到 Vite 开发中间件写盘；preview/build 下接口不存在。 */
export async function persistPatchNotes(
  notes: readonly PatchNote[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch('/__pb/patch-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notes),
    });
    if (!response.ok) {
      if (response.status === 404) return { ok: false, error: '需在 pnpm dev 下保存' };
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
