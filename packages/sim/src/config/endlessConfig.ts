import rawEndless from './endless.json';
import { UNIT_TYPE_IDS, type UnitTypeId } from './units.js';

/**
 * 无限防守的出兵窗口（秒）。
 * 指一波里敌方脚本从第 2 秒开始、到窗口结束前 10 秒停止的出兵节奏，
 * 不是这一波必须撑满的时间：清完场上敌人才进下一波。
 */
export const ENDLESS_WAVE_SECONDS_MIN = 30;
export const ENDLESS_WAVE_SECONDS_MAX = 600;

/** 每波覆盖项的合法区间；waveGenerator 的公式默认值也受它约束，两处不再各写一份。 */
export const ENDLESS_WAVE_INTERVAL_MIN = 6;
export const ENDLESS_WAVE_INTERVAL_MAX = 60;
export const ENDLESS_WAVE_BUDGET_MIN = 1;
export const ENDLESS_WAVE_BUDGET_MAX = 999;
/** 兵种权重即可消耗的预算，调大等于让该兵种少出。 */
export const ENDLESS_UNIT_WEIGHT_MIN = 0.5;
export const ENDLESS_UNIT_WEIGHT_MAX = 20;
/** 单波兵种池上限，避免配置页把出兵点铺满。 */
export const ENDLESS_WAVE_UNITS_MAX = 12;
/** 配置页最多维护的波数，超出部分一定走公式。 */
export const ENDLESS_WAVE_ROWS_MAX = 60;

/** 单波兵种池里的一种敌人。 */
export interface EndlessWaveUnitDraft {
  typeId: UnitTypeId;
  /** 出兵价值权重：越大越占本波预算，语义同内置池的 cost。 */
  weight: number;
}

/**
 * 单波覆盖项：字段全部可选，缺省即沿用原有公式。
 * 只覆盖前 N 波时，后面的波次完全按公式生成。
 */
export interface EndlessWaveDraft {
  /** 波号，从 1 开始。 */
  wave: number;
  /** 本波出兵窗口（秒）；缺省用全局 waveSeconds。 */
  waveSeconds?: number;
  /** 本波总预算（单位价值）；缺省按波次指数增长。 */
  budget?: number;
  /** 本波出兵间隔（秒）；缺省按波次递减。 */
  intervalSeconds?: number;
  /** 本波兵种池；缺省用按波次解锁的内置池。 */
  units?: EndlessWaveUnitDraft[];
}

/** 调试面板与 endless.json 共用的草稿。 */
export interface EndlessConfigDraft {
  /** 出兵窗口（秒），所有未单独配置的波次共用。 */
  waveSeconds: number;
  /** 每波覆盖项，按波号升序；空数组表示全部走公式。 */
  waves: EndlessWaveDraft[];
}

/** 文件快照不可用时的兜底，须与 endless.json 一致。 */
const fallbackDraft: EndlessConfigDraft = { waveSeconds: 180, waves: [] };

/** 文件快照：非法 JSON 回落到硬编码默认，避免启动失败。 */
const initialDraft = parseEndlessConfigDraft(rawEndless) ?? cloneDraft(fallbackDraft);
let liveDraft = cloneDraft(initialDraft);
let defaultDraft = cloneDraft(initialDraft);

/** 默认出兵窗口（秒），取最近一次写回快照。 */
export const ENDLESS_WAVE_SECONDS = defaultDraft.waveSeconds;

/** 当前运行时的出兵窗口（秒），新开波次会读它。 */
export function defaultEndlessWaveSeconds(): number {
  return liveDraft.waveSeconds;
}

/** 该波是否有手动覆盖项；没有则走公式。 */
export function getEndlessWaveOverride(wave: number): EndlessWaveDraft | undefined {
  return liveDraft.waves.find((entry) => entry.wave === wave);
}

/** 把任意输入夹到合法区间，非数字回落为最小窗口。 */
export function clampEndlessWaveSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return ENDLESS_WAVE_SECONDS_MIN;
  return Math.min(ENDLESS_WAVE_SECONDS_MAX, Math.max(ENDLESS_WAVE_SECONDS_MIN, seconds));
}

/** 导出当前运行时草稿，供调试面板与写盘。 */
export function dumpEndlessConfigDraft(): EndlessConfigDraft {
  return cloneDraft(liveDraft);
}

/** 导出最近一次成功写回（或模块加载）的快照，供重置。 */
export function dumpDefaultEndlessConfigDraft(): EndlessConfigDraft {
  return cloneDraft(defaultDraft);
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
  const waves = rec.waves;
  if (waves === undefined) return undefined;
  if (!Array.isArray(waves)) return 'waves 必须是数组';
  return validateWaveDrafts(waves);
}

/** 逐条校验每波覆盖项，错误信息带上波号，方便定位是哪一行。 */
function validateWaveDrafts(waves: readonly unknown[]): string | undefined {
  for (const raw of waves) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'waves 的每一项必须是对象';
    const entry = raw as Record<string, unknown>;
    if (!Number.isInteger(entry.wave) || (entry.wave as number) < 1) return 'wave 必须是大于 0 的整数';
    const wave = entry.wave as number;
    const windowError = checkRange(entry.waveSeconds, ENDLESS_WAVE_SECONDS_MIN, ENDLESS_WAVE_SECONDS_MAX);
    if (windowError) return `第 ${wave} 波 waveSeconds ${windowError}`;
    const budgetError = checkRange(entry.budget, ENDLESS_WAVE_BUDGET_MIN, ENDLESS_WAVE_BUDGET_MAX);
    if (budgetError) return `第 ${wave} 波 budget ${budgetError}`;
    const intervalError = checkRange(entry.intervalSeconds, ENDLESS_WAVE_INTERVAL_MIN, ENDLESS_WAVE_INTERVAL_MAX);
    if (intervalError) return `第 ${wave} 波 intervalSeconds ${intervalError}`;
    const units = entry.units;
    if (units === undefined) continue;
    if (!Array.isArray(units)) return `第 ${wave} 波 units 必须是数组`;
    if (units.length > ENDLESS_WAVE_UNITS_MAX) return `第 ${wave} 波 units 最多 ${ENDLESS_WAVE_UNITS_MAX} 种`;
    for (const unitRaw of units) {
      if (!unitRaw || typeof unitRaw !== 'object' || Array.isArray(unitRaw)) {
        return `第 ${wave} 波 units 的每一项必须是对象`;
      }
      const unit = unitRaw as Record<string, unknown>;
      if (typeof unit.typeId !== 'string' || !UNIT_TYPE_IDS.includes(unit.typeId as UnitTypeId)) {
        return `第 ${wave} 波存在未知兵种 ${String(unit.typeId)}`;
      }
      const weightError = checkRange(unit.weight, ENDLESS_UNIT_WEIGHT_MIN, ENDLESS_UNIT_WEIGHT_MAX);
      if (weightError) return `第 ${wave} 波 ${unit.typeId} 的 weight ${weightError}`;
    }
  }
  return undefined;
}

/** 可选字段缺省视为合法；给了数值就必须落在区间内。 */
function checkRange(value: unknown, min: number, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return '必须是有限数字';
  if (value < min || value > max) return `必须在 ${min}–${max}`;
  return undefined;
}

/**
 * 非法字段回落默认，合法则夹紧到控件区间。
 * 没给 waves 时沿用当前运行时配置：调试面板只改出兵窗口，不该顺手清空每波覆盖。
 */
export function sanitizeEndlessConfigDraft(values: Partial<EndlessConfigDraft>): EndlessConfigDraft {
  return buildDraft(values, defaultDraft.waveSeconds, liveDraft.waves);
}

/**
 * 清洗草稿的实现体，显式传入回落值。
 * 模块初始化时 defaultDraft/liveDraft 还没赋值，不能反过来读它们。
 */
function buildDraft(
  values: Partial<EndlessConfigDraft>,
  fallbackSeconds: number,
  fallbackWaves: readonly EndlessWaveDraft[],
): EndlessConfigDraft {
  const seconds = typeof values.waveSeconds === 'number' && Number.isFinite(values.waveSeconds)
    ? clampEndlessWaveSeconds(values.waveSeconds)
    : fallbackSeconds;
  const waves = values.waves === undefined
    ? fallbackWaves.map((wave) => ({ ...wave }))
    : sanitizeWaveDrafts(values.waves);
  return { waveSeconds: seconds, waves };
}

/** 只改全局出兵窗口，保留每波覆盖项；调试面板逐次输入时用。 */
export function applyEndlessWaveSeconds(seconds: number): void {
  applyEndlessConfigDraft({
    waveSeconds: Number.isFinite(seconds) ? seconds : liveDraft.waveSeconds,
    waves: liveDraft.waves,
  });
}

/**
 * 清洗每波覆盖项：丢掉坏数据、按波号去重并升序。
 * 同一波出现多次时保留第一条，避免配置页手滑写成两行后行为不可预期。
 */
function sanitizeWaveDrafts(raw: unknown): EndlessWaveDraft[] {
  if (!Array.isArray(raw)) return [];
  const byWave = new Map<number, EndlessWaveDraft>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const wave = Number(entry.wave);
    if (!Number.isInteger(wave) || wave < 1 || wave > ENDLESS_WAVE_ROWS_MAX) continue;
    if (byWave.has(wave)) continue;
    const draft: EndlessWaveDraft = { wave };
    const window = clampOptional(entry.waveSeconds, ENDLESS_WAVE_SECONDS_MIN, ENDLESS_WAVE_SECONDS_MAX);
    if (window !== undefined) draft.waveSeconds = window;
    const budget = clampOptional(entry.budget, ENDLESS_WAVE_BUDGET_MIN, ENDLESS_WAVE_BUDGET_MAX);
    if (budget !== undefined) draft.budget = budget;
    const interval = clampOptional(entry.intervalSeconds, ENDLESS_WAVE_INTERVAL_MIN, ENDLESS_WAVE_INTERVAL_MAX);
    if (interval !== undefined) draft.intervalSeconds = interval;
    const units = sanitizeWaveUnits(entry.units);
    if (units.length > 0) draft.units = units;
    byWave.set(wave, draft);
  }
  return [...byWave.values()].sort((left, right) => left.wave - right.wave);
}

/** 兵种池清洗：未知兵种剔除，同兵种只保留第一次出现的权重。 */
function sanitizeWaveUnits(raw: unknown): EndlessWaveUnitDraft[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<UnitTypeId>();
  const units: EndlessWaveUnitDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const typeId = entry.typeId as UnitTypeId;
    if (!UNIT_TYPE_IDS.includes(typeId) || seen.has(typeId)) continue;
    const weight = clampOptional(entry.weight, ENDLESS_UNIT_WEIGHT_MIN, ENDLESS_UNIT_WEIGHT_MAX);
    // 权重缺失时按 1 处理：宁可多买点，也别让这一波空着
    units.push({ typeId, weight: weight ?? 1 });
    seen.add(typeId);
    if (units.length >= ENDLESS_WAVE_UNITS_MAX) break;
  }
  return units;
}

/** 可选数值夹紧；缺失或非法返回 undefined，表示继续走公式。 */
function clampOptional(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

/** 覆盖运行时默认配置；下一波生成会读到。 */
export function applyEndlessConfigDraft(draft: EndlessConfigDraft): void {
  const error = validateEndlessConfigDraft(draft);
  if (error) throw new Error(error);
  liveDraft = sanitizeEndlessConfigDraft(draft);
}

/** 恢复到最近一次成功写回（或初始加载）的快照。 */
export function resetEndlessConfigToDefault(): void {
  liveDraft = cloneDraft(defaultDraft);
}

/** 连写回快照一起回到模块加载时的 JSON，供测试隔离。 */
export function restoreEndlessConfigFromFile(): void {
  defaultDraft = cloneDraft(initialDraft);
  liveDraft = cloneDraft(initialDraft);
}

/** 成功写回 JSON 后，把当前草稿设为后续重置基准。 */
export function captureEndlessConfigAsDefault(): void {
  defaultDraft = cloneDraft(liveDraft);
}

/** 深拷贝草稿：调用方改返回值时不污染运行时配置。 */
function cloneDraft(draft: EndlessConfigDraft): EndlessConfigDraft {
  return {
    waveSeconds: draft.waveSeconds,
    waves: draft.waves.map((wave) => ({
      ...wave,
      ...(wave.units ? { units: wave.units.map((unit) => ({ ...unit })) } : {}),
    })),
  };
}

function parseEndlessConfigDraft(value: unknown): EndlessConfigDraft | null {
  if (validateEndlessConfigDraft(value)) return null;
  const rec = value as Partial<EndlessConfigDraft>;
  // 显式给回落值：模块初始化时 defaultDraft/liveDraft 还没赋值
  return buildDraft(
    { waveSeconds: clampEndlessWaveSeconds(rec.waveSeconds as number), waves: rec.waves ?? [] },
    fallbackDraft.waveSeconds,
    [],
  );
}
