import { afterEach, describe, expect, it } from 'vitest';
import {
  applyMatchRulesDraft,
  defaultMatchRules,
  dumpDefaultMatchRulesDraft,
  dumpMatchRulesDraft,
  resetMatchRulesToDefault,
  restoreMatchRulesFromFile,
  sanitizeMatchRulesDraft,
  TICK_RATE,
  validateMatchRulesDraft,
} from '../src/index.js';

describe('对局节奏配置', () => {
  afterEach(() => {
    restoreMatchRulesFromFile();
  });

  it('文件默认与原先硬编码节奏一致', () => {
    expect(dumpDefaultMatchRulesDraft()).toMatchObject({
      initialHandSize: 4,
      normalPhaseSeconds: 120,
      doubleSpeedPhaseSeconds: 180,
      finalPhaseSeconds: 180,
      settlementPhaseSeconds: 60,
      finalUnitTimeScale: 1.5,
      normalDrawIntervalSeconds: 5,
      doubleSpeedDrawIntervalSeconds: 3,
      finalDrawIntervalSeconds: 2,
      normalHandLimit: 9,
      doubleSpeedHandLimit: 10,
      finalHandLimit: 11,
    });
    expect(defaultMatchRules().phaseDurations.normalTicks).toBe(TICK_RATE * 120);
  });

  it('应用草稿后新默认立刻按秒换算 tick', () => {
    applyMatchRulesDraft({
      ...dumpMatchRulesDraft(),
      normalPhaseSeconds: 30,
      doubleSpeedPhaseSeconds: 40,
    });
    expect(defaultMatchRules().phaseDurations.normalTicks).toBe(TICK_RATE * 30);
    expect(defaultMatchRules().phaseDurations.doubleSpeedTicks).toBe(TICK_RATE * 40);
  });

  it('重置回到写回前快照', () => {
    const before = dumpDefaultMatchRulesDraft();
    applyMatchRulesDraft({
      ...dumpMatchRulesDraft(),
      settlementPhaseSeconds: 20,
    });
    resetMatchRulesToDefault();
    expect(dumpMatchRulesDraft()).toEqual(before);
  });

  it('非法草稿拒绝应用，缺字段校验失败', () => {
    expect(validateMatchRulesDraft(null)).toBe('配置必须是对象');
    expect(validateMatchRulesDraft({ initialHandSize: 4 })).toBe('normalPhaseSeconds 必须是有限数字');
    expect(() => applyMatchRulesDraft({} as never)).toThrow('必须是有限数字');
  });

  it('消毒会夹紧越界值并回落非法字段', () => {
    expect(
      sanitizeMatchRulesDraft({
        ...dumpMatchRulesDraft(),
        initialHandSize: 0,
        normalPhaseSeconds: 1,
        finalUnitTimeScale: 9,
        finalDrawIntervalSeconds: 999,
      }),
    ).toMatchObject({
      initialHandSize: 1,
      normalPhaseSeconds: 10,
      finalUnitTimeScale: 3,
      finalDrawIntervalSeconds: 60,
    });
  });
});
