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

/** 总览相对条与 DPS 用的对比属性（含衍生 DPS）。 */
type CompareStatKey =
  | 'maxHp'
  | 'damage'
  | 'attackSpeed'
  | 'dps'
  | 'range'
  | 'moveSpeed'
  | 'sightRange';

export interface UnitStatsPageOptions {
  /** 从屏幕路由返回（图鉴入口）。 */
  onBack: () => void;
  /** 保存应用到运行时后回调（战场清场等）。 */
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
 * 开发服单位参数页：可编辑总览，保存写回 units.json。
 */
export function createUnitStatsPage(options: UnitStatsPageOptions): UnitStatsPageHandle {
  const root = required<HTMLElement>('#unit-stats');
  const backButton = required<HTMLButtonElement>('#btn-unit-stats-back', root);
  const panelRoot = required<HTMLElement>('#unit-stats-panel', root);
  const statusEl = required<HTMLElement>('#unit-stats-status', root);
  const saveButton = required<HTMLButtonElement>('#btn-unit-stats-save', root);

  const catalog = getUnitCatalogEntries();
  let drafts: UnitDraftMap = loadUnitDrafts();
  let selectedLevels = new Map<UnitTypeId, number>();
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

  function setStatus(text: string, isError: boolean): void {
    statusEl.textContent = text;
    statusEl.dataset.tone = isError ? 'error' : 'ok';
  }

  function render(): void {
    renderOverview();
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
      renderOverview();
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
      renderOverview();
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

/** 全库当前草稿的各对比属性上限，供进度条归一化。 */
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

function required<T extends Element>(selector: string, parent: ParentNode = document): T {
  const el = parent.querySelector(selector);
  if (!el) throw new Error(`单位参数页缺少节点 ${selector}`);
  return el as T;
}
