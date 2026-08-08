import {
  HAND_CATEGORY_NAMES,
  HAND_CATEGORY_ORDER,
  UNIT_CONFIGS,
  UNIT_TYPE_IDS,
  applyCardFormationDrafts,
  captureCardFormationsAsDefault,
  createCardFormation,
  dumpCardFormationDrafts,
  dumpDefaultCardFormationDrafts,
  type CardFormationDrafts,
  type FormationDraft,
  type HandCategory,
  type UnitTypeId,
} from '@pb/sim';
import { createFormationPreview, type FormationPreviewHandle } from '../view/formationPreview.js';

export interface DeckConfigPageOptions {
  onBack: () => void;
}

export interface DeckConfigPageHandle {
  show(): void;
  hide(): void;
  dispose(): void;
}

/** 卡组阵型编辑页：草稿只在保存时应用，编辑过程始终可撤销。 */
export function createDeckConfigPage(options: DeckConfigPageOptions): DeckConfigPageHandle {
  const root = required<HTMLElement>('#deck-config');
  const categoryList = required<HTMLElement>('#deck-category-list', root);
  const formationList = required<HTMLElement>('#deck-formation-list', root);
  const editor = required<HTMLElement>('#deck-editor', root);
  const previewRoot = required<HTMLElement>('#deck-preview', root);
  const backButton = required<HTMLButtonElement>('#btn-deck-back', root);
  const addFormationButton = required<HTMLButtonElement>('#btn-deck-add-formation', root);
  const saveButton = required<HTMLButtonElement>('#btn-deck-save', root);
  const resetButton = required<HTMLButtonElement>('#btn-deck-reset', root);

  let drafts = dumpCardFormationDrafts();
  let category: HandCategory = HAND_CATEGORY_ORDER[0]!;
  let formationIndex = 0;
  let preview: FormationPreviewHandle | null = null;
  let saveSeq = 0;

  const back = (): void => options.onBack();
  backButton.addEventListener('click', back);
  addFormationButton.addEventListener('click', addFormation);
  saveButton.addEventListener('click', save);
  resetButton.addEventListener('click', reset);

  /** 返回当前编辑项；牌型可能被清空，因此允许没有选中阵型。 */
  function selected(): FormationDraft | null {
    return drafts[category][formationIndex] ?? null;
  }

  /** 更新 3D 预览，草稿不完整时先清空，避免把无效数据送入渲染层。 */
  function refreshPreview(): void {
    const draft = selected();
    if (!preview || !draft) {
      preview?.render(null);
      return;
    }
    try {
      preview.render(createCardFormation(category, draft));
    } catch {
      preview.render(null);
    }
  }

  function renderCategories(): void {
    categoryList.replaceChildren(
      ...HAND_CATEGORY_ORDER.map((id) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'deck-category';
        button.textContent = HAND_CATEGORY_NAMES[id];
        button.classList.toggle('is-active', id === category);
        button.addEventListener('click', () => {
          category = id;
          formationIndex = 0;
          renderAll();
        });
        return button;
      }),
    );
  }

  function renderFormationList(): void {
    formationList.replaceChildren(
      ...drafts[category].map((formation, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'deck-formation';
        button.classList.toggle('is-active', index === formationIndex);
        button.textContent = formation.name || formation.id || `未命名阵型 ${index + 1}`;
        button.addEventListener('click', () => {
          formationIndex = index;
          renderFormationList();
          renderEditor();
          refreshPreview();
        });
        return button;
      }),
    );
  }

  /** 用小型行列网格表达 rows，row=0 固定标为前排，降低配置语义歧义。 */
  function renderEditor(): void {
    editor.replaceChildren();
    const draft = selected();
    if (!draft) {
      editor.textContent = '该牌型暂无阵型，点击“新增阵型”开始配置。';
      return;
    }

    editor.append(
      textInput('阵型名称', draft.name, (value) => {
        draft.name = value;
        renderFormationList();
      }),
      textInput('阵型 ID', draft.id, (value) => {
        draft.id = value;
      }),
      numberInput('横向间距', draft.colSpacing ?? 1.2, 0.1, (value) => {
        draft.colSpacing = value;
        refreshPreview();
      }),
      numberInput('排间距', draft.rowSpacing ?? 1.4, 0.1, (value) => {
        draft.rowSpacing = value;
        refreshPreview();
      }),
    );

    const rows = document.createElement('section');
    rows.className = 'deck-rows';
    const rowHeading = document.createElement('div');
    rowHeading.className = 'deck-section-title';
    rowHeading.textContent = '兵种站位（最上方为前排）';
    rows.appendChild(rowHeading);
    draft.rows.forEach((row, rowIndex) => rows.appendChild(makeRow(draft, row, rowIndex)));
    const addRowButton = document.createElement('button');
    addRowButton.type = 'button';
    addRowButton.className = 'deck-mini-button';
    addRowButton.textContent = '新增后排';
    addRowButton.addEventListener('click', () => {
      draft.rows.push([UNIT_TYPE_IDS[0]!]);
      renderEditor();
      refreshPreview();
    });
    rows.appendChild(addRowButton);
    editor.appendChild(rows);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'deck-danger-button';
    remove.textContent = '删除当前阵型';
    remove.addEventListener('click', () => {
      drafts[category].splice(formationIndex, 1);
      formationIndex = Math.max(0, formationIndex - 1);
      renderAll();
    });
    editor.appendChild(remove);
  }

  function makeRow(draft: FormationDraft, row: UnitTypeId[], rowIndex: number): HTMLElement {
    const line = document.createElement('div');
    line.className = 'deck-row';
    const label = document.createElement('span');
    label.className = 'deck-row-label';
    label.textContent = rowIndex === 0 ? '前排' : `后排 ${rowIndex}`;
    line.appendChild(label);
    for (const [colIndex, typeId] of row.entries()) {
      const select = document.createElement('select');
      select.setAttribute('aria-label', `${label.textContent}第 ${colIndex + 1} 个兵种`);
      for (const id of UNIT_TYPE_IDS) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = UNIT_CONFIGS[id].name;
        option.selected = id === typeId;
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        row[colIndex] = select.value as UnitTypeId;
        refreshPreview();
      });
      line.appendChild(select);
    }
    const add = actionButton('+', '增加兵种', () => {
      row.push(UNIT_TYPE_IDS[0]!);
      renderEditor();
      refreshPreview();
    });
    line.appendChild(add);
    if (row.length > 1) {
      line.appendChild(
        actionButton('−', '移除最后一个兵种', () => {
          row.pop();
          renderEditor();
          refreshPreview();
        }),
      );
    }
    if (draft.rows.length > 1) {
      line.appendChild(
        actionButton('删排', '删除该排', () => {
          draft.rows.splice(rowIndex, 1);
          renderEditor();
          refreshPreview();
        }),
      );
    }
    return line;
  }

  function addFormation(): void {
    const number = drafts[category].length + 1;
    drafts[category].push({
      id: `${category}_custom_${number}`,
      name: `${HAND_CATEGORY_NAMES[category]}阵型 ${number}`,
      rows: [[UNIT_TYPE_IDS[0]!]],
      colSpacing: 1.2,
      rowSpacing: 1.4,
    });
    formationIndex = drafts[category].length - 1;
    renderAll();
  }

  /** 应用完成后再请求开发服务器写盘，写盘失败不会误报为已保存。 */
  function save(): void {
    try {
      applyCardFormationDrafts(drafts);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
      return;
    }
    const seq = ++saveSeq;
    void persist(drafts).then((result) => {
      if (seq !== saveSeq) return;
      if (result.ok) {
        captureCardFormationsAsDefault();
        drafts = dumpCardFormationDrafts();
        setStatus('已保存并写回 cardFormations.json', false);
      } else {
        setStatus(`已应用到运行时（未能写回文件：${result.error}）`, true);
      }
    });
  }

  function reset(): void {
    drafts = dumpDefaultCardFormationDrafts();
    formationIndex = 0;
    setStatus('已恢复为最近一次配置文件快照', false);
    renderAll();
  }

  function renderAll(): void {
    renderCategories();
    renderFormationList();
    renderEditor();
    refreshPreview();
  }

  renderAll();

  return {
    show() {
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
      preview ??= createFormationPreview(previewRoot);
      preview.resize();
      refreshPreview();
    },
    hide() {
      root.classList.add('is-hidden');
      root.setAttribute('aria-hidden', 'true');
    },
    dispose() {
      backButton.removeEventListener('click', back);
      preview?.dispose();
      preview = null;
    },
  };
}

function textInput(label: string, value: string, onChange: (value: string) => void): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'deck-field';
  row.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.addEventListener('input', () => onChange(input.value));
  row.appendChild(input);
  return row;
}

function numberInput(
  label: string,
  value: number,
  step: number,
  onChange: (value: number) => void,
): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'deck-field';
  row.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0.1';
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => onChange(Number(input.value)));
  row.appendChild(input);
  return row;
}

function actionButton(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'deck-icon-button';
  button.textContent = text;
  button.title = title;
  button.addEventListener('click', onClick);
  return button;
}

function setStatus(rootText: string, isError: boolean): void {
  const status = required<HTMLElement>('#deck-status');
  status.textContent = rootText;
  status.classList.toggle('is-error', isError);
}

/** 开发服务器负责源码写盘，静态构建中该请求会失败并由调用方明确提示。 */
async function persist(drafts: CardFormationDrafts): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch('/__pb/card-formations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(drafts),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`卡组配置页缺少元素：${selector}`);
  return element;
}
