import {
  TICK_RATE,
  UNIT_CONFIGS,
  UNIT_LEVELS_ENABLED,
  type UnitConfigDraft,
  type UnitLevelConfigDraft,
  type UnitTypeId,
} from '@pb/sim';
import {
  AOE_NUMERIC_KEYS,
  NUMERIC_FIELDS,
  POST_MOVE_NUMERIC_KEYS,
  PRE_ATTACK_NUMERIC_KEYS,
  PRIMARY_NUMERIC_KEYS,
  formatDraftNumber,
  getLevelDraft,
  loadDefaultUnitDrafts,
  loadUnitDrafts,
  presentSkillGroups,
  readControlsIntoDrafts,
  saveUnitDrafts,
  type UnitDraftMap,
} from '../debug/unitConfigDraftUi.js';
import {
  displayUnitName,
  getUnitCatalogEntries,
  type UnitCatalogEntry,
} from './unitCatalog.js';

type PageTab = 'overview' | 'bar' | 'radar';

/** 柱状/雷达可选的对比属性（含衍生 DPS）。 */
type CompareStatKey =
  | 'maxHp'
  | 'damage'
  | 'attackSpeed'
  | 'dps'
  | 'range'
  | 'moveSpeed'
  | 'sightRange';

const COMPARE_STAT_NAMES: Record<CompareStatKey, string> = {
  maxHp: '生命',
  damage: '伤害',
  attackSpeed: '攻速',
  dps: 'DPS',
  range: '射程',
  moveSpeed: '移速',
  sightRange: '索敌',
};

const RADAR_AXES: readonly CompareStatKey[] = [
  'maxHp',
  'dps',
  'range',
  'moveSpeed',
  'sightRange',
  'attackSpeed',
];

const RADAR_COLORS = ['#f5d26b', '#4cc9f0', '#80ed99', '#ff6b6b', '#c77dff', '#90e0ef'];
const MAX_RADAR_UNITS = 6;

export interface UnitStatsPageOptions {
  /** 从屏幕路由返回（图鉴入口）。 */
  onBack: () => void;
  /** 保存/重置应用到运行时后回调（战场清场等）。 */
  onApplied?: () => void;
}

export interface UnitStatsPageHandle {
  show(): void;
  /** 战场入口：盖在 HUD 上，不切换 AppScreen。 */
  showAsOverlay(): void;
  hide(): void;
  setOnApplied(onApplied: () => void): void;
  refreshFromRuntime(): void;
  dispose(): void;
}

/**
 * 开发服单位参数页：可编辑总览 + 单属性柱状对比 + 多选雷达对比，保存写回 units.json。
 */
export function createUnitStatsPage(options: UnitStatsPageOptions): UnitStatsPageHandle {
  const root = required<HTMLElement>('#unit-stats');
  const backButton = required<HTMLButtonElement>('#btn-unit-stats-back', root);
  const tabList = required<HTMLElement>('#unit-stats-tabs', root);
  const panelRoot = required<HTMLElement>('#unit-stats-panel', root);
  const statusEl = required<HTMLElement>('#unit-stats-status', root);
  const saveButton = required<HTMLButtonElement>('#btn-unit-stats-save', root);
  const resetButton = required<HTMLButtonElement>('#btn-unit-stats-reset', root);

  const catalog = getUnitCatalogEntries();
  let drafts: UnitDraftMap = loadUnitDrafts();
  let tab: PageTab = 'overview';
  let barStat: CompareStatKey = 'maxHp';
  let selectedLevels = new Map<UnitTypeId, number>();
  let radarSelection = new Set<UnitTypeId>(
    catalog.slice(0, 2).map((entry) => entry.typeId),
  );
  let saveSeq = 0;
  let onApplied = options.onApplied ?? (() => {});
  let overlayMode = false;

  const back = (): void => {
    if (overlayMode) {
      hide();
      return;
    }
    options.onBack();
  };

  backButton.addEventListener('click', back);
  saveButton.addEventListener('click', () => void save());
  resetButton.addEventListener('click', reset);

  /** 从当前表单读回草稿并写运行时 / 文件。 */
  async function save(): Promise<void> {
    readControlsIntoDrafts(panelRoot, drafts);
    const seq = ++saveSeq;
    const result = await saveUnitDrafts(drafts);
    if (seq !== saveSeq) return;
    onApplied();
    if (result.ok) setStatus('已保存并写回 units.json', false);
    else setStatus(`已应用到运行时（未能写回文件：${result.error}）`, true);
    render();
  }

  /** 恢复配置文件快照。 */
  function reset(): void {
    drafts = loadDefaultUnitDrafts();
    setStatus('已恢复为配置文件快照', false);
    onApplied();
    render();
  }

  function setStatus(text: string, isError: boolean): void {
    statusEl.textContent = text;
    statusEl.dataset.tone = isError ? 'error' : 'ok';
  }

  /** 切换 Tab 前先收集未保存输入。 */
  function switchTab(next: PageTab): void {
    readControlsIntoDrafts(panelRoot, drafts);
    tab = next;
    render();
  }

  function render(): void {
    renderTabs();
    if (tab === 'overview') renderOverview();
    else if (tab === 'bar') renderBarCompare();
    else renderRadarCompare();
  }

  function renderTabs(): void {
    const tabs: Array<{ id: PageTab; label: string }> = [
      { id: 'overview', label: '编辑总览' },
      { id: 'bar', label: '属性柱状' },
      { id: 'radar', label: '兵种雷达' },
    ];
    tabList.replaceChildren(
      ...tabs.map(({ id, label }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'unit-stats-tab';
        button.textContent = label;
        button.classList.toggle('is-active', id === tab);
        button.setAttribute('aria-pressed', String(id === tab));
        button.addEventListener('click', () => switchTab(id));
        return button;
      }),
    );
  }

  /** 可编辑总览表：行=兵种，列=主战斗属性 + DPS 只读。 */
  function renderOverview(): void {
    panelRoot.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'unit-stats-table-wrap';
    const table = document.createElement('table');
    table.className = 'unit-stats-table';
    table.setAttribute('aria-label', '兵种参数编辑表');

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const appendHead = (label: string, field?: string): void => {
      const th = document.createElement('th');
      th.textContent = label;
      if (field) th.dataset.field = field;
      headRow.appendChild(th);
    };
    appendHead('兵种', 'name');
    if (UNIT_LEVELS_ENABLED) appendHead('等级', 'level');
    for (const key of PRIMARY_NUMERIC_KEYS) appendHead(fieldLabel(key), key);
    for (const key of POST_MOVE_NUMERIC_KEYS) appendHead(fieldLabel(key), key);
    for (const key of PRE_ATTACK_NUMERIC_KEYS) appendHead(fieldLabel(key), key);
    appendHead('DPS', 'dps');
    appendHead('攻击方式', 'attackKind');
    for (const key of AOE_NUMERIC_KEYS) appendHead(fieldLabel(key), key);
    appendHead('移动层', 'movementLayer');
    appendHead('更多', 'more');
    appendHead('技能', 'skill');
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const maxima = computeOverviewMaxima(catalog, drafts, selectedLevels);
    for (const entry of catalog) {
      tbody.appendChild(makeOverviewRow(entry, maxima));
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    panelRoot.appendChild(wrap);
  }

  function makeOverviewRow(
    entry: UnitCatalogEntry,
    maxima: Record<OverviewBarKey, number>,
  ): HTMLTableRowElement {
    const typeId = entry.typeId;
    const draft = drafts[typeId];
    const level = selectedLevels.get(typeId) ?? 1;
    const levelDraft = getLevelDraft(draft, level);
    const row = document.createElement('tr');
    row.dataset.unit = typeId;

    const nameCell = document.createElement('td');
    nameCell.className = 'unit-stats-name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.dataset.unit = typeId;
    nameInput.dataset.field = 'name';
    nameInput.value = draft.name;
    nameInput.setAttribute('aria-label', `${displayUnitName(draft.name)}名称`);
    nameCell.appendChild(nameInput);
    row.appendChild(nameCell);

    if (UNIT_LEVELS_ENABLED) {
      const levelCell = document.createElement('td');
      levelCell.appendChild(makeLevelSelect(typeId, draft, level));
      row.appendChild(levelCell);
    }

    for (const key of PRIMARY_NUMERIC_KEYS) {
      row.appendChild(makeNumericCell(typeId, level, levelDraft, key, maxima));
    }
    for (const key of POST_MOVE_NUMERIC_KEYS) {
      row.appendChild(makeNumericCell(typeId, level, levelDraft, key, maxima));
    }
    for (const key of PRE_ATTACK_NUMERIC_KEYS) {
      row.appendChild(makeNumericCell(typeId, level, levelDraft, key, maxima));
    }

    const dpsCell = document.createElement('td');
    dpsCell.className = 'unit-stats-readonly';
    const dps = computeStat(levelDraft, 'dps');
    dpsCell.appendChild(makeValueWithBar(formatDraftNumber(dps), dps / Math.max(maxima.dps, 1e-6)));
    row.appendChild(dpsCell);

    row.appendChild(makeAttackKindCell(typeId, level, levelDraft.attackKind));
    for (const key of AOE_NUMERIC_KEYS) {
      row.appendChild(makeAoeRadiusCell(typeId, level, levelDraft, key, maxima));
    }
    row.appendChild(makeMovementLayerCell(typeId, level, levelDraft.movementLayer));
    row.appendChild(makeMoreCell(typeId, level, levelDraft));
    row.appendChild(makeSkillCell(typeId, level, levelDraft));
    return row;
  }

  function makeLevelSelect(
    typeId: UnitTypeId,
    draft: UnitDraftMap[UnitTypeId],
    selectedLevel: number,
  ): HTMLSelectElement {
    const select = document.createElement('select');
    select.setAttribute('aria-label', '等级');
    const levels = Object.keys(draft.levels ?? { 1: getLevelDraft(draft, 1) })
      .map(Number)
      .sort((a, b) => a - b);
    for (const level of levels) {
      const option = document.createElement('option');
      option.value = String(level);
      option.textContent = String(level);
      option.selected = level === selectedLevel;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      readControlsIntoDrafts(panelRoot, drafts);
      selectedLevels.set(typeId, Number(select.value) || 1);
      render();
    });
    return select;
  }

  function makeNumericCell(
    typeId: UnitTypeId,
    level: number,
    levelDraft: UnitLevelConfigDraft,
    key:
      | (typeof PRIMARY_NUMERIC_KEYS)[number]
      | (typeof POST_MOVE_NUMERIC_KEYS)[number]
      | (typeof PRE_ATTACK_NUMERIC_KEYS)[number],
    maxima: Record<OverviewBarKey, number>,
  ): HTMLTableCellElement {
    const cell = document.createElement('td');
    cell.dataset.field = key;
    const meta = NUMERIC_FIELDS.find((field) => field.key === key);
    const value = levelDraft[key as keyof UnitLevelConfigDraft];
    if (typeof value !== 'number' || !meta) {
      cell.textContent = '—';
      return cell;
    }
    const input = document.createElement('input');
    input.type = 'number';
    input.step = meta.step;
    input.dataset.unit = typeId;
    input.dataset.level = String(level);
    input.dataset.field = key;
    input.value = formatDraftNumber(value);
    input.setAttribute('aria-label', meta.label);
    input.addEventListener('change', () => {
      readControlsIntoDrafts(panelRoot, drafts);
      // 改主属性后刷新相对条与 DPS，避免表内数字不同步
      if (tab === 'overview') renderOverview();
    });
    // 主战斗属性走对比键（如攻击间隔→攻速）；半径/体型/前摇按自身值相对全库上限
    const compareKey = primaryToCompareKey(key);
    const barValue = compareKey ? computeStat(levelDraft, compareKey) : value;
    const barMax = compareKey ? maxima[compareKey] : maxima[key];
    const ratio = barValue / Math.max(barMax, 1e-6);
    cell.appendChild(makeValueWithBar(input, ratio));
    return cell;
  }

  function makeAttackKindCell(
    typeId: UnitTypeId,
    level: number,
    kind: UnitConfigDraft['attackKind'],
  ): HTMLTableCellElement {
    const cell = document.createElement('td');
    const select = document.createElement('select');
    select.dataset.unit = typeId;
    select.dataset.level = String(level);
    select.dataset.field = 'attackKind';
    for (const [value, text] of [
      ['melee', '近战'],
      ['melee_aoe', '近战范围'],
      ['projectile', '远程弹道'],
      ['projectile_aoe', '落点范围'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.selected = value === kind;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      readControlsIntoDrafts(panelRoot, drafts);
      render();
    });
    cell.appendChild(select);
    return cell;
  }

  /** 落点范围弹才可编辑爆炸范围；其它攻击方式显示破折号。 */
  function makeAoeRadiusCell(
    typeId: UnitTypeId,
    level: number,
    levelDraft: UnitLevelConfigDraft,
    key: (typeof AOE_NUMERIC_KEYS)[number],
    maxima: Record<OverviewBarKey, number>,
  ): HTMLTableCellElement {
    const cell = document.createElement('td');
    cell.dataset.field = key;
    if (levelDraft.attackKind !== 'projectile_aoe') {
      cell.textContent = '—';
      return cell;
    }
    const meta = NUMERIC_FIELDS.find((field) => field.key === key);
    const value = levelDraft[key];
    if (typeof value !== 'number' || !meta) {
      cell.textContent = '—';
      return cell;
    }
    const input = document.createElement('input');
    input.type = 'number';
    input.step = meta.step;
    input.dataset.unit = typeId;
    input.dataset.level = String(level);
    input.dataset.field = key;
    input.value = formatDraftNumber(value);
    input.setAttribute('aria-label', meta.label);
    input.addEventListener('change', () => {
      readControlsIntoDrafts(panelRoot, drafts);
      if (tab === 'overview') renderOverview();
    });
    const ratio = value / Math.max(maxima[key], 1e-6);
    cell.appendChild(makeValueWithBar(input, ratio));
    return cell;
  }

  function makeMovementLayerCell(
    typeId: UnitTypeId,
    level: number,
    layer: UnitConfigDraft['movementLayer'],
  ): HTMLTableCellElement {
    const cell = document.createElement('td');
    const select = document.createElement('select');
    select.dataset.unit = typeId;
    select.dataset.level = String(level);
    select.dataset.field = 'movementLayer';
    for (const [value, text] of [
      ['ground', '地面'],
      ['air', '空中'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.selected = value === layer;
      select.appendChild(option);
    }
    cell.appendChild(select);
    return cell;
  }

  /** 次要字段折叠在 details 内，避免总览过宽。 */
  function makeMoreCell(
    typeId: UnitTypeId,
    level: number,
    levelDraft: UnitLevelConfigDraft,
  ): HTMLTableCellElement {
    const cell = document.createElement('td');
    const details = document.createElement('details');
    details.className = 'unit-stats-more';
    const summary = document.createElement('summary');
    summary.textContent = '编辑';
    details.appendChild(summary);
    const list = document.createElement('div');
    list.className = 'unit-stats-more-fields';
    const primaryOrPinned = new Set<string>([
      ...PRIMARY_NUMERIC_KEYS,
      ...POST_MOVE_NUMERIC_KEYS,
      ...PRE_ATTACK_NUMERIC_KEYS,
      ...AOE_NUMERIC_KEYS,
    ]);
    const secondary = NUMERIC_FIELDS.filter((field) => !primaryOrPinned.has(field.key));
    for (const field of secondary) {
      if (
        field.key === 'projectileSpeed' &&
        levelDraft.attackKind !== 'projectile' &&
        levelDraft.attackKind !== 'projectile_aoe'
      ) {
        continue;
      }
      const value = levelDraft[field.key as keyof UnitLevelConfigDraft];
      if (typeof value !== 'number') continue;
      const label = document.createElement('label');
      label.className = 'unit-stats-more-row';
      const caption = document.createElement('span');
      caption.textContent = field.label;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = field.step;
      input.dataset.unit = typeId;
      input.dataset.level = String(level);
      input.dataset.field = field.key;
      input.value = formatDraftNumber(value);
      label.append(caption, input);
      list.appendChild(label);
    }
    details.appendChild(list);
    cell.appendChild(details);
    return cell;
  }

  /** 有技能块时折叠编辑；无技能显示破折号。 */
  function makeSkillCell(
    typeId: UnitTypeId,
    level: number,
    levelDraft: UnitLevelConfigDraft,
  ): HTMLTableCellElement {
    const cell = document.createElement('td');
    cell.dataset.field = 'skill';
    const groups = presentSkillGroups(levelDraft);
    if (groups.length === 0) {
      cell.textContent = '—';
      return cell;
    }
    const details = document.createElement('details');
    details.className = 'unit-stats-more';
    const summary = document.createElement('summary');
    summary.textContent = groups.map((group) => group.title).join('、');
    details.appendChild(summary);
    const list = document.createElement('div');
    list.className = 'unit-stats-more-fields';
    for (const group of groups) {
      const block = levelDraft[group.key];
      if (!block) continue;
      const title = document.createElement('div');
      title.className = 'unit-stats-skill-group';
      title.textContent = group.title;
      list.appendChild(title);
      for (const field of group.fields) {
        const label = document.createElement('label');
        label.className = 'unit-stats-more-row';
        const caption = document.createElement('span');
        caption.textContent = field.label;
        if (field.kind === 'select') {
          const select = document.createElement('select');
          select.dataset.unit = typeId;
          select.dataset.level = String(level);
          select.dataset.skill = group.key;
          select.dataset.field = field.key;
          const current =
            group.key === 'summon' && 'unitTypeId' in block
              ? String(block.unitTypeId)
              : '';
          for (const optionId of field.options) {
            const option = document.createElement('option');
            option.value = optionId;
            option.textContent = displayUnitName(UNIT_CONFIGS[optionId].name);
            option.selected = optionId === current;
            select.appendChild(option);
          }
          label.append(caption, select);
        } else {
          const raw = (block as Record<string, unknown>)[field.key];
          if (typeof raw !== 'number') continue;
          const input = document.createElement('input');
          input.type = 'number';
          input.step = field.step;
          input.dataset.unit = typeId;
          input.dataset.level = String(level);
          input.dataset.skill = group.key;
          input.dataset.field = field.key;
          input.value = formatDraftNumber(raw);
          if (field.hint) input.title = field.hint;
          label.append(caption, input);
        }
        list.appendChild(label);
      }
    }
    details.appendChild(list);
    cell.appendChild(details);
    return cell;
  }

  /** 单属性柱状对比。 */
  function renderBarCompare(): void {
    panelRoot.replaceChildren();
    const controls = document.createElement('div');
    controls.className = 'unit-stats-compare-controls';
    const label = document.createElement('label');
    label.textContent = '对比属性';
    const select = document.createElement('select');
    select.setAttribute('aria-label', '对比属性');
    for (const key of Object.keys(COMPARE_STAT_NAMES) as CompareStatKey[]) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = COMPARE_STAT_NAMES[key];
      option.selected = key === barStat;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      barStat = select.value as CompareStatKey;
      renderBarCompare();
    });
    label.appendChild(select);
    controls.appendChild(label);

    const chart = document.createElement('div');
    chart.className = 'unit-stats-chart';
    chart.appendChild(buildBarChart(barStat));
    panelRoot.append(controls, chart);
  }

  function buildBarChart(stat: CompareStatKey): SVGElement {
    const rows = catalog
      .map((entry) => {
        const level = selectedLevels.get(entry.typeId) ?? 1;
        const levelDraft = getLevelDraft(drafts[entry.typeId], level);
        return {
          typeId: entry.typeId,
          name: displayUnitName(drafts[entry.typeId].name || entry.name),
          value: computeStat(levelDraft, stat),
        };
      })
      .sort((a, b) => b.value - a.value);

    const width = 720;
    const rowH = 28;
    const padL = 100;
    const padR = 64;
    const padT = 16;
    const padB = 16;
    const height = padT + padB + rows.length * rowH;
    const plotW = width - padL - padR;
    const maxV = Math.max(1e-6, ...rows.map((row) => row.value));

    const svg = svgEl('svg', {
      viewBox: `0 0 ${width} ${height}`,
      class: 'unit-stats-svg',
      role: 'img',
      'aria-label': `${COMPARE_STAT_NAMES[stat]}兵种对比柱状图`,
    });

    rows.forEach((row, index) => {
      const y = padT + index * rowH;
      const barW = (row.value / maxV) * plotW;
      const name = svgEl('text', {
        x: String(padL - 8),
        y: String(y + 18),
        class: 'unit-stats-axis-label',
        'text-anchor': 'end',
      });
      name.textContent = row.name;
      const rect = svgEl('rect', {
        x: String(padL),
        y: String(y + 4),
        width: String(Math.max(barW, 0)),
        height: '18',
        class: 'unit-stats-bar',
      });
      const value = svgEl('text', {
        x: String(padL + barW + 6),
        y: String(y + 18),
        class: 'unit-stats-axis-label',
      });
      value.textContent = formatDraftNumber(row.value);
      svg.append(name, rect, value);
    });
    return svg;
  }

  /** 多选兵种雷达 + 并排绝对值表。 */
  function renderRadarCompare(): void {
    panelRoot.replaceChildren();
    const picker = document.createElement('div');
    picker.className = 'unit-stats-radar-picker';
    picker.setAttribute('aria-label', '选择对比兵种');
    for (const entry of catalog) {
      const label = document.createElement('label');
      label.className = 'unit-stats-radar-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = radarSelection.has(entry.typeId);
      const atLimit = radarSelection.size >= MAX_RADAR_UNITS && !checkbox.checked;
      checkbox.disabled = atLimit;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          if (radarSelection.size >= MAX_RADAR_UNITS) {
            checkbox.checked = false;
            return;
          }
          radarSelection.add(entry.typeId);
        } else {
          radarSelection.delete(entry.typeId);
        }
        renderRadarCompare();
      });
      const text = document.createElement('span');
      text.textContent = displayUnitName(drafts[entry.typeId].name || entry.name);
      label.append(checkbox, text);
      picker.appendChild(label);
    }

    const selected = catalog.filter((entry) => radarSelection.has(entry.typeId));
    const chart = document.createElement('div');
    chart.className = 'unit-stats-chart';
    if (selected.length < 2) {
      const hint = document.createElement('p');
      hint.className = 'unit-stats-hint';
      hint.textContent = '请至少选择 2 个兵种进行雷达对比（最多 6 个）。';
      chart.appendChild(hint);
    } else {
      chart.appendChild(buildRadarChart(selected));
      chart.appendChild(buildRadarTable(selected));
    }
    panelRoot.append(picker, chart);
  }

  function buildRadarChart(selected: readonly UnitCatalogEntry[]): SVGElement {
    const maxima = computeCompareMaxima(catalog, drafts, selectedLevels);
    const size = 360;
    const cx = size / 2;
    const cy = size / 2;
    const radius = 120;
    const svg = svgEl('svg', {
      viewBox: `0 0 ${size} ${size}`,
      class: 'unit-stats-svg unit-stats-radar-svg',
      role: 'img',
      'aria-label': '兵种属性雷达对比',
    });

    // 网格环
    for (const ring of [0.25, 0.5, 0.75, 1]) {
      const points = RADAR_AXES.map((_, index) => {
        const angle = (-Math.PI / 2) + (index * 2 * Math.PI) / RADAR_AXES.length;
        const x = cx + Math.cos(angle) * radius * ring;
        const y = cy + Math.sin(angle) * radius * ring;
        return `${x},${y}`;
      }).join(' ');
      svg.appendChild(
        svgEl('polygon', {
          points,
          class: 'unit-stats-radar-grid',
        }),
      );
    }

    RADAR_AXES.forEach((axis, index) => {
      const angle = (-Math.PI / 2) + (index * 2 * Math.PI) / RADAR_AXES.length;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      svg.appendChild(
        svgEl('line', {
          x1: String(cx),
          y1: String(cy),
          x2: String(x),
          y2: String(y),
          class: 'unit-stats-radar-axis',
        }),
      );
      const label = svgEl('text', {
        x: String(cx + Math.cos(angle) * (radius + 22)),
        y: String(cy + Math.sin(angle) * (radius + 22) + 4),
        class: 'unit-stats-axis-label',
        'text-anchor': 'middle',
      });
      label.textContent = COMPARE_STAT_NAMES[axis];
      svg.appendChild(label);
    });

    selected.forEach((entry, unitIndex) => {
      const level = selectedLevels.get(entry.typeId) ?? 1;
      const levelDraft = getLevelDraft(drafts[entry.typeId], level);
      const points = RADAR_AXES.map((axis, index) => {
        const angle = (-Math.PI / 2) + (index * 2 * Math.PI) / RADAR_AXES.length;
        const ratio = computeStat(levelDraft, axis) / Math.max(maxima[axis], 1e-6);
        const x = cx + Math.cos(angle) * radius * Math.min(1, ratio);
        const y = cy + Math.sin(angle) * radius * Math.min(1, ratio);
        return `${x},${y}`;
      }).join(' ');
      const color = RADAR_COLORS[unitIndex % RADAR_COLORS.length]!;
      const poly = svgEl('polygon', {
        points,
        class: 'unit-stats-radar-poly',
        fill: color,
        stroke: color,
      });
      poly.setAttribute('fill-opacity', '0.18');
      svg.appendChild(poly);
    });

    const legend = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    selected.forEach((entry, unitIndex) => {
      const color = RADAR_COLORS[unitIndex % RADAR_COLORS.length]!;
      const y = 18 + unitIndex * 16;
      const swatch = svgEl('rect', {
        x: '12',
        y: String(y - 10),
        width: '10',
        height: '10',
        fill: color,
      });
      const text = svgEl('text', {
        x: '28',
        y: String(y),
        class: 'unit-stats-axis-label',
      });
      text.textContent = displayUnitName(drafts[entry.typeId].name || entry.name);
      legend.append(swatch, text);
    });
    svg.appendChild(legend);
    return svg;
  }

  function buildRadarTable(selected: readonly UnitCatalogEntry[]): HTMLTableElement {
    const table = document.createElement('table');
    table.className = 'unit-stats-table unit-stats-radar-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.appendChild(document.createElement('th')).textContent = '属性';
    for (const entry of selected) {
      const th = document.createElement('th');
      th.textContent = displayUnitName(drafts[entry.typeId].name || entry.name);
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const axis of RADAR_AXES) {
      const row = document.createElement('tr');
      const nameCell = document.createElement('td');
      nameCell.textContent = COMPARE_STAT_NAMES[axis];
      row.appendChild(nameCell);
      const values = selected.map((entry) => {
        const level = selectedLevels.get(entry.typeId) ?? 1;
        return computeStat(getLevelDraft(drafts[entry.typeId], level), axis);
      });
      const max = Math.max(...values);
      values.forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = formatDraftNumber(value);
        if (value === max && selected.length > 1) cell.classList.add('is-best');
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    return table;
  }

  function showInternal(asOverlay: boolean): void {
    overlayMode = asOverlay;
    root.classList.toggle('is-overlay', asOverlay);
    root.classList.remove('is-hidden');
    root.setAttribute('aria-hidden', 'false');
    backButton.textContent = asOverlay ? '关闭' : '返回图鉴';
    drafts = loadUnitDrafts();
    setStatus(asOverlay ? '战场模式：保存后将应用到当前对局' : '改完点保存写回配置文件', false);
    render();
  }

  function hide(): void {
    readControlsIntoDrafts(panelRoot, drafts);
    root.classList.add('is-hidden');
    root.setAttribute('aria-hidden', 'true');
    root.classList.remove('is-overlay');
    overlayMode = false;
  }

  return {
    show() {
      showInternal(false);
    },
    showAsOverlay() {
      showInternal(true);
    },
    hide,
    setOnApplied(next) {
      onApplied = next;
    },
    refreshFromRuntime() {
      drafts = loadUnitDrafts();
      if (!root.classList.contains('is-hidden')) render();
    },
    dispose() {
      backButton.removeEventListener('click', back);
      panelRoot.replaceChildren();
    },
  };
}

/** 总览表相对条可用的字段：战斗对比键 + 半径/体型/前摇/爆炸范围原值。 */
type OverviewBarKey =
  | CompareStatKey
  | (typeof POST_MOVE_NUMERIC_KEYS)[number]
  | (typeof PRE_ATTACK_NUMERIC_KEYS)[number]
  | (typeof AOE_NUMERIC_KEYS)[number];

function fieldLabel(key: keyof UnitConfigDraft): string {
  return NUMERIC_FIELDS.find((field) => field.key === key)?.label ?? String(key);
}

function primaryToCompareKey(
  key:
    | (typeof PRIMARY_NUMERIC_KEYS)[number]
    | (typeof POST_MOVE_NUMERIC_KEYS)[number]
    | (typeof PRE_ATTACK_NUMERIC_KEYS)[number],
): CompareStatKey | null {
  switch (key) {
    case 'maxHp':
    case 'damage':
    case 'range':
    case 'moveSpeed':
      return key;
    case 'attackInterval':
      return 'attackSpeed';
    default:
      return null;
  }
}

/** 从等级草稿计算对比用属性值。 */
function computeStat(levelDraft: UnitLevelConfigDraft, key: CompareStatKey): number {
  const interval = Math.max(levelDraft.attackInterval, 1e-6);
  switch (key) {
    case 'maxHp':
      return levelDraft.maxHp;
    case 'damage':
      return levelDraft.damage;
    case 'attackSpeed':
      return TICK_RATE / interval;
    case 'dps':
      return levelDraft.damage * (TICK_RATE / interval);
    case 'range':
      return levelDraft.range;
    case 'moveSpeed':
      return levelDraft.moveSpeed;
    case 'sightRange':
      return levelDraft.sightRange;
    default:
      return 0;
  }
}

/** 全库当前草稿的各对比属性上限，供进度条与雷达归一化。 */
function computeCompareMaxima(
  catalog: readonly UnitCatalogEntry[],
  drafts: UnitDraftMap,
  selectedLevels: Map<UnitTypeId, number>,
): Record<CompareStatKey, number> {
  const maxima: Record<CompareStatKey, number> = {
    maxHp: 0,
    damage: 0,
    attackSpeed: 0,
    dps: 0,
    range: 0,
    moveSpeed: 0,
    sightRange: 0,
  };
  for (const entry of catalog) {
    const level = selectedLevels.get(entry.typeId) ?? 1;
    const levelDraft = getLevelDraft(drafts[entry.typeId], level);
    for (const key of Object.keys(maxima) as CompareStatKey[]) {
      maxima[key] = Math.max(maxima[key], computeStat(levelDraft, key));
    }
  }
  return maxima;
}

/** 总览表相对条上限：战斗对比键 + 半径/体型/前摇/爆炸范围原值。 */
function computeOverviewMaxima(
  catalog: readonly UnitCatalogEntry[],
  drafts: UnitDraftMap,
  selectedLevels: Map<UnitTypeId, number>,
): Record<OverviewBarKey, number> {
  const maxima: Record<OverviewBarKey, number> = {
    ...computeCompareMaxima(catalog, drafts, selectedLevels),
    radius: 0,
    bodyScale: 0,
    attackWindup: 0,
    aoeRadius: 0,
  };
  for (const entry of catalog) {
    const level = selectedLevels.get(entry.typeId) ?? 1;
    const levelDraft = getLevelDraft(drafts[entry.typeId], level);
    for (const key of [...POST_MOVE_NUMERIC_KEYS, ...PRE_ATTACK_NUMERIC_KEYS]) {
      maxima[key] = Math.max(maxima[key], levelDraft[key]);
    }
    // 仅统计落点范围弹的爆炸范围，避免近战兵种的 0 拉低相对条
    if (levelDraft.attackKind === 'projectile_aoe') {
      maxima.aoeRadius = Math.max(maxima.aoeRadius, levelDraft.aoeRadius);
    }
  }
  return maxima;
}

/** 数值旁附相对短条；value 可为 input 或文本。 */
function makeValueWithBar(value: string | HTMLElement, ratio: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'unit-stats-value';
  if (typeof value === 'string') {
    const text = document.createElement('span');
    text.textContent = value;
    wrap.appendChild(text);
  } else {
    wrap.appendChild(value);
  }
  const bar = document.createElement('div');
  bar.className = 'unit-stats-mini-bar';
  const fill = document.createElement('span');
  fill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  bar.appendChild(fill);
  wrap.appendChild(bar);
  return wrap;
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
  if (!el) throw new Error(`单位参数页缺少节点 ${selector}`);
  return el as T;
}
