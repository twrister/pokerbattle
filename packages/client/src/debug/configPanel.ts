import {
  UNIT_TYPE_IDS,
  applyUnitConfigDrafts,
  dumpDefaultUnitConfigDrafts,
  dumpUnitConfigDrafts,
  resetUnitConfigsToDefault,
  type UnitConfigDraft,
  type UnitTypeId,
} from '@pb/sim';

const STORAGE_KEY = 'pb.unitConfigs.v1';
const COLLAPSE_KEY = 'pb.unitConfigPanel.collapsed';

/** 表单字段元数据：label + 输入控件类型 */
const NUMERIC_FIELDS: Array<{
  key: keyof UnitConfigDraft;
  label: string;
  step: string;
  hint?: string;
}> = [
  { key: 'radius', label: '半径', step: '0.05', hint: '碰撞 / 体型' },
  { key: 'mass', label: '质量', step: '0.1', hint: '推挤权重' },
  { key: 'maxHp', label: '生命', step: '10' },
  { key: 'damage', label: '伤害', step: '5' },
  { key: 'attackInterval', label: '攻击间隔', step: '1', hint: 'tick，20≈1秒' },
  { key: 'attackWindup', label: '前摇', step: '1', hint: 'tick' },
  { key: 'range', label: '射程', step: '0.1', hint: '边缘到边缘' },
  { key: 'moveSpeed', label: '移速', step: '0.1', hint: '单位/秒' },
  { key: 'sightRange', label: '索敌', step: '1' },
  { key: 'projectileSpeed', label: '弹速', step: '0.5', hint: '仅远程' },
];

export interface ConfigPanelOptions {
  /** 保存或重置后回调：清场、刷新兵种按钮名等 */
  onApplied: () => void;
}

export interface ConfigPanelHandle {
  /** 当前运行时配置写回表单（外部改表后可调用） */
  refreshFromRuntime: () => void;
  /** 移除静态控件事件并清空动态表单 */
  dispose: () => void;
}

/** 兵种参数调试面板：同时展示全部兵种，支持保存到 localStorage / 重置默认 */
export function createConfigPanel(options: ConfigPanelOptions): ConfigPanelHandle {
  const root = required<HTMLElement>('#panel-config');
  const formEl = required<HTMLDivElement>('#config-form', root);
  const statusEl = required<HTMLElement>('#config-status', root);
  const saveButton = required<HTMLButtonElement>('#btn-config-save', root);
  const resetButton = required<HTMLButtonElement>('#btn-config-reset', root);
  const toggleButton = required<HTMLButtonElement>('#btn-config-toggle', root);

  let drafts = loadInitialDrafts();
  let collapsed = readCollapsed();

  /** 切换收起/展开，并记住上次状态 */
  function setCollapsed(next: boolean): void {
    collapsed = next;
    root.classList.toggle('is-collapsed', collapsed);
    toggleButton.textContent = collapsed ? '展开' : '收起';
    toggleButton.setAttribute('aria-expanded', String(!collapsed));
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      // 隐私模式等写不进 storage 时忽略
    }
  }

  const toggleCollapsed = (): void => setCollapsed(!collapsed);

  const save = (): void => {
    readAllFormsIntoDrafts();
    applyUnitConfigDrafts(drafts);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
      setStatus('已保存，并写入本地缓存', false);
    } catch {
      setStatus('已应用到运行时（本地缓存写入失败）', true);
    }
    options.onApplied();
    syncSectionTitles();
  };

  const reset = (): void => {
    resetUnitConfigsToDefault();
    drafts = dumpDefaultUnitConfigDrafts();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 隐私模式等读不到 storage 时忽略
    }
    renderForm();
    setStatus('已恢复出厂默认', false);
    options.onApplied();
  };

  toggleButton.addEventListener('click', toggleCollapsed);
  saveButton.addEventListener('click', save);
  resetButton.addEventListener('click', reset);
  setCollapsed(collapsed);

  /** 把全部兵种草稿并排渲染成表单 */
  function renderForm(): void {
    formEl.replaceChildren();
    for (const typeId of UNIT_TYPE_IDS) {
      formEl.appendChild(makeUnitSection(typeId, drafts[typeId]));
    }
  }

  function makeUnitSection(typeId: UnitTypeId, draft: UnitConfigDraft): HTMLElement {
    const section = document.createElement('section');
    section.className = 'config-unit';
    section.dataset.unit = typeId;

    const heading = document.createElement('div');
    heading.className = 'config-unit-title';
    heading.dataset.role = 'title';
    heading.textContent = draft.name || typeId;
    section.appendChild(heading);

    section.appendChild(makeTextRow(typeId, 'name', '名称', draft.name));

    for (const field of NUMERIC_FIELDS) {
      const value = draft[field.key];
      if (typeof value !== 'number') continue;
      // 弹速只在远程时显示，近战隐藏避免误导
      if (field.key === 'projectileSpeed' && draft.attackKind !== 'projectile') continue;
      section.appendChild(
        makeNumberRow(typeId, field.key, field.label, value, field.step, field.hint),
      );
    }

    section.appendChild(makeAttackKindRow(typeId, draft.attackKind));
    return section;
  }

  function makeTextRow(
    typeId: UnitTypeId,
    key: string,
    label: string,
    value: string,
  ): HTMLLabelElement {
    const row = document.createElement('label');
    row.className = 'config-row';
    row.innerHTML = `<span class="config-label">${label}</span>`;
    const input = document.createElement('input');
    input.type = 'text';
    input.dataset.unit = typeId;
    input.dataset.field = key;
    input.value = value;
    // 改名称时同步该列标题，方便对照
    input.addEventListener('input', () => {
      const title = formEl.querySelector<HTMLElement>(
        `.config-unit[data-unit="${typeId}"] [data-role="title"]`,
      );
      if (title) title.textContent = input.value.trim() || typeId;
    });
    row.appendChild(input);
    return row;
  }

  function makeNumberRow(
    typeId: UnitTypeId,
    key: string,
    label: string,
    value: number,
    step: string,
    hint?: string,
  ): HTMLLabelElement {
    const row = document.createElement('label');
    row.className = 'config-row';
    const labelHtml = hint
      ? `<span class="config-label">${label}<small>${hint}</small></span>`
      : `<span class="config-label">${label}</span>`;
    row.innerHTML = labelHtml;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = step;
    input.dataset.unit = typeId;
    input.dataset.field = key;
    input.value = formatNumber(value);
    row.appendChild(input);
    return row;
  }

  function makeAttackKindRow(
    typeId: UnitTypeId,
    kind: UnitConfigDraft['attackKind'],
  ): HTMLLabelElement {
    const row = document.createElement('label');
    row.className = 'config-row';
    row.innerHTML = `<span class="config-label">攻击方式</span>`;
    const select = document.createElement('select');
    select.dataset.unit = typeId;
    select.dataset.field = 'attackKind';
    for (const [value, text] of [
      ['melee', '近战'],
      ['melee_aoe', '近战范围'],
      ['projectile', '远程弹道'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.selected = value === kind;
      select.appendChild(option);
    }
    // 切换近战/远程时立刻重绘该列，以便显示或隐藏弹速
    select.addEventListener('change', () => {
      readAllFormsIntoDrafts();
      renderForm();
    });
    row.appendChild(select);
    return row;
  }

  /** 从全部兵种表单读回草稿（保存 / 切换攻击方式前调用） */
  function readAllFormsIntoDrafts(): void {
    for (const el of formEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]')) {
      const typeId = el.dataset.unit as UnitTypeId | undefined;
      const field = el.dataset.field as keyof UnitConfigDraft | undefined;
      if (!typeId || !field) continue;
      const draft = drafts[typeId];
      if (!draft) continue;
      if (field === 'name') {
        draft.name = el.value.trim() || draft.name;
        continue;
      }
      if (field === 'attackKind') {
        draft.attackKind =
          el.value === 'projectile'
            ? 'projectile'
            : el.value === 'melee_aoe'
              ? 'melee_aoe'
              : 'melee';
        continue;
      }
      const num = Number(el.value);
      if (!Number.isFinite(num)) continue;
      assignNumericField(draft, field, num);
    }
  }

  function syncSectionTitles(): void {
    for (const typeId of UNIT_TYPE_IDS) {
      const title = formEl.querySelector<HTMLElement>(
        `.config-unit[data-unit="${typeId}"] [data-role="title"]`,
      );
      if (title) title.textContent = drafts[typeId]?.name || typeId;
    }
  }

  function setStatus(text: string, isError: boolean): void {
    statusEl.textContent = text;
    statusEl.dataset.tone = isError ? 'error' : 'ok';
  }

  renderForm();

  return {
    refreshFromRuntime() {
      drafts = dumpUnitConfigDrafts();
      renderForm();
    },
    dispose() {
      toggleButton.removeEventListener('click', toggleCollapsed);
      saveButton.removeEventListener('click', save);
      resetButton.removeEventListener('click', reset);
      formEl.replaceChildren();
    },
  };
}

/**
 * 在创建 World 之前调用：把 localStorage 里的兵种参数写回 UNIT_CONFIGS，
 * 这样空间哈希会按自定义半径建格。
 */
export function hydrateUnitConfigsFromStorage(): void {
  applyUnitConfigDrafts(readStoredDrafts() ?? dumpUnitConfigDrafts());
}

/** 优先读 localStorage，失败或损坏则回落运行时 / 默认 */
function loadInitialDrafts(): Record<UnitTypeId, UnitConfigDraft> {
  return readStoredDrafts() ?? dumpUnitConfigDrafts();
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/** 从 localStorage 解析草稿；没有或损坏时返回 null */
function readStoredDrafts(): Record<UnitTypeId, UnitConfigDraft> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Record<UnitTypeId, Partial<UnitConfigDraft>>>;
    const base = dumpDefaultUnitConfigDrafts();
    for (const id of UNIT_TYPE_IDS) {
      const patch = parsed[id];
      if (patch) Object.assign(base[id], patch, { id });
    }
    return base;
  } catch {
    return null;
  }
}

function formatNumber(value: number): string {
  // 去掉多余尾零，方便编辑；保留足够精度避免 fromFloat 往返抖动
  return String(Number(value.toFixed(4)));
}

/** 只接受数值字段，避免把 name/attackKind 误写成 number */
function assignNumericField(
  draft: UnitConfigDraft,
  field: keyof UnitConfigDraft,
  value: number,
): void {
  switch (field) {
    case 'radius':
    case 'mass':
    case 'maxHp':
    case 'damage':
    case 'attackInterval':
    case 'attackWindup':
    case 'range':
    case 'moveSpeed':
    case 'sightRange':
    case 'projectileSpeed':
      draft[field] = value;
      break;
    default:
      break;
  }
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`配置面板缺少元素：${selector}`);
  return element;
}
