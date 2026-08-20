import {
  clampHandSize,
  HAND_LIMIT_DOUBLE_SPEED,
  HAND_LIMIT_FINAL,
  HAND_LIMIT_NORMAL,
  INITIAL_HAND_SIZE,
} from '../cards/deck.js';
import { TICK_RATE } from './tuning.js';
import rawMatchRules from './matchRules.json';

/** 发牌间隔控件合法区间（秒）。 */
export const MATCH_RULES_DRAW_INTERVAL_MIN = 0.25;
export const MATCH_RULES_DRAW_INTERVAL_MAX = 60;
/** 阶段时长控件合法区间（秒）。 */
export const MATCH_RULES_PHASE_SECONDS_MIN = 10;
export const MATCH_RULES_PHASE_SECONDS_MAX = 600;
/** 决胜与结算的单位逻辑加速，默认 1.5 倍。 */
export const DEFAULT_FINAL_UNIT_TIME_SCALE = 1.5;
export const FINAL_UNIT_TIME_SCALE_MIN = 1;
export const FINAL_UNIT_TIME_SCALE_MAX = 3;

/** 调试面板与 matchRules.json 共用的秒/张数草稿。 */
export interface MatchRulesDraft {
  initialHandSize: number;
  normalPhaseSeconds: number;
  doubleSpeedPhaseSeconds: number;
  finalPhaseSeconds: number;
  settlementPhaseSeconds: number;
  finalUnitTimeScale: number;
  normalDrawIntervalSeconds: number;
  doubleSpeedDrawIntervalSeconds: number;
  finalDrawIntervalSeconds: number;
  normalHandLimit: number;
  doubleSpeedHandLimit: number;
  finalHandLimit: number;
}

/** 三阶段补牌周期。 */
export interface MatchDrawIntervals {
  normalTicks: number;
  doubleSpeedTicks: number;
  finalTicks: number;
}

/** 各阶段持续时长。 */
export interface MatchPhaseDurations {
  normalTicks: number;
  doubleSpeedTicks: number;
  finalTicks: number;
  settlementTicks: number;
}

/** 三阶段手牌上限。 */
export interface MatchHandLimits {
  normal: number;
  doubleSpeed: number;
  final: number;
}

/** 单机与联机共用的对局节奏；构造时落到 MatchState。 */
export interface MatchRules {
  initialHandSize: number;
  phaseDurations: MatchPhaseDurations;
  drawIntervals: MatchDrawIntervals;
  handLimits: MatchHandLimits;
  /** 决胜与结算的单位逻辑加速倍率。 */
  finalUnitTimeScale: number;
}

const DRAFT_KEYS = [
  'initialHandSize',
  'normalPhaseSeconds',
  'doubleSpeedPhaseSeconds',
  'finalPhaseSeconds',
  'settlementPhaseSeconds',
  'finalUnitTimeScale',
  'normalDrawIntervalSeconds',
  'doubleSpeedDrawIntervalSeconds',
  'finalDrawIntervalSeconds',
  'normalHandLimit',
  'doubleSpeedHandLimit',
  'finalHandLimit',
] as const satisfies ReadonlyArray<keyof MatchRulesDraft>;

const fallbackDraft: MatchRulesDraft = {
  initialHandSize: INITIAL_HAND_SIZE,
  normalPhaseSeconds: 120,
  doubleSpeedPhaseSeconds: 180,
  finalPhaseSeconds: 180,
  settlementPhaseSeconds: 60,
  finalUnitTimeScale: DEFAULT_FINAL_UNIT_TIME_SCALE,
  normalDrawIntervalSeconds: 5,
  doubleSpeedDrawIntervalSeconds: 3,
  finalDrawIntervalSeconds: 2,
  normalHandLimit: HAND_LIMIT_NORMAL,
  doubleSpeedHandLimit: HAND_LIMIT_DOUBLE_SPEED,
  finalHandLimit: HAND_LIMIT_FINAL,
};

/** 文件快照：非法 JSON 回落到硬编码默认，避免启动失败。 */
const initialDraft = parseMatchRulesDraft(rawMatchRules) ?? cloneDraft(fallbackDraft);
let liveDraft = cloneDraft(initialDraft);
let defaultDraft = cloneDraft(initialDraft);

/** 常规阶段默认时长（秒），取最近一次写回快照。 */
export const DEFAULT_PHASE_DURATION_SECONDS = defaultDraft.normalPhaseSeconds;
export const DEFAULT_PHASE_DURATION_TICKS = secondsToTicks(DEFAULT_PHASE_DURATION_SECONDS);
/** 倍速 / 决胜默认时长（秒）。 */
export const DEFAULT_DOUBLE_SPEED_DURATION_SECONDS = defaultDraft.doubleSpeedPhaseSeconds;
export const DEFAULT_FINAL_DURATION_SECONDS = defaultDraft.finalPhaseSeconds;
export const DEFAULT_DOUBLE_SPEED_DURATION_TICKS = secondsToTicks(
  DEFAULT_DOUBLE_SPEED_DURATION_SECONDS,
);
export const DEFAULT_FINAL_DURATION_TICKS = secondsToTicks(DEFAULT_FINAL_DURATION_SECONDS);
/** 停发后的结算阶段默认时长（秒）。 */
export const DEFAULT_SETTLEMENT_DURATION_SECONDS = defaultDraft.settlementPhaseSeconds;
export const DEFAULT_SETTLEMENT_DURATION_TICKS = secondsToTicks(
  DEFAULT_SETTLEMENT_DURATION_SECONDS,
);
/** 默认进入倍速 / 决胜 / 结算 / 收局的 tick 边界。 */
export const DOUBLE_SPEED_START_TICKS = DEFAULT_PHASE_DURATION_TICKS;
export const FINAL_START_TICKS = DEFAULT_PHASE_DURATION_TICKS + DEFAULT_DOUBLE_SPEED_DURATION_TICKS;
export const SETTLEMENT_START_TICKS = FINAL_START_TICKS + DEFAULT_FINAL_DURATION_TICKS;
export const MATCH_END_TICKS = SETTLEMENT_START_TICKS + DEFAULT_SETTLEMENT_DURATION_TICKS;
export const NORMAL_DRAW_INTERVAL_TICKS = secondsToTicks(defaultDraft.normalDrawIntervalSeconds);
export const DOUBLE_SPEED_DRAW_INTERVAL_TICKS = secondsToTicks(
  defaultDraft.doubleSpeedDrawIntervalSeconds,
);
export const FINAL_DRAW_INTERVAL_TICKS = secondsToTicks(defaultDraft.finalDrawIntervalSeconds);

/** 当前运行时草稿转成 tick 规则，供新开对局与调试面板共用。 */
export function defaultMatchRules(): MatchRules {
  return draftToMatchRules(liveDraft);
}

/** 导出当前运行时草稿，供调试面板与写盘。 */
export function dumpMatchRulesDraft(): MatchRulesDraft {
  return cloneDraft(liveDraft);
}

/** 导出最近一次成功写回（或模块加载）的快照，供重置。 */
export function dumpDefaultMatchRulesDraft(): MatchRulesDraft {
  return cloneDraft(defaultDraft);
}

/** 校验草稿结构；通过返回 undefined。 */
export function validateMatchRulesDraft(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '配置必须是对象';
  const rec = value as Record<string, unknown>;
  for (const key of DRAFT_KEYS) {
    if (typeof rec[key] !== 'number' || !Number.isFinite(rec[key])) {
      return `${key} 必须是有限数字`;
    }
  }
  return undefined;
}

/** 非法字段回落默认，合法则夹紧到控件区间。 */
export function sanitizeMatchRulesDraft(values: Partial<MatchRulesDraft>): MatchRulesDraft {
  return sanitizeMatchRulesDraftWithFallback(values, defaultDraft ?? fallbackDraft);
}

/** 覆盖运行时默认节奏；下一局 new MatchState 会读到。 */
export function applyMatchRulesDraft(draft: MatchRulesDraft): void {
  const error = validateMatchRulesDraft(draft);
  if (error) throw new Error(error);
  liveDraft = sanitizeMatchRulesDraft(draft);
}

/** 恢复到最近一次成功写回（或初始加载）的快照。 */
export function resetMatchRulesToDefault(): void {
  liveDraft = cloneDraft(defaultDraft);
}

/** 连写回快照一起回到模块加载时的 JSON，供测试隔离。 */
export function restoreMatchRulesFromFile(): void {
  defaultDraft = cloneDraft(initialDraft);
  liveDraft = cloneDraft(initialDraft);
}

/** 成功写回 JSON 后，把当前草稿设为后续重置基准。 */
export function captureMatchRulesAsDefault(): void {
  defaultDraft = dumpMatchRulesDraft();
}

/** 发牌间隔控件合法区间。 */
export function clampDrawIntervalSeconds(seconds: number): number {
  return clampRange(seconds, MATCH_RULES_DRAW_INTERVAL_MIN, MATCH_RULES_DRAW_INTERVAL_MAX);
}

/** 阶段时长控件合法区间。 */
export function clampPhaseSeconds(seconds: number): number {
  return clampRange(seconds, MATCH_RULES_PHASE_SECONDS_MIN, MATCH_RULES_PHASE_SECONDS_MAX);
}

/** 决胜单位加速控件合法区间。 */
export function clampFinalUnitTimeScale(scale: number): number {
  return clampRange(scale, FINAL_UNIT_TIME_SCALE_MIN, FINAL_UNIT_TIME_SCALE_MAX);
}

function parseMatchRulesDraft(value: unknown): MatchRulesDraft | null {
  if (validateMatchRulesDraft(value)) return null;
  // 模块初始化时 defaultDraft 尚未赋值，夹紧只能回落硬编码默认
  return sanitizeMatchRulesDraftWithFallback(value as MatchRulesDraft, fallbackDraft);
}

function sanitizeMatchRulesDraftWithFallback(
  values: Partial<MatchRulesDraft>,
  fallback: MatchRulesDraft,
): MatchRulesDraft {
  return {
    initialHandSize: readHandSize(values.initialHandSize, fallback.initialHandSize),
    normalPhaseSeconds: readPhaseSeconds(values.normalPhaseSeconds, fallback.normalPhaseSeconds),
    doubleSpeedPhaseSeconds: readPhaseSeconds(
      values.doubleSpeedPhaseSeconds,
      fallback.doubleSpeedPhaseSeconds,
    ),
    finalPhaseSeconds: readPhaseSeconds(values.finalPhaseSeconds, fallback.finalPhaseSeconds),
    settlementPhaseSeconds: readPhaseSeconds(
      values.settlementPhaseSeconds,
      fallback.settlementPhaseSeconds,
    ),
    finalUnitTimeScale: readUnitTimeScale(values.finalUnitTimeScale, fallback.finalUnitTimeScale),
    normalDrawIntervalSeconds: readDrawInterval(
      values.normalDrawIntervalSeconds,
      fallback.normalDrawIntervalSeconds,
    ),
    doubleSpeedDrawIntervalSeconds: readDrawInterval(
      values.doubleSpeedDrawIntervalSeconds,
      fallback.doubleSpeedDrawIntervalSeconds,
    ),
    finalDrawIntervalSeconds: readDrawInterval(
      values.finalDrawIntervalSeconds,
      fallback.finalDrawIntervalSeconds,
    ),
    normalHandLimit: readHandSize(values.normalHandLimit, fallback.normalHandLimit),
    doubleSpeedHandLimit: readHandSize(values.doubleSpeedHandLimit, fallback.doubleSpeedHandLimit),
    finalHandLimit: readHandSize(values.finalHandLimit, fallback.finalHandLimit),
  };
}

function draftToMatchRules(draft: MatchRulesDraft): MatchRules {
  const next = sanitizeMatchRulesDraft(draft);
  return {
    initialHandSize: next.initialHandSize,
    phaseDurations: {
      normalTicks: secondsToTicks(next.normalPhaseSeconds),
      doubleSpeedTicks: secondsToTicks(next.doubleSpeedPhaseSeconds),
      finalTicks: secondsToTicks(next.finalPhaseSeconds),
      settlementTicks: secondsToTicks(next.settlementPhaseSeconds),
    },
    drawIntervals: {
      normalTicks: secondsToTicks(next.normalDrawIntervalSeconds),
      doubleSpeedTicks: secondsToTicks(next.doubleSpeedDrawIntervalSeconds),
      finalTicks: secondsToTicks(next.finalDrawIntervalSeconds),
    },
    handLimits: {
      normal: next.normalHandLimit,
      doubleSpeed: next.doubleSpeedHandLimit,
      final: next.finalHandLimit,
    },
    finalUnitTimeScale: next.finalUnitTimeScale,
  };
}

function cloneDraft(draft: MatchRulesDraft): MatchRulesDraft {
  return { ...draft };
}

function readDrawInterval(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clampDrawIntervalSeconds(value)
    : fallback;
}

function readPhaseSeconds(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clampPhaseSeconds(value) : fallback;
}

function readHandSize(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clampHandSize(value) : fallback;
}

function readUnitTimeScale(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clampFinalUnitTimeScale(value)
    : fallback;
}

function clampRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function secondsToTicks(seconds: number): number {
  return Math.max(1, Math.round(seconds * TICK_RATE));
}
