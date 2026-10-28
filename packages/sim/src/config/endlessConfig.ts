import rawEndless from './endless.json';

/**
 * 无限防守的出兵窗口（秒）。
 * 指一波里敌方脚本从第 2 秒开始、到窗口结束前 10 秒停止的出兵节奏，
 * 不是这一波必须撑满的时间：清完场上敌人才进下一波。
 */
export const ENDLESS_WAVE_SECONDS_MIN = 30;
export const ENDLESS_WAVE_SECONDS_MAX = 600;

/** 调试面板与 endless.json 共用的草稿。 */
export interface EndlessConfigDraft {
  /** 出兵窗口（秒）。 */
  waveSeconds: number;
}

/** 文件快照不可用时的兜底，须与 endless.json 一致。 */
const fallbackDraft: EndlessConfigDraft = { waveSeconds: 180 };

/** 文件快照：非法 JSON 回落到硬编码默认，避免启动失败。 */
const initialDraft = parseEndlessConfigDraft(rawEndless) ?? { ...fallbackDraft };
let liveDraft = { ...initialDraft };
let defaultDraft = { ...initialDraft };

/** 默认出兵窗口（秒），取最近一次写回快照。 */
export const ENDLESS_WAVE_SECONDS = defaultDraft.waveSeconds;

/** 当前运行时的出兵窗口（秒），新开波次会读它。 */
export function defaultEndlessWaveSeconds(): number {
  return liveDraft.waveSeconds;
}

/** 把任意输入夹到合法区间，非数字回落为最小窗口。 */
export function clampEndlessWaveSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return ENDLESS_WAVE_SECONDS_MIN;
  return Math.min(ENDLESS_WAVE_SECONDS_MAX, Math.max(ENDLESS_WAVE_SECONDS_MIN, seconds));
}

/** 导出当前运行时草稿，供调试面板与写盘。 */
export function dumpEndlessConfigDraft(): EndlessConfigDraft {
  return { ...liveDraft };
}

/** 导出最近一次成功写回（或模块加载）的快照，供重置。 */
export function dumpDefaultEndlessConfigDraft(): EndlessConfigDraft {
  return { ...defaultDraft };
}

/** 校验草稿结构；通过返回 undefined。 */
export function validateEndlessConfigDraft(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '配置必须是对象';
  const rec = value as Record<string, unknown>;
  const seconds = rec.waveSeconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'waveSeconds 必须是有限数字';
  if (seconds < ENDLESS_WAVE_SECONDS_MIN || seconds > ENDLESS_WAVE_SECONDS_MAX) {
    return `waveSeconds 必须在 ${ENDLESS_WAVE_SECONDS_MIN}–${ENDLESS_WAVE_SECONDS_MAX}`;
  }
  return undefined;
}

/** 非法字段回落默认，合法则夹紧到控件区间。 */
export function sanitizeEndlessConfigDraft(values: Partial<EndlessConfigDraft>): EndlessConfigDraft {
  const fallback = defaultDraft.waveSeconds;
  const seconds = typeof values.waveSeconds === 'number' && Number.isFinite(values.waveSeconds)
    ? clampEndlessWaveSeconds(values.waveSeconds)
    : fallback;
  return { waveSeconds: seconds };
}

/** 覆盖运行时默认窗口；下一波生成会读到。 */
export function applyEndlessConfigDraft(draft: EndlessConfigDraft): void {
  const error = validateEndlessConfigDraft(draft);
  if (error) throw new Error(error);
  liveDraft = sanitizeEndlessConfigDraft(draft);
}

/** 恢复到最近一次成功写回（或初始加载）的快照。 */
export function resetEndlessConfigToDefault(): void {
  liveDraft = { ...defaultDraft };
}

/** 连写回快照一起回到模块加载时的 JSON，供测试隔离。 */
export function restoreEndlessConfigFromFile(): void {
  defaultDraft = { ...initialDraft };
  liveDraft = { ...initialDraft };
}

/** 成功写回 JSON 后，把当前草稿设为后续重置基准。 */
export function captureEndlessConfigAsDefault(): void {
  defaultDraft = { ...liveDraft };
}

function parseEndlessConfigDraft(value: unknown): EndlessConfigDraft | null {
  if (validateEndlessConfigDraft(value)) return null;
  return { waveSeconds: clampEndlessWaveSeconds((value as EndlessConfigDraft).waveSeconds) };
}
