import { describe, expect, it } from 'vitest';
import {
  defaultMatchRulesView,
  sanitizeMatchRulesView,
} from '../src/debug/matchRulesView.js';

describe('对局节奏控件视图', () => {
  it('默认值与 sim 规则一致', () => {
    expect(defaultMatchRulesView()).toMatchObject({
      initialHandSize: 4,
      normalPhaseSeconds: 120,
      doubleSpeedPhaseSeconds: 120,
      finalPhaseSeconds: 120,
      normalDrawIntervalSeconds: 5,
      doubleSpeedDrawIntervalSeconds: 3,
      finalDrawIntervalSeconds: 2,
      normalHandLimit: 9,
      doubleSpeedHandLimit: 10,
      finalHandLimit: 11,
    });
  });

  it('非法值回落默认，越界值被夹紧', () => {
    expect(
      sanitizeMatchRulesView({
        initialHandSize: 0,
        normalPhaseSeconds: 1,
        finalDrawIntervalSeconds: 999,
        finalHandLimit: Number.NaN,
      }),
    ).toMatchObject({
      initialHandSize: 1,
      normalPhaseSeconds: 10,
      finalDrawIntervalSeconds: 60,
      finalHandLimit: 11,
    });
  });
});
