import {
  UNIT_TYPE_IDS,
  applyUnitConfigDrafts,
  captureUnitConfigsAsDefault,
  dumpDefaultUnitConfigDrafts,
  dumpUnitConfigDrafts,
  resetUnitConfigsToDefault,
  type UnitConfigDraft,
  type UnitTypeId,
} from '@pb/sim';

/** 面板折叠状态仍可本地记忆；兵种数值以 units.json 为唯一数据源 */
const COLLAPSE_KEY = 'pb.unitConfigPanel.collapsed';

/** 表单字段元数据：label + 输入控件类型 */
const NUMERIC_FIELDS: Array<{
  key: keyof UnitConfigDraft;
  label: string;
  step: string;
  hint?: string;
}> = [
  { key: 'radius', label: '半径', step: '0.05', hint: '碰撞' },
  { key: 'bodyScale', label: '体型', step: '0.05', hint: '铁卫=1' },
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
  /** 战斗会话切换时替换清场回调，面板 DOM 本身跨会话复用 */
  setOnApplied: (onApplied: () => void) => void;
  /** 移除静态控件事件并清空动态表单 */
  dispose: () => void;
}

/** 兵种参数调试面板：展示全部兵种，保存写回 units.json / 重置为文件快照 */
export function createConfigPanel(options: ConfigPanelOptions): ConfigPanelHandle {
  const root = required<HTMLElement>('#panel-config');
  const formEl = required<HTMLDivElement>('#config-form', root);
  const statusEl = required<HTMLElement>('#config-status', root);
  const saveButton = required<HTMLButtonElement>('#btn-config-save', root);
  const resetButton = required<HTMLButtonElement>('#btn-config-reset', root);
  const toggleButton = required<HTMLButtonElement>('#btn-config-toggle', root);

  // 模块加载时已从 units.json 灌入 UNIT_CONFIGS
  let drafts = dumpUnitConfigDrafts();
  let collapsed = readCollapsed();
  let saveSeq = 0;
  let onApplied = options.onApplied;

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

  /** 应用到运行时，并尝试经 Vite 中间件写回 units.json */
  const save = (): void => {
    readAllFormsIntoDrafts();
    applyUnitConfigDrafts(drafts);
    onApplied();
    syncSectionTitles();

    const seq = ++saveSeq;
    void persistDraftsToFile(drafts).then((result) => {
      if (seq !== saveSeq) return;
      if (result.ok) {
        captureUnitConfigsAsDefault();
        setStatus('已保存并写回 units.json', false);
      } else {
        setStatus(`已应用到运行时（未能写回文件：${result.error}）`, true);
      }
    });
  };

  const reset = (): void => {
    resetUnitConfigsToDefault();
    drafts = dumpDefaultUnitConfigDrafts();
    renderForm();
    setStatus('已恢复为配置文件快照', false);
    onApplied();
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

  /** 从全部兵种表单读回草稿（保存 / 切换攻击方式前调用）；技能块保留在 drafts 上原样写回 */
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
    setOnApplied(next) {
      onApplied = next;
    },
    dispose() {
      toggleButton.removeEventListener('click', toggleCollapsed);
      saveButton.removeEventListener('click', save);
      resetButton.removeEventListener('click', reset);
      formEl.replaceChildren();
    },
  };
}

/** POST 到 Vite 开发中间件写盘；preview/build 下接口不存在 */
async function persistDraftsToFile(
  drafts: Record<UnitTypeId, UnitConfigDraft>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('/__pb/unit-configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(drafts),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) detail = body.error;
      } catch {
        // 非 JSON 错误体时沿用 status
      }
      // 常见于非 dev：中间件未注册，需在 pnpm dev 下保存
      if (res.status === 404) {
        return { ok: false, error: '需在 pnpm dev 下保存' };
      }
      return { ok: false, error: detail };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function formatNumber(value: number): string {
  // 去掉多余尾零，方便编辑；保留足够精度避免 fromFloat 往返抖动
  return String(Number(value.toFixed(4)));
}

/** 只接受数值字段，避免把 name/attackKind/技能块误写成 number */
function assignNumericField(
  draft: UnitConfigDraft,
  field: keyof UnitConfigDraft,
  value: number,
): void {
  switch (field) {
    case 'radius':
    case 'bodyScale':
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
