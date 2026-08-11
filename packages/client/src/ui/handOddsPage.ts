import {
  HAND_CATEGORY_NAMES,
  HAND_CATEGORY_STRENGTH_ORDER,
  HAND_ODDS_DEFAULT_TRIALS,
  HAND_ODDS_MAX_SIZE,
  HAND_ODDS_MIN_SIZE,
  Rng,
  createHitCounters,
  createPokerCards,
  runHandCategoryOddsChunk,
  toProbabilities,
  type HandCategory,
  type HandCategoryOddsResult,
} from '@pb/sim';

export interface HandOddsPageOptions {
  onBack: () => void;
}

export interface HandOddsPageHandle {
  show(): void;
  hide(): void;
  dispose(): void;
}

type ChartMode = 'bar' | 'line';

const TRIAL_OPTIONS = [1000, 5000, 20000] as const;
const CHUNK_TRIALS = 200;
/** 折线图 11 条线的固定色板，与强度序一一对应。 */
const CATEGORY_COLORS: Readonly<Record<HandCategory, string>> = {
  straight_flush: '#f0c14b',
  bomb: '#ff6b6b',
  rocket: '#ff8fab',
  full_house: '#c77dff',
  flush: '#4cc9f0',
  straight5: '#80ed99',
  two_pair: '#90e0ef',
  triple: '#adb5bd',
  straight3: '#b8f2e6',
  pair: '#dee2e6',
  single: '#6c757d',
};

/**
 * 开发服牌型概率工具页：蒙特卡洛估计各牌型可打出频率，并用 SVG 柱状/折线对比。
 */
export function createHandOddsPage(options: HandOddsPageOptions): HandOddsPageHandle {
  const root = required<HTMLElement>('#hand-odds');
  const backButton = required<HTMLButtonElement>('#btn-hand-odds-back', root);
  const handSizeInput = required<HTMLInputElement>('#hand-odds-hand-size', root);
  const handSizeLabel = required<HTMLElement>('#hand-odds-hand-size-value', root);
  const trialsSelect = required<HTMLSelectElement>('#hand-odds-trials', root);
  const runButton = required<HTMLButtonElement>('#btn-hand-odds-run', root);
  const sweepButton = required<HTMLButtonElement>('#btn-hand-odds-sweep', root);
  const status = required<HTMLElement>('#hand-odds-status', root);
  const tableBody = required<HTMLElement>('#hand-odds-table-body', root);
  const chartRoot = required<HTMLElement>('#hand-odds-chart', root);
  const legendRoot = required<HTMLElement>('#hand-odds-legend', root);

  let handSize = 10;
  let trials = HAND_ODDS_DEFAULT_TRIALS;
  let chartMode: ChartMode = 'bar';
  let barResult: HandCategoryOddsResult | null = null;
  let sweepResults: HandCategoryOddsResult[] | null = null;
  let runToken = 0;

  const back = (): void => options.onBack();
  backButton.addEventListener('click', back);
  handSizeInput.addEventListener('input', () => {
    handSize = clampHandSize(Number(handSizeInput.value));
    handSizeLabel.textContent = String(handSize);
  });
  trialsSelect.addEventListener('change', () => {
    trials = Number(trialsSelect.value) || HAND_ODDS_DEFAULT_TRIALS;
  });
  runButton.addEventListener('click', () => void startBarRun());
  sweepButton.addEventListener('click', () => void startSweepRun());

  syncControlsFromState();
  renderIdle();

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
  }

  function setBusy(busy: boolean): void {
    runButton.disabled = busy;
    sweepButton.disabled = busy;
    handSizeInput.disabled = busy;
    trialsSelect.disabled = busy;
  }

  /** 递增 token，使进行中的分片循环自行退出。 */
  function cancelRun(): void {
    runToken += 1;
  }

  /** 单档手牌张数柱状图计算。 */
  async function startBarRun(): Promise<void> {
    cancelRun();
    const token = runToken;
    setBusy(true);
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
    setBusy(false);
  }

  /** 5～12 张扫一遍，画折线对比。 */
  async function startSweepRun(): Promise<void> {
    cancelRun();
    const token = runToken;
    setBusy(true);
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
    setBusy(false);
  }

  function renderIdle(): void {
    status.textContent = '选择手牌张数与抽样次数后开始计算';
    tableBody.replaceChildren();
    chartRoot.replaceChildren();
    legendRoot.replaceChildren();
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
    show() {
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
    },
    hide() {
      cancelRun();
      setBusy(false);
      root.classList.add('is-hidden');
      root.setAttribute('aria-hidden', 'true');
    },
    dispose() {
      cancelRun();
      backButton.removeEventListener('click', back);
    },
  };
}

function clampHandSize(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(HAND_ODDS_MAX_SIZE, Math.max(HAND_ODDS_MIN_SIZE, Math.round(value)));
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
