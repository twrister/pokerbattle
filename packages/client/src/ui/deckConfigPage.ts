import {
  FORMATION_THUMB_SCALE,
  HAND_CATEGORY_NAMES,
  HAND_CATEGORY_ORDER,
  UNIT_CONFIGS,
  UNIT_TYPE_IDS,
  applyCardFormationDrafts,
  captureCardFormationsAsDefault,
  createCardFormation,
  dumpCardFormationDrafts,
  dumpDefaultCardFormationDrafts,
  isBuildingConfig,
  isBuildingOnlyFormation,
  type CardFormation,
  type CardFormationDrafts,
  type FormationDraft,
  type HandCategory,
  type UnitTypeId,
} from '@pb/sim';
import { IS_DEV_SERVER } from '../env.js';
import { createFormationPreview, type FormationPreviewHandle } from '../view/formationPreview.js';
import { getFormationThumbnail } from '../view/formationThumbnail.js';

/** 普通阵型默认落子（非建筑） */
const DEFAULT_MOBILE_TYPE_ID =
  UNIT_TYPE_IDS.find((id) => !isBuildingConfig(UNIT_CONFIGS[id])) ?? UNIT_TYPE_IDS[0]!;

type PreviewMode = '3d' | 'button';

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
  const buttonPreviewRoot = required<HTMLElement>('#deck-preview-button', root);
  const tab3d = required<HTMLButtonElement>('#deck-preview-tab-3d', root);
  const tabButton = required<HTMLButtonElement>('#deck-preview-tab-button', root);
  const backButton = required<HTMLButtonElement>('#btn-deck-back', root);
  const addFormationButton = required<HTMLButtonElement>('#btn-deck-add-formation', root);
  const saveButton = required<HTMLButtonElement>('#btn-deck-save', root);
  const resetButton = required<HTMLButtonElement>('#btn-deck-reset', root);

  let drafts = dumpCardFormationDrafts();
  let category: HandCategory = HAND_CATEGORY_ORDER[0]!;
  let formationIndex = 0;
  let preview: FormationPreviewHandle | null = null;
  let previewMode: PreviewMode = '3d';
  /** 丢弃切换阵型后仍返回的旧缩略图，避免按钮预览闪回。 */
  let buttonThumbGeneration = 0;
  let saveSeq = 0;

  const back = (): void => options.onBack();
  backButton.addEventListener('click', back);
  // 新增/编辑/重置/保存仅开发服开放；正式服只保留浏览与预览
  if (IS_DEV_SERVER) {
    addFormationButton.addEventListener('click', addFormation);
    saveButton.addEventListener('click', save);
    resetButton.addEventListener('click', reset);
  }
  tab3d.addEventListener('click', () => setPreviewMode('3d'));
  tabButton.addEventListener('click', () => setPreviewMode('button'));

  /** 返回当前编辑项；牌型可能被清空，因此允许没有选中阵型。 */
  function selected(): FormationDraft | null {
    return drafts[category][formationIndex] ?? null;
  }

  /** 切换 3D / 按钮预览页签，并刷新当前模式内容。 */
  function setPreviewMode(mode: PreviewMode): void {
    previewMode = mode;
    const is3d = mode === '3d';
    tab3d.classList.toggle('is-active', is3d);
    tabButton.classList.toggle('is-active', !is3d);
    tab3d.setAttribute('aria-selected', String(is3d));
    tabButton.setAttribute('aria-selected', String(!is3d));
    previewRoot.classList.toggle('is-hidden', !is3d);
    buttonPreviewRoot.classList.toggle('is-hidden', is3d);
    refreshPreview();
    if (is3d) preview?.resize();
  }

  /** 按当前页签更新预览；草稿不完整时先清空，避免把无效数据送入渲染层。 */
  function refreshPreview(): void {
    if (previewMode === 'button') {
      preview?.render(null);
      void refreshButtonPreview();
      return;
    }
    buttonPreviewRoot.replaceChildren();
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

  /** 复用兵种搭配按钮的缩略图逻辑，所见即所得。 */
  async function refreshButtonPreview(): Promise<void> {
    const generation = ++buttonThumbGeneration;
    buttonPreviewRoot.replaceChildren();
    const draft = selected();
    if (!draft) return;

    let formation: CardFormation;
    try {
      formation = createCardFormation(category, draft);
    } catch {
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'formation-option';
    button.setAttribute('aria-label', `${formation.name}：${formatFormationUnits(formation)}`);
    const image = document.createElement('img');
    image.className = 'formation-thumb';
    image.alt = '';
    button.appendChild(image);
    buttonPreviewRoot.appendChild(button);

    const url = await getFormationThumbnail(formation);
    if (generation !== buttonThumbGeneration) return;
    if (url) {
      image.src = url;
      return;
    }
    // 无 WebGL 时退回文字，与手牌阵型按钮一致。
    button.textContent = formation.name;
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
          if (IS_DEV_SERVER) renderEditor();
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

    const buildingOnly = isBuildingOnlyFormation(draft);

    editor.append(
      textInput('阵型名称', draft.name, (value) => {
        draft.name = value;
        renderFormationList();
      }),
      textInput('阵型 ID', draft.id, (value) => {
        draft.id = value;
      }),
    );

    // 单建筑阵型不需要间距；普通阵型才显示
    if (!buildingOnly) {
      editor.append(
        numberInput('横向间距', draft.colSpacing ?? 1.2, 0.1, (value) => {
          draft.colSpacing = value;
          refreshPreview();
        }),
        numberInput('排间距', draft.rowSpacing ?? 1.4, 0.1, (value) => {
          draft.rowSpacing = value;
          refreshPreview();
        }),
      );
    }

    // 仅影响按钮缩略图取景，与 3D 预览站位无关
    editor.append(
      numberInput('阵型放大', draft.thumbScale ?? FORMATION_THUMB_SCALE, 0.05, (value) => {
        draft.thumbScale = value;
        if (previewMode === 'button') refreshPreview();
      }),
    );

    const rows = document.createElement('section');
    rows.className = 'deck-rows';
    const rowHeading = document.createElement('div');
    rowHeading.className = 'deck-section-title';
    rowHeading.textContent = buildingOnly
      ? '建筑站位（单建筑阵型：只能放一个建筑）'
      : '兵种站位（最上方为前排；建筑不可与兵种混编）';
    rows.appendChild(rowHeading);
    draft.rows.forEach((row, rowIndex) => rows.appendChild(makeRow(draft, row, rowIndex)));

    if (!buildingOnly) {
      const addRowButton = document.createElement('button');
      addRowButton.type = 'button';
      addRowButton.className = 'deck-mini-button';
      addRowButton.textContent = '新增后排';
      addRowButton.addEventListener('click', () => {
        draft.rows.push([DEFAULT_MOBILE_TYPE_ID]);
        renderEditor();
        refreshPreview();
      });
      rows.appendChild(addRowButton);
    }
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
    const buildingOnly = isBuildingOnlyFormation(draft);
    const line = document.createElement('div');
    line.className = 'deck-row';
    const label = document.createElement('span');
    label.className = 'deck-row-label';
    label.textContent = buildingOnly ? '建筑' : rowIndex === 0 ? '前排' : `后排 ${rowIndex}`;
    line.appendChild(label);
    for (const [colIndex, typeId] of row.entries()) {
      const select = document.createElement('select');
      select.setAttribute('aria-label', `${label.textContent}第 ${colIndex + 1} 个单位`);
      for (const id of UNIT_TYPE_IDS) {
        const option = document.createElement('option');
        option.value = id;
        const footprint = UNIT_CONFIGS[id].footprint;
        option.textContent = footprint > 0
          ? `${UNIT_CONFIGS[id].name}（${footprint}×${footprint}）`
          : UNIT_CONFIGS[id].name;
        option.selected = id === typeId;
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        const next = select.value as UnitTypeId;
        // 选建筑时强制塌缩为单建筑阵型，避免与兵种混编
        if (isBuildingConfig(UNIT_CONFIGS[next])) {
          draft.rows = [[next]];
        } else if (buildingOnly) {
          draft.rows = [[next]];
        } else {
          row[colIndex] = next;
        }
        renderEditor();
        refreshPreview();
      });
      line.appendChild(select);
    }
    if (!buildingOnly) {
      const add = actionButton('+', '增加兵种', () => {
        row.push(DEFAULT_MOBILE_TYPE_ID);
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
    }
    return line;
  }

  function addFormation(): void {
    const number = drafts[category].length + 1;
    drafts[category].push({
      id: `${category}_custom_${number}`,
      name: `${HAND_CATEGORY_NAMES[category]}阵型 ${number}`,
      rows: [[DEFAULT_MOBILE_TYPE_ID]],
      colSpacing: 1.2,
      rowSpacing: 1.4,
      thumbScale: FORMATION_THUMB_SCALE,
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
    if (IS_DEV_SERVER) renderEditor();
    else editor.replaceChildren();
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
      buttonThumbGeneration += 1;
      backButton.removeEventListener('click', back);
      preview?.dispose();
      preview = null;
      buttonPreviewRoot.replaceChildren();
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

/** 把阵型 rows 格式化为「前：民兵x2 / 后：弓手x2」，与手牌阵型按钮 aria 文案一致。 */
function formatFormationUnits(formation: CardFormation): string {
  if (formation.rows.length === 0) return '';
  if (formation.rows.length === 1) {
    return formatRowUnits(formation.rows[0]!);
  }
  return formation.rows
    .map((row, index) => {
      const label = index === 0 ? '前' : index === formation.rows.length - 1 ? '后' : `排${index + 1}`;
      return `${label}：${formatRowUnits(row)}`;
    })
    .join(' / ');
}

/** 单排兵种短标签，如「民兵x2 · 弓手x1」。 */
function formatRowUnits(row: readonly UnitTypeId[]): string {
  const counts = new Map<UnitTypeId, number>();
  const order: UnitTypeId[] = [];
  for (const typeId of row) {
    if (!counts.has(typeId)) order.push(typeId);
    counts.set(typeId, (counts.get(typeId) ?? 0) + 1);
  }
  return order
    .map((typeId) => {
      const name = UNIT_CONFIGS[typeId]?.name.replace(/（.*?）/, '') ?? typeId;
      return `${name}x${counts.get(typeId)}`;
    })
    .join(' · ');
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
