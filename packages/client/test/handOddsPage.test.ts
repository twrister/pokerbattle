// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BALANCE_OPTIONS } from '@pb/sim';
import { createHandOddsPage } from '../src/ui/handOddsPage.js';

const { runBalanceAnalysis, syncUnitConfigsForBalance } = vi.hoisted(() => ({
  runBalanceAnalysis: vi.fn(),
  syncUnitConfigsForBalance: vi.fn(),
}));

vi.mock('@pb/sim', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pb/sim')>();
  return {
    ...actual,
    runBalanceAnalysis,
  };
});

vi.mock('../src/debug/unitConfigDraftUi.js', () => ({
  syncUnitConfigsForBalance,
}));

function mountDom(): void {
  document.body.innerHTML = `
    <main id="hand-odds" class="is-hidden" aria-hidden="true">
      <button id="btn-hand-odds-back" type="button">返回卡组阵型</button>
      <button id="hand-odds-tab-odds" class="is-active" type="button" aria-selected="true"></button>
      <button id="hand-odds-tab-balance" type="button" aria-selected="false"></button>
      <section id="hand-odds-odds-panel"></section>
      <section id="hand-odds-balance-panel" class="is-hidden"></section>
      <input id="hand-odds-hand-size" type="range" min="5" max="12" value="10" />
      <strong id="hand-odds-hand-size-value">10</strong>
      <select id="hand-odds-trials"></select>
      <button id="btn-hand-odds-run" type="button"></button>
      <button id="btn-hand-odds-sweep" type="button"></button>
      <div id="hand-odds-status"></div>
      <table><tbody id="hand-odds-table-body"></tbody></table>
      <div id="hand-odds-chart"></div>
      <div id="hand-odds-legend"></div>
      <select id="hand-balance-mode">
        <option value="all">独立+混战</option>
        <option value="solo">仅独立</option>
        <option value="melee">仅混战</option>
      </select>
      <input id="hand-balance-seeds" type="number" value="6" />
      <input id="hand-balance-rounds" type="number" value="400" />
      <input id="hand-balance-team-size" type="number" value="3" />
      <input id="hand-balance-seed" type="number" value="1" />
      <button id="btn-hand-balance-run" type="button"></button>
      <div id="hand-balance-progress"></div>
      <div id="hand-balance-body"></div>
    </main>
  `;
}

describe('牌型验证页', () => {
  beforeEach(() => {
    mountDom();
    runBalanceAnalysis.mockReset();
    syncUnitConfigsForBalance.mockReset();
    syncUnitConfigsForBalance.mockResolvedValue({ applied: true });
    runBalanceAnalysis.mockResolvedValue({
      entries: [],
      soloRatings: null,
      meleeRatings: null,
      pairs: [],
      soloViolations: [],
      meleeViolations: [],
      sharedViolations: [],
      seeds: 2,
      meleeRounds: 20,
    });
  });

  it('默认停在牌型概率，可切到强度验证并带出默认参数', () => {
    const onBack = vi.fn();
    const page = createHandOddsPage({ onBack });
    page.show();

    expect(document.querySelector('#hand-odds-odds-panel')?.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector('#hand-odds-balance-panel')?.classList.contains('is-hidden')).toBe(true);
    expect(document.querySelector<HTMLSelectElement>('#hand-balance-mode')?.value).toBe(
      DEFAULT_BALANCE_OPTIONS.mode,
    );
    expect(document.querySelector<HTMLInputElement>('#hand-balance-seeds')?.value).toBe(
      String(DEFAULT_BALANCE_OPTIONS.seeds),
    );
    expect(document.querySelector<HTMLInputElement>('#hand-balance-rounds')?.value).toBe(
      String(DEFAULT_BALANCE_OPTIONS.rounds),
    );

    document.querySelector<HTMLButtonElement>('#hand-odds-tab-balance')!.click();
    expect(document.querySelector('#hand-odds-odds-panel')?.classList.contains('is-hidden')).toBe(true);
    expect(document.querySelector('#hand-odds-balance-panel')?.classList.contains('is-hidden')).toBe(false);

    document.querySelector<HTMLButtonElement>('#btn-hand-odds-back')!.click();
    expect(onBack).toHaveBeenCalledOnce();
    page.dispose();
  });

  it('仅独立模式会关掉混战轮次与人数', () => {
    const page = createHandOddsPage({ onBack: vi.fn() });
    page.show('balance');

    const mode = document.querySelector<HTMLSelectElement>('#hand-balance-mode')!;
    const rounds = document.querySelector<HTMLInputElement>('#hand-balance-rounds')!;
    const teamSize = document.querySelector<HTMLInputElement>('#hand-balance-team-size')!;
    const seeds = document.querySelector<HTMLInputElement>('#hand-balance-seeds')!;
    expect(rounds.disabled).toBe(false);
    expect(seeds.disabled).toBe(false);

    mode.value = 'solo';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    expect(rounds.disabled).toBe(true);
    expect(teamSize.disabled).toBe(true);
    expect(seeds.disabled).toBe(false);

    mode.value = 'melee';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    expect(rounds.disabled).toBe(false);
    expect(seeds.disabled).toBe(true);
    page.dispose();
  });

  it('开始验证时把页面上的轮次等参数传给对拆', async () => {
    const page = createHandOddsPage({ onBack: vi.fn() });
    page.show('balance');

    const mode = document.querySelector<HTMLSelectElement>('#hand-balance-mode')!;
    mode.value = 'solo';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector<HTMLInputElement>('#hand-balance-seeds')!.value = '2';
    document.querySelector<HTMLInputElement>('#hand-balance-rounds')!.value = '40';
    document.querySelector<HTMLInputElement>('#hand-balance-team-size')!.value = '4';
    document.querySelector<HTMLInputElement>('#hand-balance-seed')!.value = '9';

    document.querySelector<HTMLButtonElement>('#btn-hand-balance-run')!.click();
    await vi.waitFor(() => {
      expect(runBalanceAnalysis).toHaveBeenCalledOnce();
    });
    expect(runBalanceAnalysis.mock.calls[0]?.[0]).toEqual({
      mode: 'solo',
      seeds: 2,
      rounds: 40,
      teamSize: 4,
      seed: 9,
    });
    await vi.waitFor(() => {
      expect(document.querySelector('#hand-balance-progress')?.textContent).toContain('完成');
    });
    page.dispose();
  });

  it('开始验证前先刷草稿并同步单位配置，再跑对拆', async () => {
    let resolveSync: (value: { applied: true }) => void = () => {};
    syncUnitConfigsForBalance.mockReturnValue(
      new Promise((resolve) => {
        resolveSync = resolve;
      }),
    );
    const onBeforeBalance = vi.fn();
    const page = createHandOddsPage({ onBack: vi.fn(), onBeforeBalance });
    page.show('balance');

    document.querySelector<HTMLButtonElement>('#btn-hand-balance-run')!.click();
    await Promise.resolve();
    expect(onBeforeBalance).toHaveBeenCalledOnce();
    expect(syncUnitConfigsForBalance).toHaveBeenCalledOnce();
    expect(onBeforeBalance.mock.invocationCallOrder[0]).toBeLessThan(
      syncUnitConfigsForBalance.mock.invocationCallOrder[0]!,
    );
    expect(runBalanceAnalysis).not.toHaveBeenCalled();
    expect(document.querySelector('#hand-balance-progress')?.textContent).toBe('正在同步单位配置…');

    resolveSync({ applied: true });
    await vi.waitFor(() => {
      expect(runBalanceAnalysis).toHaveBeenCalledOnce();
    });
    page.dispose();
  });

  it('同步单位配置失败时停止验证并展示原因', async () => {
    syncUnitConfigsForBalance.mockRejectedValue(new Error('读取单位配置失败：units.json is not valid JSON'));
    const page = createHandOddsPage({ onBack: vi.fn() });
    page.show('balance');

    document.querySelector<HTMLButtonElement>('#btn-hand-balance-run')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('#hand-balance-progress')?.textContent).toBe(
        '验证失败：读取单位配置失败：units.json is not valid JSON',
      );
    });
    expect(runBalanceAnalysis).not.toHaveBeenCalled();
    page.dispose();
  });
});
