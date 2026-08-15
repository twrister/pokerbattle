import {
  DEFAULT_MIX_MATCHUP_OPTIONS,
  getUnitConfig,
  listMixableUnitTypeIds,
  mixTicksToSeconds,
  runMixSingleGame,
  type MixGameRecord,
  type MixUnitEntry,
  type UnitTypeId,
} from '@pb/sim';
import { syncUnitConfigsForBalance } from '../debug/unitConfigDraftUi.js';
import { createMixFrameView, type MixFrameHandle } from '../view/mixFrameView.js';
import { createMixReplayModal, type MixReplayModalHandle } from './mixReplayModal.js';

export interface MixMatchupPanelOptions {
  root: HTMLElement;
  /** 对拆前把单位参数页未保存草稿刷进暂存。 */
  onBeforeRun?: () => void;
  onBusyChange?: (busy: boolean) => void;
}

export interface MixMatchupPanelHandle {
  setDisabled(disabled: boolean): void;
  cancel(): void;
  dispose(): void;
  isBusy(): boolean;
}

const SEED_MIN = 1;
const SEED_MAX = 1_000_000_000;
const MAX_TICKS_MIN = 1;
const MAX_TICKS_MAX = 8000;
const ROW_WIDTH_MIN = 1;
const ROW_WIDTH_MAX = 12;
const DRAW_THRESHOLD_MIN = 0;
const DRAW_THRESHOLD_MAX = 100;
const COUNT_MIN = 1;
const COUNT_MAX = 20;

/**
 * 牌型验证页「搭配对比」面板：配置基底与双方混入，跑一局并展示首尾帧。
 */
export function createMixMatchupPanel(options: MixMatchupPanelOptions): MixMatchupPanelHandle {
  const root = options.root;
  const baseList = required<HTMLElement>('#hand-mix-base-list', root);
  const baseAdd = required<HTMLButtonElement>('#btn-hand-mix-base-add', root);
  const mixAList = required<HTMLElement>('#hand-mix-a-list', root);
  const mixAAdd = required<HTMLButtonElement>('#btn-hand-mix-a-add', root);
  const mixBList = required<HTMLElement>('#hand-mix-b-list', root);
  const mixBAdd = required<HTMLButtonElement>('#btn-hand-mix-b-add', root);
  const seedInput = required<HTMLInputElement>('#hand-mix-seed', root);
  const maxTicksInput = required<HTMLInputElement>('#hand-mix-max-ticks', root);
  const rowWidthInput = required<HTMLInputElement>('#hand-mix-row-width', root);
  const drawThresholdInput = required<HTMLInputElement>('#hand-mix-draw-threshold', root);
  const runButton = required<HTMLButtonElement>('#btn-hand-mix-run', root);
  const progress = required<HTMLElement>('#hand-mix-progress', root);
  const body = required<HTMLElement>('#hand-mix-body', root);

  const unitOptions = listMixableUnitTypeIds();
  const baseEntries = createUnitEntryList(baseList, baseAdd, DEFAULT_MIX_MATCHUP_OPTIONS.base, unitOptions);
  const mixAEntries = createUnitEntryList(mixAList, mixAAdd, DEFAULT_MIX_MATCHUP_OPTIONS.mixA, unitOptions);
  const mixBEntries = createUnitEntryList(mixBList, mixBAdd, DEFAULT_MIX_MATCHUP_OPTIONS.mixB, unitOptions);

  let seq = 0;
  let busy = false;
  let disabled = false;
  let frames: MixFrameViewPair | null = null;
  const replayModal: MixReplayModalHandle = createMixReplayModal(root.ownerDocument ?? document);

  syncNumericDefaults();
  progress.textContent = '配置基础阵容与双方混入后开始对比';

  const onRun = (): void => {
    void startMix();
  };
  const onSeed = (): void => clampNumberInput(seedInput, SEED_MIN, SEED_MAX);
  const onMaxTicks = (): void => clampNumberInput(maxTicksInput, MAX_TICKS_MIN, MAX_TICKS_MAX);
  const onRowWidth = (): void => clampNumberInput(rowWidthInput, ROW_WIDTH_MIN, ROW_WIDTH_MAX);
  const onDrawThreshold = (): void =>
    clampNumberInput(drawThresholdInput, DRAW_THRESHOLD_MIN, DRAW_THRESHOLD_MAX);

  runButton.addEventListener('click', onRun);
  seedInput.addEventListener('change', onSeed);
  maxTicksInput.addEventListener('change', onMaxTicks);
  rowWidthInput.addEventListener('change', onRowWidth);
  drawThresholdInput.addEventListener('change', onDrawThreshold);

  /** 用当前列表与数值参数跑一局正手对局；seq 递增后旧任务结果会被丢掉。 */
  async function startMix(): Promise<void> {
    const token = ++seq;
    busy = true;
    options.onBusyChange?.(true);
    disposeFrames();
    body.replaceChildren();
    progress.textContent = '正在同步单位配置…';
    try {
      options.onBeforeRun?.();
      await syncUnitConfigsForBalance();
      if (token !== seq) return;
      progress.textContent = '正在开始对比…';
      const record = runMixSingleGame(readOptions());
      if (token !== seq) return;
      frames = renderFramePair(body, record, (next) => replayModal.open(next));
      progress.textContent = `完成：${winnerLabel(record)} · ${mixTicksToSeconds(record.ticks).toFixed(1)} 秒`;
    } catch (error) {
      if (token !== seq) return;
      const message = error instanceof Error ? error.message : String(error);
      progress.textContent = `对比失败：${message}`;
    } finally {
      if (token === seq) {
        busy = false;
        options.onBusyChange?.(false);
      }
    }
  }

  function readOptions(): {
    base: MixUnitEntry[];
    mixA: MixUnitEntry[];
    mixB: MixUnitEntry[];
    seed: number;
    maxTicks: number;
    rowWidth: number;
    drawThreshold: number;
  } {
    return {
      base: baseEntries.read(),
      mixA: mixAEntries.read(),
      mixB: mixBEntries.read(),
      seed: readClampedInt(seedInput, DEFAULT_MIX_MATCHUP_OPTIONS.seed, SEED_MIN, SEED_MAX),
      maxTicks: readClampedInt(
        maxTicksInput,
        DEFAULT_MIX_MATCHUP_OPTIONS.maxTicks,
        MAX_TICKS_MIN,
        MAX_TICKS_MAX,
      ),
      rowWidth: readClampedInt(
        rowWidthInput,
        DEFAULT_MIX_MATCHUP_OPTIONS.rowWidth,
        ROW_WIDTH_MIN,
        ROW_WIDTH_MAX,
      ),
      drawThreshold:
        readClampedInt(
          drawThresholdInput,
          Math.round(DEFAULT_MIX_MATCHUP_OPTIONS.drawThreshold * 100),
          DRAW_THRESHOLD_MIN,
          DRAW_THRESHOLD_MAX,
        ) / 100,
    };
  }

  function syncNumericDefaults(): void {
    seedInput.value = String(DEFAULT_MIX_MATCHUP_OPTIONS.seed);
    maxTicksInput.value = String(DEFAULT_MIX_MATCHUP_OPTIONS.maxTicks);
    rowWidthInput.value = String(DEFAULT_MIX_MATCHUP_OPTIONS.rowWidth);
    drawThresholdInput.value = String(Math.round(DEFAULT_MIX_MATCHUP_OPTIONS.drawThreshold * 100));
  }

  function applyDisabled(): void {
    const locked = disabled || busy;
    runButton.disabled = locked;
    seedInput.disabled = locked;
    maxTicksInput.disabled = locked;
    rowWidthInput.disabled = locked;
    drawThresholdInput.disabled = locked;
    baseEntries.setDisabled(locked);
    mixAEntries.setDisabled(locked);
    mixBEntries.setDisabled(locked);
  }

  function disposeFrames(): void {
    frames?.start.dispose();
    frames?.end.dispose();
    frames = null;
  }

  return {
    setDisabled(next) {
      disabled = next;
      applyDisabled();
    },
    cancel() {
      seq += 1;
      busy = false;
      disposeFrames();
      replayModal.close();
      options.onBusyChange?.(false);
    },
    dispose() {
      seq += 1;
      busy = false;
      disposeFrames();
      replayModal.dispose();
      runButton.removeEventListener('click', onRun);
      seedInput.removeEventListener('change', onSeed);
      maxTicksInput.removeEventListener('change', onMaxTicks);
      rowWidthInput.removeEventListener('change', onRowWidth);
      drawThresholdInput.removeEventListener('change', onDrawThreshold);
      baseEntries.dispose();
      mixAEntries.dispose();
      mixBEntries.dispose();
    },
    isBusy() {
      return busy;
    },
  };
}

interface UnitEntryListHandle {
  read(): MixUnitEntry[];
  setDisabled(disabled: boolean): void;
  dispose(): void;
}

interface MixFrameViewPair {
  start: MixFrameHandle;
  end: MixFrameHandle;
}

/** 可增删的「兵种 + 数量」行列表，基底与双方混入共用。 */
function createUnitEntryList(
  container: HTMLElement,
  addButton: HTMLButtonElement,
  initial: readonly MixUnitEntry[],
  unitOptions: readonly UnitTypeId[],
): UnitEntryListHandle {
  const fallbackType = unitOptions[0] ?? 'melee_grunt';
  const rows: HTMLElement[] = [];

  const onAdd = (): void => {
    addRow({ typeId: fallbackType, count: 1 });
  };
  addButton.addEventListener('click', onAdd);
  for (const entry of initial) addRow(entry);

  function addRow(entry: MixUnitEntry): void {
    const row = document.createElement('div');
    row.className = 'hand-mix-row';

    const typeSelect = document.createElement('select');
    typeSelect.className = 'hand-mix-type';
    typeSelect.setAttribute('aria-label', '兵种');
    for (const typeId of unitOptions) {
      const option = document.createElement('option');
      option.value = typeId;
      option.textContent = getUnitConfig(typeId).name;
      if (typeId === entry.typeId) option.selected = true;
      typeSelect.appendChild(option);
    }
    if (!unitOptions.includes(entry.typeId)) {
      typeSelect.value = fallbackType;
    }

    const countInput = document.createElement('input');
    countInput.className = 'hand-mix-count';
    countInput.type = 'number';
    countInput.min = String(COUNT_MIN);
    countInput.max = String(COUNT_MAX);
    countInput.step = '1';
    countInput.value = String(clampCount(entry.count));
    countInput.setAttribute('aria-label', '数量');
    countInput.addEventListener('change', () => {
      countInput.value = String(readClampedInt(countInput, 1, COUNT_MIN, COUNT_MAX));
    });

    const remove = document.createElement('button');
    remove.className = 'hand-mix-remove';
    remove.type = 'button';
    remove.textContent = '删';
    remove.setAttribute('aria-label', '删除此行');
    remove.addEventListener('click', () => {
      row.remove();
      const index = rows.indexOf(row);
      if (index >= 0) rows.splice(index, 1);
    });

    row.append(typeSelect, countInput, remove);
    container.appendChild(row);
    rows.push(row);
  }

  return {
    read() {
      const entries: MixUnitEntry[] = [];
      for (const row of rows) {
        const typeSelect = row.querySelector<HTMLSelectElement>('.hand-mix-type');
        const countInput = row.querySelector<HTMLInputElement>('.hand-mix-count');
        if (!typeSelect || !countInput) continue;
        const typeId = typeSelect.value as UnitTypeId;
        if (!unitOptions.includes(typeId)) continue;
        entries.push({
          typeId,
          count: readClampedInt(countInput, 1, COUNT_MIN, COUNT_MAX),
        });
      }
      return entries;
    },
    setDisabled(disabled) {
      addButton.disabled = disabled;
      for (const row of rows) {
        row.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
          'select, input, button',
        ).forEach((el) => {
          el.disabled = disabled;
        });
      }
    },
    dispose() {
      addButton.removeEventListener('click', onAdd);
      container.replaceChildren();
      rows.length = 0;
    },
  };
}

/** 并排渲染该局第一帧与最后一帧，并提供回放入口。 */
function renderFramePair(
  root: HTMLElement,
  record: MixGameRecord,
  onReplay: (record: MixGameRecord) => void,
): MixFrameViewPair {
  const wrap = document.createElement('div');
  wrap.className = 'hand-mix-frames';

  const start = createFrameCard(wrap, '开局');
  const end = createFrameCard(wrap, `结束（${mixTicksToSeconds(record.ticks).toFixed(1)} 秒）`);

  const actions = document.createElement('div');
  actions.className = 'hand-mix-frame-actions';
  const replayButton = document.createElement('button');
  replayButton.type = 'button';
  replayButton.className = 'hand-mix-replay-open';
  replayButton.textContent = '回放本局';
  replayButton.setAttribute('aria-label', '回放本次模拟对局');
  replayButton.addEventListener('click', () => onReplay(record));
  actions.appendChild(replayButton);

  root.replaceChildren(wrap, actions);

  const startView = createMixFrameView(start.canvas);
  const startStats = startView.showFrame(record.replay, 0);
  fillFrameMeta(start, startStats.aliveA, startStats.aliveB, startStats.hpFracA, startStats.hpFracB);

  const endView = createMixFrameView(end.canvas);
  const endStats = endView.showFrame(record.replay, record.ticks);
  fillFrameMeta(end, endStats.aliveA, endStats.aliveB, endStats.hpFracA, endStats.hpFracB);

  return { start: startView, end: endView };
}

interface FrameCard {
  canvas: HTMLElement;
  alive: HTMLElement;
  barA: HTMLElement;
  barB: HTMLElement;
  labelA: HTMLElement;
  labelB: HTMLElement;
}

function createFrameCard(parent: HTMLElement, titleText: string): FrameCard {
  const card = document.createElement('section');
  card.className = 'hand-mix-frame';
  const title = document.createElement('h2');
  title.className = 'hand-odds-section-title';
  title.textContent = titleText;
  const canvas = document.createElement('div');
  canvas.className = 'hand-mix-frame-canvas';

  const meta = document.createElement('div');
  meta.className = 'hand-mix-frame-meta';
  const alive = document.createElement('p');
  alive.className = 'hand-odds-legend-note';
  const bars = document.createElement('div');
  bars.className = 'hand-mix-hp-bars';
  const rowA = createHpBarRow('A');
  const rowB = createHpBarRow('B');
  bars.append(rowA.row, rowB.row);
  meta.append(alive, bars);

  card.append(title, canvas, meta);
  parent.appendChild(card);
  return {
    canvas,
    alive,
    barA: rowA.bar,
    barB: rowB.bar,
    labelA: rowA.label,
    labelB: rowB.label,
  };
}

/** 单侧血条：标签 + 轨道填充 + 百分比文字。 */
function createHpBarRow(side: 'A' | 'B'): {
  row: HTMLElement;
  bar: HTMLElement;
  label: HTMLElement;
} {
  const row = document.createElement('div');
  row.className = `hand-mix-hp-row is-${side.toLowerCase()}`;
  const name = document.createElement('span');
  name.className = 'hand-mix-hp-name';
  name.textContent = side;
  const track = document.createElement('div');
  track.className = 'hand-mix-hp-track';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', `${side} 方剩余血量`);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  const bar = document.createElement('div');
  bar.className = 'hand-mix-hp-bar';
  track.appendChild(bar);
  const label = document.createElement('span');
  label.className = 'hand-mix-hp-label';
  row.append(name, track, label);
  return { row, bar, label };
}

/** 写入存活数，并把两侧血条宽度/文案设为剩余血量百分比。 */
function fillFrameMeta(
  card: FrameCard,
  aliveA: number,
  aliveB: number,
  hpFracA: number,
  hpFracB: number,
): void {
  card.alive.textContent = `存活 A ${aliveA} · B ${aliveB}`;
  applyHpBar(card.barA, card.labelA, hpFracA);
  applyHpBar(card.barB, card.labelB, hpFracB);
}

function applyHpBar(bar: HTMLElement, label: HTMLElement, frac: number): void {
  const clamped = Math.max(0, Math.min(1, frac));
  const pct = formatPercent(clamped);
  bar.style.width = `${(clamped * 100).toFixed(2)}%`;
  label.textContent = pct;
  const track = bar.parentElement;
  if (track) {
    track.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
    track.setAttribute('aria-valuetext', pct);
  }
}

function winnerLabel(record: MixGameRecord): string {
  if (record.winner === 'a') return 'A 胜';
  if (record.winner === 'b') return 'B 胜';
  return record.timeout ? '超时平局' : '平局';
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(COUNT_MAX, Math.max(COUNT_MIN, Math.round(value)));
}

function clampNumberInput(input: HTMLInputElement, min: number, max: number): void {
  const fallback = Number(input.defaultValue) || min;
  input.value = String(readClampedInt(input, fallback, min, max));
}

function readClampedInt(input: HTMLInputElement, fallback: number, min: number, max: number): number {
  const value = Number(input.value);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function required<T extends Element>(selector: string, parent: ParentNode): T {
  const el = parent.querySelector(selector);
  if (!el) throw new Error(`缺少节点 ${selector}`);
  return el as T;
}
