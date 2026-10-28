import {
  applyEndlessConfigDraft,
  captureEndlessConfigAsDefault,
  clampEndlessWaveSeconds,
  defaultEndlessWaveSeconds,
  sanitizeEndlessConfigDraft,
  type EndlessConfigDraft,
} from '@pb/sim';

/** 运行控制用的出兵窗口视图，与 sim EndlessConfigDraft / endless.json 一致。 */
export type EndlessConfigView = EndlessConfigDraft;

export { clampEndlessWaveSeconds };

/** 从当前运行时草稿生成控件初值。 */
export function defaultEndlessConfigView(): EndlessConfigView {
  return { waveSeconds: defaultEndlessWaveSeconds() };
}

/** 把控件值写回运行时；下一波生成会读到。 */
export function applyEndlessConfigView(view: EndlessConfigView): void {
  applyEndlessConfigDraft(view);
}

/** 非法字段回落默认，合法则夹紧到控件区间。 */
export function sanitizeEndlessConfigView(values: Partial<EndlessConfigView>): EndlessConfigView {
  return sanitizeEndlessConfigDraft(values);
}

/** POST 到 Vite 开发中间件写盘；preview/build 下接口不存在。 */
export async function persistEndlessConfigToFile(
  view: EndlessConfigView,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const draft = sanitizeEndlessConfigView(view);
  // 先写运行时，写盘失败时本会话下一局仍能用新配置
  applyEndlessConfigView(draft);
  try {
    const res = await fetch('/__pb/endless-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) detail = body.error;
      } catch {
        // 非 JSON 错误体时沿用 status
      }
      if (res.status === 404) {
        return { ok: false, error: '需在 pnpm dev 下保存' };
      }
      return { ok: false, error: detail };
    }
    captureEndlessConfigAsDefault();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
