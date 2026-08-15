// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BALANCE_OPTIONS, DEFAULT_MIX_MATCHUP_OPTIONS } from '@pb/sim';
import { createHandOddsPage } from '../src/ui/handOddsPage.js';

const {
  runBalanceAnalysis,
  runMixSingleGame,
  syncUnitConfigsForBalance,
  createMixFrameView,
  createMixReplayModal,
} = vi.hoisted(() => ({
  runBalanceAnalysis: vi.fn(),
  runMixSingleGame: vi.fn(),
  syncUnitConfigsForBalance: vi.fn(),
  createMixFrameView: vi.fn(),
  createMixReplayModal: vi.fn(),
}));

vi.mock('@pb/sim', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pb/sim')>();
  return {
    ...actual,
    runBalanceAnalysis,
    runMixSingleGame,
  };
});

vi.mock('../src/debug/unitConfigDraftUi.js', () => ({
  syncUnitConfigsForBalance,
}));

vi.mock('../src/view/mixFrameView.js', () => ({
  createMixFrameView,
}));

vi.mock('../src/ui/mixReplayModal.js', () => ({
  createMixReplayModal,
}));

function mountDom(): void {
  document.body.innerHTML = `
    <main id="hand-odds" class="is-hidden" aria-hidden="true">
      <button id="btn-hand-odds-back" type="button">返回卡组阵型</button>
      <button id="hand-odds-tab-odds" class="is-active" type="button" aria-selected="true"></button>
      <button id="hand-odds-tab-balance" type="button" aria-selected="false"></button>
      <button id="hand-odds-tab-mix" type="button" aria-selected="false"></button>
      <section id="hand-odds-odds-panel"></section>
      <section id="hand-odds-balance-panel" class="is-hidden"></section>
      <section id="hand-odds-mix-panel" class="is-hidden">
        <div id="hand-mix-base-list"></div>
        <button id="btn-hand-mix-base-add" type="button">添加兵种</button>
        <div id="hand-mix-a-list"></div>
        <button id="btn-hand-mix-a-add" type="button">添加兵种</button>
        <div id="hand-mix-b-list"></div>
        <button id="btn-hand-mix-b-add" type="button">添加兵种</button>
        <input id="hand-mix-seed" type="number" value="1" />
        <input id="hand-mix-max-ticks" type="number" value="1200" />
        <input id="hand-mix-row-width" type="number" value="5" />
        <input id="hand-mix-draw-threshold" type="number" value="5" />
        <button id="btn-hand-mix-run" type="button"></button>
        <div id="hand-mix-progress"></div>
        <div id="hand-mix-body"></div>
      </section>
      <div id="hand-mix-replay" class="is-hidden">
        <h2 id="hand-mix-replay-title"></h2>
        <p id="hand-mix-replay-meta"></p>
        <div id="hand-mix-replay-canvas"></div>
        <span id="hand-mix-replay-alive"></span>
        <span id="hand-mix-replay-time"></span>
        <div id="hand-mix-replay-bar-a"></div>
        <div id="hand-mix-replay-bar-b"></div>
        <span id="hand-mix-replay-label-a"></span>
        <span id="hand-mix-replay-label-b"></span>
        <button id="btn-hand-mix-replay-play" type="button">播放</button>
        <select id="hand-mix-replay-speed"><option value="1" selected>1x</option></select>
        <input id="hand-mix-replay-seek" type="range" min="0" max="1" value="0" />
        <button id="btn-hand-mix-replay-close" type="button">关闭</button>
      </div>
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
  const replayOpen = vi.fn();
  const replayClose = vi.fn();
  const replayDispose = vi.fn();

  beforeEach(() => {
    mountDom();
    runBalanceAnalysis.mockReset();
    runMixSingleGame.mockReset();
    createMixFrameView.mockReset();
    createMixReplayModal.mockReset();
    syncUnitConfigsForBalance.mockReset();
    replayOpen.mockReset();
    replayClose.mockReset();
    replayDispose.mockReset();
    syncUnitConfigsForBalance.mockResolvedValue({ applied: true });
    createMixReplayModal.mockReturnValue({
      open: replayOpen,
      close: replayClose,
      dispose: replayDispose,
    });
    createMixFrameView.mockImplementation(() => ({
      showFrame: vi.fn((_setup, tick: number) => ({
        tick,
        aliveA: tick === 0 ? 10 : 4,
        aliveB: tick === 0 ? 10 : 0,
        hpFracA: tick === 0 ? 1 : 0.4,
        hpFracB: tick === 0 ? 1 : 0,
        settled: tick !== 0,
      })),
      resize: vi.fn(),
      dispose: vi.fn(),
    }));
    runMixSingleGame.mockReturnValue({
      index: 1,
      round: 1,
      swap: false,
      seed: 1,
      winner: 'a',
      timeout: false,
      hpFracA: 0.4,
      hpFracB: 0.1,
      ticks: 200,
      replay: {
        unitsA: [{ typeId: 'melee_grunt', count: 5 }],
        unitsB: [{ typeId: 'melee_grunt', count: 5 }],
        seed: 1,
        swap: false,
        rowWidth: 5,
        maxTicks: 1200,
        drawThreshold: 0.05,
      },
    });
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

  it('搭配对比兵种下拉含三种箭塔', () => {
    const page = createHandOddsPage({ onBack: vi.fn() });
    page.show('mix');

    const options = [...document.querySelectorAll('#hand-mix-base-list .hand-mix-type option')].map(
      (option) => (option as HTMLOptionElement).value,
    );
    expect(options).toContain('building_tower');
    expect(options).toContain('building_tower_advanced');
    expect(options).toContain('building_tower_triple');
    expect(options.indexOf('building_tower')).toBeLessThan(options.indexOf('building_tower_advanced'));
    expect(options.indexOf('building_tower_advanced')).toBeLessThan(options.indexOf('building_tower_triple'));
    expect(options).not.toContain('building_base');
    expect(options).not.toContain('giant_bomb');
    page.dispose();
  });

  it('可切到搭配对比，并带出默认基底与参数', () => {
    const page = createHandOddsPage({ onBack: vi.fn() });
    page.show();

    expect(document.querySelector('#hand-odds-mix-panel')?.classList.contains('is-hidden')).toBe(true);
    document.querySelector<HTMLButtonElement>('#hand-odds-tab-mix')!.click();
    expect(document.querySelector('#hand-odds-odds-panel')?.classList.contains('is-hidden')).toBe(true);
    expect(document.querySelector('#hand-odds-mix-panel')?.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelectorAll('#hand-mix-base-list .hand-mix-row')).toHaveLength(
      DEFAULT_MIX_MATCHUP_OPTIONS.base.length,
    );
    expect(document.querySelector<HTMLInputElement>('#hand-mix-seed')?.value).toBe(
      String(DEFAULT_MIX_MATCHUP_OPTIONS.seed),
    );
    page.dispose();
  });

  it('增删混入行后把双方兵种列表和数值参数传给混编对局', async () => {
    const page = createHandOddsPage({ onBack: vi.fn() });
    page.show('mix');

    document.querySelector<HTMLButtonElement>('#btn-hand-mix-a-add')!.click();
    const aRow = document.querySelector('#hand-mix-a-list .hand-mix-row')!;
    aRow.querySelector<HTMLSelectElement>('.hand-mix-type')!.value = 'melee_golem';
    aRow.querySelector<HTMLInputElement>('.hand-mix-count')!.value = '3';

    document.querySelector<HTMLButtonElement>('#btn-hand-mix-b-add')!.click();
    document.querySelector<HTMLButtonElement>('#btn-hand-mix-b-add')!.click();
    const bRows = document.querySelectorAll('#hand-mix-b-list .hand-mix-row');
    expect(bRows).toHaveLength(2);
    bRows[0]!.querySelector<HTMLSelectElement>('.hand-mix-type')!.value = 'melee_guard';
    bRows[0]!.querySelector<HTMLInputElement>('.hand-mix-count')!.value = '2';
    bRows[1]!.querySelector<HTMLButtonElement>('.hand-mix-remove')!.click();
    expect(document.querySelectorAll('#hand-mix-b-list .hand-mix-row')).toHaveLength(1);

    document.querySelector<HTMLInputElement>('#hand-mix-seed')!.value = '13';
    document.querySelector<HTMLInputElement>('#hand-mix-max-ticks')!.value = '600';
    document.querySelector<HTMLInputElement>('#hand-mix-row-width')!.value = '4';
    document.querySelector<HTMLInputElement>('#hand-mix-draw-threshold')!.value = '10';

    document.querySelector<HTMLButtonElement>('#btn-hand-mix-run')!.click();
    await vi.waitFor(() => {
      expect(runMixSingleGame).toHaveBeenCalledOnce();
    });
    expect(runMixSingleGame.mock.calls[0]?.[0]).toEqual({
      base: [
        { typeId: 'melee_grunt', count: 5 },
        { typeId: 'ranged_archer', count: 5 },
      ],
      mixA: [{ typeId: 'melee_golem', count: 3 }],
      mixB: [{ typeId: 'melee_guard', count: 2 }],
      seed: 13,
      maxTicks: 600,
      rowWidth: 4,
      drawThreshold: 0.1,
    });
    await vi.waitFor(() => {
      expect(document.querySelector('#hand-mix-progress')?.textContent).toContain('完成');
    });
    expect(document.querySelector('#hand-mix-body')?.textContent).toContain('开局');
    expect(document.querySelector('#hand-mix-body')?.textContent).toContain('结束');
    expect(document.querySelectorAll('.hand-mix-hp-row')).toHaveLength(4);
    const bars = [...document.querySelectorAll<HTMLElement>('.hand-mix-hp-bar')];
    expect(bars.map((bar) => Number.parseFloat(bar.style.width))).toEqual([100, 100, 40, 0]);
    expect(document.querySelectorAll('.hand-mix-replay-open')).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('.hand-mix-replay-open')!.click();
    expect(replayOpen).toHaveBeenCalledOnce();
    expect(replayOpen.mock.calls[0]?.[0]).toMatchObject({ ticks: 200, winner: 'a' });
    expect(createMixFrameView).toHaveBeenCalledTimes(2);
    const showFrames = createMixFrameView.mock.results.map(
      (result) => (result.value as { showFrame: ReturnType<typeof vi.fn> }).showFrame,
    );
    expect(showFrames[0]).toHaveBeenCalledWith(expect.anything(), 0);
    expect(showFrames[1]).toHaveBeenCalledWith(expect.anything(), 200);
    page.dispose();
  });

  it('搭配对比数值越界时回落到合法范围再开跑', async () => {
    const page = createHandOddsPage({ onBack: vi.fn() });
    page.show('mix');

    const seed = document.querySelector<HTMLInputElement>('#hand-mix-seed')!;
    seed.value = '0';
    seed.dispatchEvent(new Event('change', { bubbles: true }));
    expect(seed.value).toBe('1');

    const threshold = document.querySelector<HTMLInputElement>('#hand-mix-draw-threshold')!;
    threshold.value = '-3';
    threshold.dispatchEvent(new Event('change', { bubbles: true }));
    expect(threshold.value).toBe('0');

    document.querySelector<HTMLButtonElement>('#btn-hand-mix-run')!.click();
    await vi.waitFor(() => {
      expect(runMixSingleGame).toHaveBeenCalledOnce();
    });
    expect(runMixSingleGame.mock.calls[0]?.[0]).toMatchObject({
      seed: 1,
      drawThreshold: 0,
    });
    page.dispose();
  });

  it('搭配对比运行中会禁用开始按钮，失败时展示原因', async () => {
    let resolveSync: (value: { applied: true }) => void = () => {};
    syncUnitConfigsForBalance.mockReturnValue(
      new Promise((resolve) => {
        resolveSync = resolve;
      }),
    );
    const page = createHandOddsPage({ onBack: vi.fn() });
    page.show('mix');

    document.querySelector<HTMLButtonElement>('#btn-hand-mix-run')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLButtonElement>('#btn-hand-mix-run')?.disabled).toBe(true);
    });
    expect(syncUnitConfigsForBalance).toHaveBeenCalledOnce();
    expect(runMixSingleGame).not.toHaveBeenCalled();

    page.dispose();
    resolveSync({ applied: true });
  });

  it('同步单位配置失败时停止搭配对比并展示原因', async () => {
    syncUnitConfigsForBalance.mockRejectedValue(new Error('读取单位配置失败：units.json is not valid JSON'));
    const page = createHandOddsPage({ onBack: vi.fn() });
    page.show('mix');

    document.querySelector<HTMLButtonElement>('#btn-hand-mix-run')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('#hand-mix-progress')?.textContent).toBe(
        '对比失败：读取单位配置失败：units.json is not valid JSON',
      );
    });
    expect(runMixSingleGame).not.toHaveBeenCalled();
    page.dispose();
  });
});
