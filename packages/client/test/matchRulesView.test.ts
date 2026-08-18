import { describe, expect, it } from 'vitest';
import { MatchState, TICK_RATE } from '@pb/sim';
import {
  applyMatchRulesView,
  defaultMatchRulesView,
  sanitizeMatchRulesView,
} from '../src/debug/matchRulesView.js';

describe('对局节奏控件视图', () => {
  it('默认值与 sim 规则一致', () => {
    expect(defaultMatchRulesView()).toMatchObject({
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
  });

  it('非法值回落默认，越界值被夹紧', () => {
    expect(
      sanitizeMatchRulesView({
        initialHandSize: 0,
        normalPhaseSeconds: 1,
        settlementPhaseSeconds: 1,
        finalUnitTimeScale: 9,
        finalDrawIntervalSeconds: 999,
        finalHandLimit: Number.NaN,
      }),
    ).toMatchObject({
      initialHandSize: 1,
      normalPhaseSeconds: 10,
      settlementPhaseSeconds: 10,
      finalUnitTimeScale: 3,
      finalDrawIntervalSeconds: 60,
      finalHandLimit: 11,
    });
  });

  it('写回 MatchState 后 HUD 截止帧立刻按新时长计算', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    applyMatchRulesView(match, {
      ...defaultMatchRulesView(),
      normalPhaseSeconds: 30,
      doubleSpeedPhaseSeconds: 30,
      finalPhaseSeconds: 30,
      settlementPhaseSeconds: 30,
    });
    expect(match.getHudDeadlineTick()).toBe(TICK_RATE * 90);
    expect(match.getPhaseDeadlineTick()).toBe(TICK_RATE * 30);
  });
});
