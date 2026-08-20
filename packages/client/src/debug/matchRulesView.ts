import {
  applyMatchRulesDraft,
  captureMatchRulesAsDefault,
  clampDrawIntervalSeconds,
  clampFinalUnitTimeScale,
  clampPhaseSeconds,
  dumpMatchRulesDraft,
  sanitizeMatchRulesDraft,
  TICK_RATE,
  type MatchRulesDraft,
  type MatchState,
} from '@pb/sim';

/** 运行控制用的秒/张数视图，与 sim MatchRulesDraft / matchRules.json 一致。 */
export type MatchRulesView = MatchRulesDraft;

export {
  clampDrawIntervalSeconds,
  clampFinalUnitTimeScale,
  clampPhaseSeconds,
};

/** 从当前运行时草稿生成控件初值，单机与联机开局一致。 */
export function defaultMatchRulesView(): MatchRulesView {
  return dumpMatchRulesDraft();
}

/** 把控件值写回当前局；仓库默认由「保存为默认」写 matchRules.json。 */
export function applyMatchRulesView(match: MatchState, view: MatchRulesView): void {
  const next = sanitizeMatchRulesView(view);
  applyMatchRulesDraft(next);
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
  return sanitizeMatchRulesDraft(values);
}

/** POST 到 Vite 开发中间件写盘；preview/build 下接口不存在。 */
export async function persistMatchRulesToFile(
  view: MatchRulesView,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const draft = sanitizeMatchRulesView(view);
  // 先写运行时，写盘失败时本会话下一局仍能用新节奏
  applyMatchRulesDraft(draft);
  try {
    const res = await fetch('/__pb/match-rules', {
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
    captureMatchRulesAsDefault();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

function secondsToTicks(seconds: number): number {
  return Math.max(1, Math.round(seconds * TICK_RATE));
}
