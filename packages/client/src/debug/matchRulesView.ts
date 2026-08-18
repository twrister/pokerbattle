import {
  FINAL_UNIT_TIME_SCALE_MAX,
  FINAL_UNIT_TIME_SCALE_MIN,
  TICK_RATE,
  clampHandSize,
  defaultMatchRules,
  type MatchState,
} from '@pb/sim';

const DRAW_INTERVAL_MIN = 0.25;
const DRAW_INTERVAL_MAX = 60;
const PHASE_SECONDS_MIN = 10;
const PHASE_SECONDS_MAX = 600;

/** 运行控制用的秒/张数视图，与 sim MatchRules 一一对应。 */
export interface MatchRulesView {
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

/** 从 sim 默认规则生成控件初值，单机与联机开局一致。 */
export function defaultMatchRulesView(): MatchRulesView {
  const rules = defaultMatchRules();
  return {
    initialHandSize: rules.initialHandSize,
    normalPhaseSeconds: ticksToSeconds(rules.phaseDurations.normalTicks),
    doubleSpeedPhaseSeconds: ticksToSeconds(rules.phaseDurations.doubleSpeedTicks),
    finalPhaseSeconds: ticksToSeconds(rules.phaseDurations.finalTicks),
    settlementPhaseSeconds: ticksToSeconds(rules.phaseDurations.settlementTicks),
    finalUnitTimeScale: rules.finalUnitTimeScale,
    normalDrawIntervalSeconds: ticksToSeconds(rules.drawIntervals.normalTicks),
    doubleSpeedDrawIntervalSeconds: ticksToSeconds(rules.drawIntervals.doubleSpeedTicks),
    finalDrawIntervalSeconds: ticksToSeconds(rules.drawIntervals.finalTicks),
    normalHandLimit: rules.handLimits.normal,
    doubleSpeedHandLimit: rules.handLimits.doubleSpeed,
    finalHandLimit: rules.handLimits.final,
  };
}

/** 发牌间隔控件合法区间。 */
export function clampDrawIntervalSeconds(seconds: number): number {
  return clampRange(seconds, DRAW_INTERVAL_MIN, DRAW_INTERVAL_MAX);
}

/** 阶段时长控件合法区间。 */
export function clampPhaseSeconds(seconds: number): number {
  return clampRange(seconds, PHASE_SECONDS_MIN, PHASE_SECONDS_MAX);
}

/** 决胜单位加速控件合法区间。 */
export function clampFinalUnitTimeScale(scale: number): number {
  return clampRange(scale, FINAL_UNIT_TIME_SCALE_MIN, FINAL_UNIT_TIME_SCALE_MAX);
}

/** 把控件值写回当前局；不持久化，避免单机与联机分叉。 */
export function applyMatchRulesView(match: MatchState, view: MatchRulesView): void {
  const next = sanitizeMatchRulesView(view);
  match.setInitialHandSize(next.initialHandSize);
  match.setPhaseDurations({
    normalTicks: secondsToTicks(next.normalPhaseSeconds),
    doubleSpeedTicks: secondsToTicks(next.doubleSpeedPhaseSeconds),
    finalTicks: secondsToTicks(next.finalPhaseSeconds),
    settlementTicks: secondsToTicks(next.settlementPhaseSeconds),
  });
  match.setFinalUnitTimeScale(next.finalUnitTimeScale);
  match.setDrawIntervals({
    normalTicks: secondsToTicks(next.normalDrawIntervalSeconds),
    doubleSpeedTicks: secondsToTicks(next.doubleSpeedDrawIntervalSeconds),
    finalTicks: secondsToTicks(next.finalDrawIntervalSeconds),
  });
  match.setHandLimits({
    normal: next.normalHandLimit,
    doubleSpeed: next.doubleSpeedHandLimit,
    final: next.finalHandLimit,
  });
}

/** 非法字段回落默认，合法则夹紧到控件区间。 */
export function sanitizeMatchRulesView(values: Partial<MatchRulesView>): MatchRulesView {
  const fallback = defaultMatchRulesView();
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
  return typeof value === 'number' && Number.isFinite(value) ? clampFinalUnitTimeScale(value) : fallback;
}

function clampRange(seconds: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, seconds));
}

function ticksToSeconds(ticks: number): number {
  return ticks / TICK_RATE;
}

function secondsToTicks(seconds: number): number {
  return Math.max(1, Math.round(seconds * TICK_RATE));
}
