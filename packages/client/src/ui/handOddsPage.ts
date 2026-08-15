import {
  DEFAULT_BALANCE_OPTIONS,
  HAND_CATEGORY_NAMES,
  HAND_CATEGORY_STRENGTH_ORDER,
  HAND_ODDS_DEFAULT_TRIALS,
  HAND_ODDS_MAX_SIZE,
  HAND_ODDS_MIN_SIZE,
  Rng,
  createHitCounters,
  createPokerCards,
  runBalanceAnalysis,
  runHandCategoryOddsChunk,
  toProbabilities,
  type BalanceMode,
  type HandCategory,
  type HandCategoryOddsResult,
} from '@pb/sim';
import { renderBalanceReport } from './balanceReportView.js';

export type HandVerifyTab = 'odds' | 'balance';

export interface HandOddsPageOptions {
  onBack: () => void;
}

export interface HandOddsPageHandle {
  show(tab?: HandVerifyTab): void;
  hide(): void;
  dispose(): void;
}

type ChartMode = 'bar' | 'line';

const TRIAL_OPTIONS = [1000, 5000, 20000] as const;
const CHUNK_TRIALS = 200;
const SEEDS_MIN = 1;
const SEEDS_MAX = 50;
const ROUNDS_MIN = 1;
const ROUNDS_MAX = 4000;
const TEAM_SIZE_MIN = 1;
const TEAM_SIZE_MAX = 8;
const SEED_MIN = 1;
const SEED_MAX = 1_000_000_000;
/** 折线图 12 条线的固定色板，与强度序一一对应。 */
const CATEGORY_COLORS: Readonly<Record<HandCategory, string>> = {
  straight_flush: '#f0c14b',
  bomb: '#ff6b6b',
  rocket: '#ff8fab',
  full_house: '#c77dff',
  flush: '#4cc9f0',
  straight5: '#80ed99',
  straight4: '#99d98c',
  two_pair: '#90e0ef',
  triple: '#adb5bd',
  straight3: '#b8f2e6',
  pair: '#dee2e6',
  single: '#6c757d',
};

/**
 * 开发服牌型验证页：牌型概率蒙特卡洛 + 阵型强度对拆，共用同一入口。
 */
export function createHandOddsPage(options: HandOddsPageOptions): HandOddsPageHandle {
  const root = required<HTMLElement>('#hand-odds');
  const backButton = required<HTMLButtonElement>('#btn-hand-odds-back', root);
  const oddsTab = required<HTMLButtonElement>('#hand-odds-tab-odds', root);
  const balanceTab = required<HTMLButtonElement>('#hand-odds-tab-balance', root);
  const oddsPanel = required<HTMLElement>('#hand-odds-odds-panel', root);
  const balancePanel = required<HTMLElement>('#hand-odds-balance-panel', root);
  const handSizeInput = required<HTMLInputElement>('#hand-odds-hand-size', root);
  const handSizeLabel = required<HTMLElement>('#hand-odds-hand-size-value', root);
  const trialsSelect = required<HTMLSelectElement>('#hand-odds-trials', root);
  const runButton = required<HTMLButtonElement>('#btn-hand-odds-run', root);
  const sweepButton = required<HTMLButtonElement>('#btn-hand-odds-sweep', root);
  const status = required<HTMLElement>('#hand-odds-status', root);
  const tableBody = required<HTMLElement>('#hand-odds-table-body', root);
  const chartRoot = required<HTMLElement>('#hand-odds-chart', root);
  const legendRoot = required<HTMLElement>('#hand-odds-legend', root);
  const modeSelect = required<HTMLSelectElement>('#hand-balance-mode', root);
  const seedsInput = required<HTMLInputElement>('#hand-balance-seeds', root);
  const roundsInput = required<HTMLInputElement>('#hand-balance-rounds', root);
  const teamSizeInput = required<HTMLInputElement>('#hand-balance-team-size', root);
  const seedInput = required<HTMLInputElement>('#hand-balance-seed', root);
  const balanceRunButton = required<HTMLButtonElement>('#btn-hand-balance-run', root);
  const balanceProgress = required<HTMLElement>('#hand-balance-progress', root);
  const balanceBody = required<HTMLElement>('#hand-balance-body', root);

  let handSize = 10;
  let trials = HAND_ODDS_DEFAULT_TRIALS;
  let chartMode: ChartMode = 'bar';
  let barResult: HandCategoryOddsResult | null = null;
  let sweepResults: HandCategoryOddsResult[] | null = null;
  let runToken = 0;
  let balanceSeq = 0;
  let oddsBusy = false;
  let balanceBusy = false;

  const back = (): void => options.onBack();
  backButton.addEventListener('click', back);
  oddsTab.addEventListener('click', () => setTab('odds'));
  balanceTab.addEventListener('click', () => setTab('balance'));
  handSizeInput.addEventListener('input', () => {
    handSize = clampHandSize(Number(handSizeInput.value));
    handSizeLabel.textContent = String(handSize);
  });
  trialsSelect.addEventListener('change', () => {
    trials = Number(trialsSelect.value) || HAND_ODDS_DEFAULT_TRIALS;
  });
  runButton.addEventListener('click', () => void startBarRun());
  sweepButton.addEventListener('click', () => void startSweepRun());
  modeSelect.addEventListener('change', syncBalanceFieldAvailability);
  seedsInput.addEventListener('change', () => clampNumberInput(seedsInput, SEEDS_MIN, SEEDS_MAX));
  roundsInput.addEventListener('change', () => clampNumberInput(roundsInput, ROUNDS_MIN, ROUNDS_MAX));
  teamSizeInput.addEventListener('change', () =>
    clampNumberInput(teamSizeInput, TEAM_SIZE_MIN, TEAM_SIZE_MAX),
  );
  seedInput.addEventListener('change', () => clampNumberInput(seedInput, SEED_MIN, SEED_MAX));
  balanceRunButton.addEventListener('click', () => void startBalance());

  syncControlsFromState();
  renderIdle();
  setTab('odds');

  /** 同步控件默认值到当前状态。 */
  function syncControlsFromState(): void {
    handSizeInput.min = String(HAND_ODDS_MIN_SIZE);
    handSizeInput.max = String(HAND_ODDS_MAX_SIZE);
    handSizeInput.value = String(handSize);
    handSizeLabel.textContent = String(handSize);
    trialsSelect.replaceChildren();
    for (const optionTrials of TRIAL_OPTIONS) {
      const option = document.createElement('option');
      option.value = String(optionTrials);
      option.textContent = String(optionTrials);
      if (optionTrials === trials) option.selected = true;
      trialsSelect.appendChild(option);
    }
    modeSelect.value = DEFAULT_BALANCE_OPTIONS.mode;
    seedsInput.value = String(DEFAULT_BALANCE_OPTIONS.seeds);
    roundsInput.value = String(DEFAULT_BALANCE_OPTIONS.rounds);
    teamSizeInput.value = String(DEFAULT_BALANCE_OPTIONS.teamSize);
    seedInput.value = String(DEFAULT_BALANCE_OPTIONS.seed);
    syncBalanceFieldAvailability();
  }

  /** 按当前模式关掉用不到的强度参数，避免配了却没跑。 */
  function syncBalanceFieldAvailability(): void {
    const mode = readBalanceMode();
    seedsInput.disabled = oddsBusy || balanceBusy || mode === 'melee';
    roundsInput.disabled = oddsBusy || balanceBusy || mode === 'solo';
    teamSizeInput.disabled = oddsBusy || balanceBusy || mode === 'solo';
    seedInput.disabled = oddsBusy || balanceBusy;
    modeSelect.disabled = oddsBusy || balanceBusy;
  }

  function setBusy(): void {
    const busy = oddsBusy || balanceBusy;
    runButton.disabled = busy;
    sweepButton.disabled = busy;
    handSizeInput.disabled = busy;
    trialsSelect.disabled = busy;
    balanceRunButton.disabled = busy;
    oddsTab.disabled = false;
    balanceTab.disabled = false;
    syncBalanceFieldAvailability();
  }

  /** 在概率与强度两栏之间切换，进行中的计算不中断。 */
  function setTab(next: HandVerifyTab): void {
    const oddsActive = next === 'odds';
    oddsTab.classList.toggle('is-active', oddsActive);
    balanceTab.classList.toggle('is-active', !oddsActive);
    oddsTab.setAttribute('aria-selected', String(oddsActive));
    balanceTab.setAttribute('aria-selected', String(!oddsActive));
    oddsPanel.classList.toggle('is-hidden', !oddsActive);
    balancePanel.classList.toggle('is-hidden', oddsActive);
  }

  /** 递增 token，使进行中的分片循环自行退出。 */
  function cancelOddsRun(): void {
    runToken += 1;
    oddsBusy = false;
  }

  /** 作废进行中的对拆，避免切走后旧报告覆盖新结果。 */
  function cancelBalance(): void {
    balanceSeq += 1;
    balanceBusy = false;
  }

  /** 单档手牌张数柱状图计算。 */
  async function startBarRun(): Promise<void> {
    cancelOddsRun();
    const token = runToken;
    oddsBusy = true;
    setBusy();
    chartMode = 'bar';
    sweepResults = null;
    status.textContent = '计算中…';

    const hits = createHitCounters();
    const rng = new Rng(Date.now() ^ (handSize * 9973));
    const deck = createPokerCards();
    let done = 0;

    while (done < trials) {
      if (token !== runToken) return;
      const chunk = Math.min(CHUNK_TRIALS, trials - done);
      runHandCategoryOddsChunk({ handSize, trials: chunk, hits, rng, deck });
      done += chunk;
      status.textContent = `计算中… ${done} / ${trials}`;
      await nextFrame();
      if (token !== runToken) return;
    }

    barResult = {
      handSize,
      trials,
      probabilities: toProbabilities(hits, trials),
    };
    status.textContent = `完成：手牌 ${handSize} 张，抽样 ${trials} 次`;
    renderResults();
    oddsBusy = false;
    setBusy();
  }

  /** 5～12 张扫一遍，画折线对比。 */
  async function startSweepRun(): Promise<void> {
    cancelOddsRun();
    const token = runToken;
    oddsBusy = true;
    setBusy();
    chartMode = 'line';
    barResult = null;
    status.textContent = '对比计算中…';

    const deck = createPokerCards();
    const rng = new Rng(Date.now() ^ 0x5f3759df);
    const results: HandCategoryOddsResult[] = [];
    const sizes: number[] = [];
    for (let size = HAND_ODDS_MIN_SIZE; size <= HAND_ODDS_MAX_SIZE; size += 1) {
      sizes.push(size);
    }
    const totalWork = sizes.length * trials;
    let doneWork = 0;

    for (const size of sizes) {
      if (token !== runToken) return;
      const hits = createHitCounters();
      let done = 0;
      while (done < trials) {
        if (token !== runToken) return;
        const chunk = Math.min(CHUNK_TRIALS, trials - done);
        runHandCategoryOddsChunk({ handSize: size, trials: chunk, hits, rng, deck });
        done += chunk;
        doneWork += chunk;
        status.textContent = `对比计算中… 手牌 ${size} 张 · ${doneWork} / ${totalWork}`;
        await nextFrame();
        if (token !== runToken) return;
      }
      results.push({
        handSize: size,
        trials,
        probabilities: toProbabilities(hits, trials),
      });
    }

    sweepResults = results;
    status.textContent = `对比完成：手牌 ${HAND_ODDS_MIN_SIZE}～${HAND_ODDS_MAX_SIZE} 张，每档抽样 ${trials} 次`;
    renderResults();
    oddsBusy = false;
    setBusy();
  }

  /** 用当前运行时阵型跑独立/混战对拆；参数来自本页控件。 */
  async function startBalance(): Promise<void> {
    const seq = ++balanceSeq;
    balanceBusy = true;
    setBusy();
    balanceBody.replaceChildren();
    const analysis = readBalanceOptions();
    balanceProgress.textContent = '正在开始对拆…';
    try {
      const report = await runBalanceAnalysis(analysis, {
        onProgress: (progress) => {
          if (seq !== balanceSeq) return;
          const label = progress.phase === 'solo' ? '独立对拆' : '混战';
          balanceProgress.textContent = `${label} ${progress.done}/${progress.total}`;
        },
      });
      if (seq !== balanceSeq) return;
      renderBalanceReport(balanceBody, report);
      const shared = report.sharedViolations.length;
      const total = report.soloViolations.length + report.meleeViolations.length;
      balanceProgress.textContent =
        `完成：独立 ${report.seeds} 种子，混战 ${report.meleeRounds} 轮。双侧违例 ${shared} 条，分模式违例 ${total} 条。`;
    } catch (error) {
      if (seq !== balanceSeq) return;
      const message = error instanceof Error ? error.message : String(error);
      balanceProgress.textContent = `验证失败：${message}`;
    } finally {
      if (seq === balanceSeq) {
        balanceBusy = false;
        setBusy();
      }
    }
  }

  /** 从控件读出对拆参数；非法值回落到 CLI 默认。 */
  function readBalanceOptions(): {
    mode: BalanceMode;
    seeds: number;
    rounds: number;
    teamSize: number;
    seed: number;
  } {
    return {
      mode: readBalanceMode(),
      seeds: readClampedInt(seedsInput, DEFAULT_BALANCE_OPTIONS.seeds, SEEDS_MIN, SEEDS_MAX),
      rounds: readClampedInt(roundsInput, DEFAULT_BALANCE_OPTIONS.rounds, ROUNDS_MIN, ROUNDS_MAX),
      teamSize: readClampedInt(
        teamSizeInput,
        DEFAULT_BALANCE_OPTIONS.teamSize,
        TEAM_SIZE_MIN,
        TEAM_SIZE_MAX,
      ),
      seed: readClampedInt(seedInput, DEFAULT_BALANCE_OPTIONS.seed, SEED_MIN, SEED_MAX),
    };
  }

  function readBalanceMode(): BalanceMode {
    const value = modeSelect.value;
    if (value === 'solo' || value === 'melee' || value === 'all') return value;
    return DEFAULT_BALANCE_OPTIONS.mode;
  }

  function renderIdle(): void {
    status.textContent = '选择手牌张数与抽样次数后开始计算';
    tableBody.replaceChildren();
    chartRoot.replaceChildren();
    legendRoot.replaceChildren();
    balanceProgress.textContent = '配置模式、轮次等参数后开始验证';
    balanceBody.replaceChildren();
  }

  function renderResults(): void {
    if (chartMode === 'bar' && barResult) {
      renderTableFromProbabilities(barResult.probabilities);
      renderBarChart(barResult);
      renderLegend(false);
      return;
    }
    if (chartMode === 'line' && sweepResults) {
      const last = sweepResults[sweepResults.length - 1];
      if (last) renderTableFromProbabilities(last.probabilities);
      renderLineChart(sweepResults);
      renderLegend(true);
    }
  }

  function renderTableFromProbabilities(
    probabilities: Readonly<Record<HandCategory, number>>,
  ): void {
    tableBody.replaceChildren();
    for (const category of HAND_CATEGORY_STRENGTH_ORDER) {
      const row = document.createElement('tr');
      const nameCell = document.createElement('td');
      nameCell.textContent = HAND_CATEGORY_NAMES[category];
      const valueCell = document.createElement('td');
      valueCell.textContent = formatPercent(probabilities[category] ?? 0);
      row.append(nameCell, valueCell);
      tableBody.appendChild(row);
    }
  }

  /** 柱状图：横轴牌型（强度序），纵轴概率。 */
  function renderBarChart(result: HandCategoryOddsResult): void {
    const width = 720;
    const height = 320;
    const padL = 48;
    const padR = 16;
    const padT = 20;
    const padB = 72;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const categories = HAND_CATEGORY_STRENGTH_ORDER;
    const barGap = 6;
    const barW = (plotW - barGap * (categories.length - 1)) / categories.length;
    const maxP = Math.max(0.01, ...categories.map((c) => result.probabilities[c] ?? 0));

    const svg = svgEl('svg', {
      viewBox: `0 0 ${width} ${height}`,
      class: 'hand-odds-svg',
      role: 'img',
      'aria-label': `手牌 ${result.handSize} 张各牌型概率柱状图`,
    });

    // 纵轴刻度
    for (let step = 0; step <= 4; step += 1) {
      const ratio = step / 4;
      const y = padT + plotH * (1 - ratio);
      const line = svgEl('line', {
        x1: String(padL),
        y1: String(y),
        x2: String(padL + plotW),
        y2: String(y),
        class: 'hand-odds-grid',
      });
      const label = svgEl('text', {
        x: String(padL - 8),
        y: String(y + 4),
        class: 'hand-odds-axis-label',
        'text-anchor': 'end',
      });
      label.textContent = formatPercent(maxP * ratio);
      svg.append(line, label);
    }

    categories.forEach((category, index) => {
      const p = result.probabilities[category] ?? 0;
      const h = (p / maxP) * plotH;
      const x = padL + index * (barW + barGap);
      const y = padT + plotH - h;
      const rect = svgEl('rect', {
        x: String(x),
        y: String(y),
        width: String(barW),
        height: String(Math.max(h, 0)),
        fill: CATEGORY_COLORS[category],
        class: 'hand-odds-bar',
      });
      rect.setAttribute('title', `${HAND_CATEGORY_NAMES[category]} ${formatPercent(p)}`);
      const label = svgEl('text', {
        x: String(x + barW / 2),
        y: String(padT + plotH + 14),
        class: 'hand-odds-tick-label',
        'text-anchor': 'middle',
        transform: `rotate(-40 ${x + barW / 2} ${padT + plotH + 14})`,
      });
      label.textContent = HAND_CATEGORY_NAMES[category];
      svg.append(rect, label);
    });

    chartRoot.replaceChildren(svg);
  }

  /** 折线图：横轴手牌张数，每条线一个牌型。 */
  function renderLineChart(results: readonly HandCategoryOddsResult[]): void {
    const width = 720;
    const height = 340;
    const padL = 48;
    const padR = 16;
    const padT = 20;
    const padB = 40;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const sizes = results.map((entry) => entry.handSize);
    const maxP = Math.max(
      0.01,
      ...results.flatMap((entry) =>
        HAND_CATEGORY_STRENGTH_ORDER.map((c) => entry.probabilities[c] ?? 0),
      ),
    );
    const xAt = (index: number): number =>
      padL + (sizes.length <= 1 ? plotW / 2 : (index / (sizes.length - 1)) * plotW);
    const yAt = (p: number): number => padT + plotH * (1 - p / maxP);

    const svg = svgEl('svg', {
      viewBox: `0 0 ${width} ${height}`,
      class: 'hand-odds-svg',
      role: 'img',
      'aria-label': '手牌张数与各牌型概率折线对比',
    });

    for (let step = 0; step <= 4; step += 1) {
      const ratio = step / 4;
      const y = padT + plotH * (1 - ratio);
      svg.appendChild(
        svgEl('line', {
          x1: String(padL),
          y1: String(y),
          x2: String(padL + plotW),
          y2: String(y),
          class: 'hand-odds-grid',
        }),
      );
      const label = svgEl('text', {
        x: String(padL - 8),
        y: String(y + 4),
        class: 'hand-odds-axis-label',
        'text-anchor': 'end',
      });
      label.textContent = formatPercent(maxP * ratio);
      svg.appendChild(label);
    }

    sizes.forEach((size, index) => {
      const x = xAt(index);
      const label = svgEl('text', {
        x: String(x),
        y: String(padT + plotH + 22),
        class: 'hand-odds-axis-label',
        'text-anchor': 'middle',
      });
      label.textContent = `${size}张`;
      svg.appendChild(label);
    });

    for (const category of HAND_CATEGORY_STRENGTH_ORDER) {
      const points = results
        .map((entry, index) => `${xAt(index)},${yAt(entry.probabilities[category] ?? 0)}`)
        .join(' ');
      svg.appendChild(
        svgEl('polyline', {
          points,
          fill: 'none',
          stroke: CATEGORY_COLORS[category],
          'stroke-width': '2',
          class: 'hand-odds-line',
        }),
      );
    }

    chartRoot.replaceChildren(svg);
  }

  function renderLegend(showNote: boolean): void {
    legendRoot.replaceChildren();
    for (const category of HAND_CATEGORY_STRENGTH_ORDER) {
      const item = document.createElement('span');
      item.className = 'hand-odds-legend-item';
      const swatch = document.createElement('i');
      swatch.style.background = CATEGORY_COLORS[category];
      const text = document.createElement('span');
      text.textContent = HAND_CATEGORY_NAMES[category];
      item.append(swatch, text);
      legendRoot.appendChild(item);
    }
    if (showNote) {
      const note = document.createElement('p');
      note.className = 'hand-odds-legend-note';
      note.textContent = '折线对比时，右侧表格显示最大张数档的概率。';
      legendRoot.appendChild(note);
    }
  }

  return {
    show(nextTab) {
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
      if (nextTab) setTab(nextTab);
    },
    hide() {
      cancelOddsRun();
      cancelBalance();
      setBusy();
      root.classList.add('is-hidden');
      root.setAttribute('aria-hidden', 'true');
    },
    dispose() {
      cancelOddsRun();
      cancelBalance();
      backButton.removeEventListener('click', back);
    },
  };
}

function clampHandSize(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(HAND_ODDS_MAX_SIZE, Math.max(HAND_ODDS_MIN_SIZE, Math.round(value)));
}

/** 失焦时把非法/越界数字写回合法值，避免控件显示与实际跑的不一致。 */
function clampNumberInput(input: HTMLInputElement, min: number, max: number): void {
  const fallback = Number(input.defaultValue) || min;
  const value = readClampedInt(input, fallback, min, max);
  input.value = String(value);
}

function readClampedInt(input: HTMLInputElement, fallback: number, min: number, max: number): number {
  const value = Number(input.value);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

function required<T extends Element>(selector: string, parent: ParentNode = document): T {
  const el = parent.querySelector(selector);
  if (!el) throw new Error(`缺少节点 ${selector}`);
  return el as T;
}
