import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchState, restoreMatchRulesFromFile, TICK_RATE } from '@pb/sim';
import {
  applyMatchRulesView,
  defaultMatchRulesView,
  persistMatchRulesToFile,
  sanitizeMatchRulesView,
} from '../src/debug/matchRulesView.js';

afterEach(() => {
  restoreMatchRulesFromFile();
  vi.unstubAllGlobals();
});

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

  it('写盘成功后把草稿设为运行时默认', async () => {
    const view = {
      ...defaultMatchRulesView(),
      normalPhaseSeconds: 30,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ ok: true }),
      }),
    );

    await expect(persistMatchRulesToFile(view)).resolves.toEqual({ ok: true });
    expect(defaultMatchRulesView().normalPhaseSeconds).toBe(30);
  });

  it('开发服接口 404 时提示需在 pnpm dev 下保存', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 404,
        ok: false,
        json: async () => ({ error: 'not found' }),
      }),
    );

    await expect(persistMatchRulesToFile(defaultMatchRulesView())).resolves.toEqual({
      ok: false,
      error: '需在 pnpm dev 下保存',
    });
  });
});
