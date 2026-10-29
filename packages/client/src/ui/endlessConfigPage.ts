import {
  ENDLESS_UNIT_WEIGHT_MAX,
  ENDLESS_UNIT_WEIGHT_MIN,
  ENDLESS_WAVE_BUDGET_MAX,
  ENDLESS_WAVE_INTERVAL_MIN,
  ENDLESS_WAVE_ROWS_MAX,
  ENDLESS_WAVE_SECONDS_MAX,
  ENDLESS_WAVE_SECONDS_MIN,
  dumpEndlessConfigDraft,
  endlessDefaultUnitCost,
  endlessDefaultWaveUnits,
  endlessWaveFormula,
  isBossWave,
  isBuildingConfig,
  UNIT_CONFIGS,
  UNIT_TYPE_IDS,
  type EndlessConfigDraft,
  type EndlessWaveDraft,
  type EndlessWaveUnitDraft,
  type UnitTypeId,
} from '@pb/sim';
import { persistEndlessConfigToFile, sanitizeEndlessConfigView } from '../debug/endlessConfigView.js';
import { displayUnitName } from './unitCatalog.js';

export interface EndlessConfigPageOptions {
  /** 返回图鉴入口。 */
  onBack: () => void;
}

export interface EndlessConfigPageHandle {
  show(): void;
  hide(): void;
  /** 把当前表单读回草稿（离开页面时保存未提交的编辑）。 */
  flushPending(): void;
  dispose(): void;
}

/** 每波一行的展示状态：override 为空时该行全部显示公式默认值。 */
interface WaveRow {
  wave: number;
  override: EndlessWaveDraft | undefined;
}

/** 表格至少展示的波数，避免配置为空时一片空白无从下手。 */
const MIN_VISIBLE_WAVES = 5;

/**
 * 无限关卡参数页：一行一波，按波号覆盖出兵窗口、预算、出兵间隔与敌方兵种池；
 * 没填的格子沿用公式默认值，超出行数的波次也自动走公式。
 * 视觉与单位参数页共用 unit-stats-* 样式，读起来是同一套开发工具。
 */
export function createEndlessConfigPage(options: EndlessConfigPageOptions): EndlessConfigPageHandle {
  const root = required<HTMLElement>('#endless-config');
  const panelRoot = required<HTMLElement>('#endless-config-panel', root);
  const statusEl = required<HTMLElement>('#endless-config-status', root);
  const backButton = required<HTMLButtonElement>('#btn-endless-config-back', root);
  const saveButton = required<HTMLButtonElement>('#btn-endless-config-save', root);
  const addWaveButton = required<HTMLButtonElement>('#btn-endless-config-add-wave', root);
  const windowInput = required<HTMLInputElement>('#endless-config-wave-seconds', root);

  let draft: EndlessConfigDraft = dumpEndlessConfigDraft();
  let visibleWaves = Math.max(
    MIN_VISIBLE_WAVES,
    draft.waves.reduce((max, wave) => Math.max(max, wave.wave), 0),
  );
  let saveSeq = 0;
  /** 兵种池折页展开的波号：重绘后重新展开，改权重时不会一改就收起。 */
  let reopenUnitsFor: number | undefined;

  backButton.addEventListener('click', () => options.onBack());
  saveButton.addEventListener('click', () => void save());
  addWaveButton.addEventListener('click', () => addWave());
  windowInput.addEventListener('change', () => {
    const seconds = Number(windowInput.value);
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    draft = { ...draft, waveSeconds: clamp(seconds, ENDLESS_WAVE_SECONDS_MIN, ENDLESS_WAVE_SECONDS_MAX) };
    render();
  });

  /** 从当前表单读回草稿，写回运行时与 endless.json。 */
  async function save(): Promise<void> {
    readControlsIntoDraft();
    const seq = ++saveSeq;
    const result = await persistEndlessConfigToFile(sanitizeEndlessConfigView(draft));
    if (seq !== saveSeq) return;
    draft = dumpEndlessConfigDraft();
    if (result.ok) setStatus('已保存并写回 endless.json', false);
    else setStatus(`已应用到运行时（未能写回文件：${result.error}）`, true);
    render();
  }

  function setStatus(text: string, isError: boolean): void {
    statusEl.textContent = text;
    statusEl.dataset.tone = isError ? 'error' : 'ok';
  }

  /** 末尾追加一波：按公式默认值显式落一行，方便直接改数值。 */
  function addWave(): void {
    readControlsIntoDraft();
    if (visibleWaves >= ENDLESS_WAVE_ROWS_MAX) {
      setStatus(`最多配置 ${ENDLESS_WAVE_ROWS_MAX} 波`, true);
      return;
    }
    const wave = visibleWaves + 1;
    visibleWaves = wave;
    const formula = endlessWaveFormula(wave);
    const entry = waveAt(wave);
    entry.budget = round1(formula.budget);
    entry.intervalSeconds = round1(formula.intervalSeconds);
    render();
  }

  /** 取该波覆盖项（没有则新建一条空覆盖），后续改动都写在这条上。 */
  function waveAt(wave: number): EndlessWaveDraft {
    const found = draft.waves.find((entry) => entry.wave === wave);
    if (found) return found;
    const created: EndlessWaveDraft = { wave };
    draft = { ...draft, waves: [...draft.waves, created].sort((a, b) => a.wave - b.wave) };
    return created;
  }

  /** 该波去掉覆盖项，回到公式默认。 */
  function clearWave(wave: number): void {
    draft = { ...draft, waves: draft.waves.filter((entry) => entry.wave !== wave) };
    render();
  }

  function render(): void {
    syncWindowSeconds();
    // 编辑过程中可能留下只剩波号的空覆盖项，先清掉，行状态才与落盘一致
    draft = { ...draft, waves: draft.waves.filter((entry) => !isEmptyWave(entry)) };
    renderToolbar();
    renderTable();
  }

  /** 把工具栏的全局窗口读进草稿：用户可能还没失焦就点了别处。 */
  function syncWindowSeconds(): void {
    const seconds = Number(windowInput.value);
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    draft = { ...draft, waveSeconds: clamp(seconds, ENDLESS_WAVE_SECONDS_MIN, ENDLESS_WAVE_SECONDS_MAX) };
  }

  function renderToolbar(): void {
    windowInput.value = String(draft.waveSeconds);
    addWaveButton.textContent = `添加第 ${visibleWaves + 1} 波`;
    addWaveButton.disabled = visibleWaves >= ENDLESS_WAVE_ROWS_MAX;
  }

  function renderTable(): void {
    const rows = buildRows();
    const maxima = rowMaxima(rows, draft.waveSeconds);

    const wrap = document.createElement('div');
    wrap.className = 'unit-stats-table-wrap';
    const table = document.createElement('table');
    table.className = 'unit-stats-table endless-config-table';
    table.setAttribute('aria-label', '无限关卡参数编辑表');

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const [label, field] of [
      ['波次', 'wave'],
      ['类型', 'boss'],
      ['出兵窗口', 'waveSeconds'],
      ['预算', 'budget'],
      ['出兵间隔', 'intervalSeconds'],
      ['敌方兵种池', 'units'],
      ['操作', 'actions'],
    ] as const) {
      const th = document.createElement('th');
      th.textContent = label;
      th.dataset.field = field;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of rows) tbody.appendChild(makeRow(row, maxima));
    table.appendChild(tbody);
    wrap.appendChild(table);

    panelRoot.replaceChildren(wrap);
  }

  /** 当前要展示的行：覆盖项 + 补齐到最少可见波数。 */
  function buildRows(): WaveRow[] {
    const byWave = new Map(draft.waves.map((entry) => [entry.wave, entry]));
    const rows: WaveRow[] = [];
    for (let wave = 1; wave <= visibleWaves; wave += 1) {
      rows.push({ wave, override: byWave.get(wave) });
    }
    return rows;
  }

  function makeRow(row: WaveRow, maxima: RowMaxima): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.dataset.wave = String(row.wave);
    if (row.override) tr.classList.add('is-custom');

    const waveCell = document.createElement('td');
    waveCell.className = 'endless-config-wave';
    waveCell.textContent = String(row.wave);
    tr.appendChild(waveCell);

    const bossCell = document.createElement('td');
    bossCell.className = 'unit-stats-readonly';
    bossCell.textContent = isBossWave(row.wave) ? 'Boss' : '—';
    tr.appendChild(bossCell);

    const windowCell = document.createElement('td');
    windowCell.dataset.field = 'waveSeconds';
    windowCell.appendChild(
      makeNumberCell(row.wave, 'waveSeconds', row.override?.waveSeconds, String(draft.waveSeconds),
        ENDLESS_WAVE_SECONDS_MIN, ENDLESS_WAVE_SECONDS_MAX, maxima.waveSeconds),
    );
    tr.appendChild(windowCell);

    const formula = endlessWaveFormula(row.wave);
    const budgetCell = document.createElement('td');
    budgetCell.dataset.field = 'budget';
    budgetCell.appendChild(
      makeNumberCell(row.wave, 'budget', row.override?.budget, formatHint(formula.budget),
        undefined, ENDLESS_WAVE_BUDGET_MAX, maxima.budget),
    );
    tr.appendChild(budgetCell);

    const intervalCell = document.createElement('td');
    intervalCell.dataset.field = 'intervalSeconds';
    intervalCell.appendChild(
      makeNumberCell(row.wave, 'intervalSeconds', row.override?.intervalSeconds, formatHint(formula.intervalSeconds),
        ENDLESS_WAVE_INTERVAL_MIN, undefined, maxima.intervalSeconds),
    );
    tr.appendChild(intervalCell);

    tr.appendChild(makeUnitsCell(row));
    tr.appendChild(makeActionsCell(row));
    return tr;
  }

  /** 数值格：空值表示走公式，占位符显示公式值；旁边带相对上界的短条。 */
  function makeNumberCell(
    wave: number,
    field: 'waveSeconds' | 'budget' | 'intervalSeconds',
    value: number | undefined,
    hint: string,
    min: number | undefined,
    max: number | undefined,
    barMax: number,
  ): HTMLElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '1';
    input.dataset.wave = String(wave);
    input.dataset.field = field;
    input.value = value === undefined ? '' : formatHint(value);
    input.placeholder = hint;
    input.title = '留空则按公式生成';
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    input.setAttribute('aria-label', `第 ${wave} 波${FIELD_LABELS[field]}`);
    input.addEventListener('change', () => onNumberChange(wave, field, input.value));

    const barValue = value ?? Number(hint);
    return makeValueWithBar(input, barValue / Math.max(barMax, 1e-6));
  }

  /** 输入框改动落到草稿：空值删字段（回到公式），非法数字直接忽略。 */
  function onNumberChange(
    wave: number,
    field: 'waveSeconds' | 'budget' | 'intervalSeconds',
    raw: string,
  ): void {
    const trimmed = raw.trim();
    const entry = waveAt(wave);
    if (trimmed === '') {
      delete entry[field];
    } else {
      const value = Number(trimmed);
      if (!Number.isFinite(value) || value <= 0) return;
      entry[field] = round1(value);
    }
    pruneIfEmpty(entry);
    render();
  }

  /** 敌方兵种池折页：显示当前池并能增删兵种；没配置时列出默认池。 */
  function makeUnitsCell(row: WaveRow): HTMLTableCellElement {
    const cell = document.createElement('td');
    cell.dataset.field = 'units';
    const details = document.createElement('details');
    details.className = 'unit-stats-more';
    // 改权重会整表重绘，这里记住展开状态，不然每改一格折页就弹回
    if (reopenUnitsFor === row.wave) details.open = true;

    const units = row.override?.units ?? [];
    const summary = document.createElement('summary');
    summary.textContent = units.length > 0 ? `自定义 ${units.length} 种` : '默认池';
    details.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'unit-stats-more-fields';
    if (units.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'endless-config-hint';
      hint.textContent = `按波次解锁：${defaultPoolText(row.wave)}`;
      list.appendChild(hint);
    }
    for (const unit of units) {
      list.appendChild(makeUnitRow(row.wave, unit));
    }
    list.appendChild(makeAddUnitRow(row.wave, units));
    details.appendChild(list);
    cell.appendChild(details);
    return cell;
  }

  /** 单个兵种：名字 + 权重（越大越少出）+ 移除。 */
  function makeUnitRow(wave: number, unit: EndlessWaveUnitDraft): HTMLElement {
    const label = document.createElement('label');
    label.className = 'unit-stats-more-row';
    const caption = document.createElement('span');
    caption.textContent = `${
      displayUnitName(UNIT_CONFIGS[unit.typeId].name)
    } 价值`;

    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.5';
    input.min = String(ENDLESS_UNIT_WEIGHT_MIN);
    input.max = String(ENDLESS_UNIT_WEIGHT_MAX);
    input.dataset.wave = String(wave);
    input.dataset.unit = unit.typeId;
    input.dataset.field = 'weight';
    input.value = formatHint(unit.weight);
    input.addEventListener('change', () => {
      const value = Number(input.value);
      if (!Number.isFinite(value) || value <= 0) return;
      unit.weight = round1(clamp(value, ENDLESS_UNIT_WEIGHT_MIN, ENDLESS_UNIT_WEIGHT_MAX));
      // 权重不影响其它列，不用整表重绘，光标和展开状态都留着
    });
    label.append(caption, input);

    const row = document.createElement('div');
    row.className = 'endless-config-unit-row';
    row.append(label);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.action = 'remove-unit';
    remove.dataset.wave = String(wave);
    remove.dataset.unit = unit.typeId;
    remove.textContent = '移除';
    remove.addEventListener('click', () => {
      const entry = waveAt(wave);
      entry.units = (entry.units ?? []).filter((item) => item.typeId !== unit.typeId);
      pruneIfEmpty(entry);
      reopenUnitsFor = wave;
      render();
      reopenUnitsFor = undefined;
    });
    row.append(remove);
    return row;
  }

  /** 添加兵种：从全部非建筑兵种里挑，权重取内置池的价值。 */
  function makeAddUnitRow(wave: number, units: readonly EndlessWaveUnitDraft[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'endless-config-unit-row';
    const select = document.createElement('select');
    select.dataset.addUnit = String(wave);
    const taken = new Set(units.map((unit) => unit.typeId));
    for (const typeId of UNIT_TYPE_IDS) {
      if (taken.has(typeId) || isBuildingConfig(UNIT_CONFIGS[typeId])) continue;
      const option = document.createElement('option');
      option.value = typeId;
      option.textContent = displayUnitName(UNIT_CONFIGS[typeId].name);
      select.appendChild(option);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.dataset.action = 'add-unit';
    add.dataset.wave = String(wave);
    add.textContent = '添加兵种';
    add.addEventListener('click', () => {
      const typeId = select.value as UnitTypeId;
      if (!typeId) return;
      const entry = waveAt(wave);
      // 第一次自定义时把内置池整份搬过来，用户是在默认基础上做增删
      const base = entry.units ?? endlessDefaultWaveUnits(wave).map((unit) => ({
        typeId: unit.typeId,
        weight: unit.cost,
      }));
      if (base.some((unit) => unit.typeId === typeId)) return;
      entry.units = [...base, { typeId, weight: round1(endlessDefaultUnitCost(typeId)) }];
      reopenUnitsFor = wave;
      render();
      reopenUnitsFor = undefined;
    });
    wrap.append(select, add);
    return wrap;
  }

  /** 有覆盖项才给「恢复公式」，删掉后该波回到默认。 */
  function makeActionsCell(row: WaveRow): HTMLTableCellElement {
    const cell = document.createElement('td');
    if (!row.override) return cell;
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.dataset.action = 'reset-wave';
    reset.dataset.wave = String(row.wave);
    reset.textContent = '恢复公式';
    reset.addEventListener('click', () => clearWave(row.wave));
    cell.appendChild(reset);
    return cell;
  }

  /** 从当前表单读回所有输入值，保存/离开前调用，避免手滑丢输入。 */
  function readControlsIntoDraft(): void {
    const seconds = Number(windowInput.value);
    if (Number.isFinite(seconds) && seconds > 0) {
      draft = { ...draft, waveSeconds: clamp(seconds, ENDLESS_WAVE_SECONDS_MIN, ENDLESS_WAVE_SECONDS_MAX) };
    }
    for (const input of panelRoot.querySelectorAll<HTMLInputElement>('input[data-wave]')) {
      const wave = Number(input.dataset.wave);
      const field = input.dataset.field;
      if (!Number.isFinite(wave) || !field) continue;
      const entry = waveAt(wave);
      if (field === 'weight') {
        const unit = entry.units?.find((item) => item.typeId === input.dataset.unit);
        const value = Number(input.value);
        if (unit && Number.isFinite(value) && value > 0) {
          unit.weight = round1(clamp(value, ENDLESS_UNIT_WEIGHT_MIN, ENDLESS_UNIT_WEIGHT_MAX));
        }
        continue;
      }
      if (field !== 'waveSeconds' && field !== 'budget' && field !== 'intervalSeconds') continue;
      const value = Number(input.value);
      if (input.value.trim() === '' || !Number.isFinite(value) || value <= 0) delete entry[field];
      else entry[field] = round1(value);
      pruneIfEmpty(entry);
    }
    // 只剩波号、没任何字段的覆盖项等价于没配置，落盘前清掉
    draft = { ...draft, waves: draft.waves.filter((entry) => !isEmptyWave(entry)) };
  }

  function show(): void {
    draft = dumpEndlessConfigDraft();
    visibleWaves = Math.max(
      MIN_VISIBLE_WAVES,
      draft.waves.reduce((max, wave) => Math.max(max, wave.wave), 0),
    );
    root.classList.remove('is-hidden');
    root.setAttribute('aria-hidden', 'false');
    // 先落一次输入框初值，否则 render 里的 syncWindowSeconds 会读到上一个页面的残留值
    windowInput.value = String(draft.waveSeconds);
    setStatus('留空 = 按公式生成；改完点保存写回 endless.json', false);
    render();
  }

  function hide(): void {
    readControlsIntoDraft();
    root.classList.add('is-hidden');
    root.setAttribute('aria-hidden', 'true');
  }

  return {
    show,
    hide,
    flushPending() {
      readControlsIntoDraft();
    },
    dispose() {
      panelRoot.replaceChildren();
    },
  };
}

const FIELD_LABELS = {
  waveSeconds: '出兵窗口（秒）',
  budget: '预算',
  intervalSeconds: '出兵间隔（秒）',
} as const;

/** 各行相对条上限：让同一屏内的数值能横向比较。 */
interface RowMaxima {
  waveSeconds: number;
  budget: number;
  intervalSeconds: number;
}

/** 窗口列要连全局默认一起比：没覆盖时那格显示的就是全局值。 */
function rowMaxima(rows: readonly WaveRow[], globalSeconds: number): RowMaxima {
  const maxima: RowMaxima = { waveSeconds: globalSeconds, budget: 0, intervalSeconds: 0 };
  for (const row of rows) {
    const formula = endlessWaveFormula(row.wave);
    maxima.waveSeconds = Math.max(maxima.waveSeconds, row.override?.waveSeconds ?? 0);
    maxima.budget = Math.max(maxima.budget, row.override?.budget ?? formula.budget);
    maxima.intervalSeconds = Math.max(
      maxima.intervalSeconds,
      row.override?.intervalSeconds ?? formula.intervalSeconds,
    );
  }
  return maxima;
}

/** 只清空数组与字段，不影响其它波次。 */
function pruneIfEmpty(entry: EndlessWaveDraft): void {
  if (entry.units && entry.units.length === 0) delete entry.units;
}

/** 只剩波号的覆盖项视为未配置，保存时丢掉。 */
function isEmptyWave(entry: EndlessWaveDraft): boolean {
  return entry.waveSeconds === undefined
    && entry.budget === undefined
    && entry.intervalSeconds === undefined
    && (entry.units === undefined || entry.units.length === 0);
}

/** 默认兵种池文案，用兵种中文名串起来。 */
function defaultPoolText(wave: number): string {
  const pool = endlessDefaultWaveUnits(wave);
  if (pool.length === 0) return '无';
  return pool.map((unit) => displayUnitName(UNIT_CONFIGS[unit.typeId].name)).join('、');
}

/** 数值展示：整数不带小数，其余最多一位。 */
function formatHint(value: number): string {
  return Number.isInteger(value) ? String(value) : String(round1(value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 数值旁附相对短条，与单位参数页同一套视觉。 */
function makeValueWithBar(value: HTMLElement, ratio: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'unit-stats-value';
  wrap.appendChild(value);
  const bar = document.createElement('div');
  bar.className = 'unit-stats-mini-bar';
  const fill = document.createElement('span');
  fill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  bar.appendChild(fill);
  wrap.appendChild(bar);
  return wrap;
}

function required<T extends Element>(selector: string, parent: ParentNode = document): T {
  const element = parent.querySelector(selector);
  if (!element) throw new Error(`无限关卡参数页缺少节点 ${selector}`);
  return element as T;
}
