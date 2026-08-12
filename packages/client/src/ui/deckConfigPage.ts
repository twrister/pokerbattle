import {
  FORMATION_MATCH_RANKS,
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
  getPreviewCardsForFormation,
  isBuildingConfig,
  isBuildingOnlyFormation,
  resolveCardFormation,
  type CardFormation,
  type CardFormationDrafts,
  type CardRank,
  type FormationDraft,
  type FormationLevelRule,
  type FormationMatchRule,
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
  /** 开发服：打开牌型概率工具。 */
  onOpenHandOdds?: () => void;
}

export interface DeckConfigPageHandle {
  show(): void;
  hide(): void;
  dispose(): void;
}

/** 卡组规则预览页：牌面与数量由 sim 统一推导，页面只浏览可选方案。 */
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
  const handOddsButton = required<HTMLButtonElement>('#btn-deck-hand-odds', root);
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
  const openHandOdds = (): void => options.onOpenHandOdds?.();
  backButton.addEventListener('click', back);
  // 新增/编辑/重置/保存/概率工具仅开发服开放；正式服只保留浏览与预览
  if (IS_DEV_SERVER) {
    addFormationButton.addEventListener('click', addFormation);
    handOddsButton.addEventListener('click', openHandOdds);
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

  /**
   * 用样例牌面走规则引擎展开预览，避免 JSON 占位 rows 数量与真实出牌不一致
   *（例如三顺弓手占位曾只写 1 个，实际应出 3 个）。
   */
  function previewFormationFromDraft(draft: FormationDraft): CardFormation | null {
    return previewFormationFromDraftFor(category, draft);
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
    preview.render(previewFormationFromDraft(draft));
  }

  /** 复用兵种搭配按钮的缩略图逻辑，所见即所得。 */
  async function refreshButtonPreview(): Promise<void> {
    const generation = ++buttonThumbGeneration;
    buttonPreviewRoot.replaceChildren();
    const draft = selected();
    if (!draft) return;

    const formation = previewFormationFromDraft(draft);
    if (!formation) return;

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

  /**
   * 编辑方案元数据：名称、牌面匹配、等级、站位 rows、间距与缩略图放大。
   * 全部牌型的兵种搭配都以本页配置为准。
   */
  function renderEditor(): void {
    editor.replaceChildren();
    const draft = selected();
    if (!draft) {
      editor.textContent = '该牌型暂无可选方案。';
      return;
    }

    const buildingOnly = isBuildingOnlyFormation(draft);
    const rule = document.createElement('section');
    rule.className = 'deck-rows';
    rule.innerHTML = `
      <div class="deck-section-title">规则说明</div>
      <p>${HAND_CATEGORY_NAMES[category]}的兵种站位、牌面匹配与等级均以本页配置为准。</p>
    `;
    editor.appendChild(rule);

    editor.append(
      textInput('阵型名称', draft.name, (value) => {
        draft.name = value;
        renderFormationList();
      }),
      textInput('阵型 ID', draft.id, (value) => {
        draft.id = value;
        refreshPreview();
      }),
    );

    editor.appendChild(renderMatchEditor(draft));
    editor.appendChild(renderLevelEditor(draft));
    editor.appendChild(renderRowsEditor(draft));

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

  /** 牌面匹配编辑：数字牌 / 指定点数 / 大小王 / 任意。 */
  function renderMatchEditor(draft: FormationDraft): HTMLElement {
    const section = document.createElement('section');
    section.className = 'deck-rows';
    const title = document.createElement('div');
    title.className = 'deck-section-title';
    title.textContent = '牌面匹配';
    section.appendChild(title);

    const kindRow = document.createElement('label');
    kindRow.className = 'deck-field';
    kindRow.textContent = '匹配类型';
    const kindSelect = document.createElement('select');
    const kindOptions: Array<{ value: FormationMatchRule['kind']; label: string }> = [
      { value: 'numbers', label: '数字牌 2～10' },
      { value: 'ranks', label: '指定点数' },
      { value: 'joker', label: '大小王' },
      { value: 'any', label: '任意（牌型命中即可）' },
    ];
    for (const option of kindOptions) {
      const el = document.createElement('option');
      el.value = option.value;
      el.textContent = option.label;
      if (option.value === draft.match.kind) el.selected = true;
      kindSelect.appendChild(el);
    }
    kindSelect.addEventListener('change', () => {
      const kind = kindSelect.value as FormationMatchRule['kind'];
      if (kind === 'numbers') draft.match = { kind: 'numbers' };
      else if (kind === 'any') draft.match = { kind: 'any' };
      else if (kind === 'joker') draft.match = { kind: 'joker', joker: 'black' };
      else draft.match = { kind: 'ranks', ranks: ['5'] };
      if (IS_DEV_SERVER) renderEditor();
      refreshPreview();
    });
    kindRow.appendChild(kindSelect);
    section.appendChild(kindRow);

    if (draft.match.kind === 'joker') {
      const jokerRow = document.createElement('label');
      jokerRow.className = 'deck-field';
      jokerRow.textContent = '王牌';
      const jokerSelect = document.createElement('select');
      for (const [value, label] of [
        ['black', '小王'],
        ['red', '大王'],
      ] as const) {
        const el = document.createElement('option');
        el.value = value;
        el.textContent = label;
        if (draft.match.joker === value) el.selected = true;
        jokerSelect.appendChild(el);
      }
      jokerSelect.addEventListener('change', () => {
        draft.match = { kind: 'joker', joker: jokerSelect.value as 'black' | 'red' };
        refreshPreview();
      });
      jokerRow.appendChild(jokerSelect);
      section.appendChild(jokerRow);
    }

    if (draft.match.kind === 'ranks') {
      const ranksBox = document.createElement('div');
      ranksBox.className = 'deck-rank-checks';
      const selectedRanks = new Set(draft.match.ranks);
      for (const rank of FORMATION_MATCH_RANKS) {
        const label = document.createElement('label');
        label.className = 'deck-rank-check';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = selectedRanks.has(rank);
        input.addEventListener('change', () => {
          const next = new Set((draft.match as { kind: 'ranks'; ranks: CardRank[] }).ranks);
          if (input.checked) next.add(rank);
          else next.delete(rank);
          // 保持 FORMATION_MATCH_RANKS 顺序，便于预览样例稳定。
          draft.match = {
            kind: 'ranks',
            ranks: FORMATION_MATCH_RANKS.filter((item) => next.has(item)),
          };
          refreshPreview();
        });
        label.append(input, document.createTextNode(rank));
        ranksBox.appendChild(label);
      }
      section.appendChild(ranksBox);
    }

    return section;
  }

  /** 等级规则编辑：固定 / 按数字牌点数 / 数字与人头分档。 */
  function renderLevelEditor(draft: FormationDraft): HTMLElement {
    const section = document.createElement('section');
    section.className = 'deck-rows';
    const title = document.createElement('div');
    title.className = 'deck-section-title';
    title.textContent = '等级规则';
    section.appendChild(title);

    const kindRow = document.createElement('label');
    kindRow.className = 'deck-field';
    kindRow.textContent = '规则类型';
    const kindSelect = document.createElement('select');
    const kindOptions: Array<{ value: FormationLevelRule['kind']; label: string }> = [
      { value: 'fixed', label: '固定等级' },
      { value: 'byNumberRank', label: '按数字牌点数' },
      { value: 'numberOrFace', label: '数字/人头分档' },
    ];
    for (const option of kindOptions) {
      const el = document.createElement('option');
      el.value = option.value;
      el.textContent = option.label;
      if (option.value === draft.level.kind) el.selected = true;
      kindSelect.appendChild(el);
    }
    kindSelect.addEventListener('change', () => {
      const kind = kindSelect.value as FormationLevelRule['kind'];
      if (kind === 'fixed') draft.level = { kind: 'fixed', value: 1 };
      else if (kind === 'byNumberRank') draft.level = { kind: 'byNumberRank', offset: 0 };
      else draft.level = { kind: 'numberOrFace', number: 1, face: 2 };
      if (IS_DEV_SERVER) renderEditor();
      refreshPreview();
    });
    kindRow.appendChild(kindSelect);
    section.appendChild(kindRow);

    if (draft.level.kind === 'fixed') {
      section.appendChild(
        numberInput('固定等级', draft.level.value, 1, (value) => {
          draft.level = { kind: 'fixed', value: Math.max(1, Math.floor(value)) };
          refreshPreview();
        }),
      );
    } else if (draft.level.kind === 'byNumberRank') {
      section.appendChild(
        numberInput('点数偏移', draft.level.offset, 1, (value) => {
          draft.level = { kind: 'byNumberRank', offset: Math.floor(value) };
          refreshPreview();
        }),
      );
    } else {
      section.append(
        numberInput('数字牌等级', draft.level.number, 1, (value) => {
          const face = draft.level.kind === 'numberOrFace' ? draft.level.face : 2;
          draft.level = { kind: 'numberOrFace', number: Math.max(1, Math.floor(value)), face };
          refreshPreview();
        }),
        numberInput('人头牌等级', draft.level.face, 1, (value) => {
          const number = draft.level.kind === 'numberOrFace' ? draft.level.number : 1;
          draft.level = { kind: 'numberOrFace', number, face: Math.max(1, Math.floor(value)) };
          refreshPreview();
        }),
      );
    }

    return section;
  }

  /** 单张站位编辑：增删排/单位，下拉选择兵种。 */
  function renderRowsEditor(draft: FormationDraft): HTMLElement {
    const section = document.createElement('section');
    section.className = 'deck-rows';
    const title = document.createElement('div');
    title.className = 'deck-section-title';
    title.textContent = '站位配置';
    section.appendChild(title);

    draft.rows.forEach((row, rowIndex) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'deck-row';
      const label = document.createElement('span');
      label.className = 'deck-row-label';
      label.textContent =
        rowIndex === 0 ? '前排' : rowIndex === draft.rows.length - 1 ? '后排' : `排${rowIndex + 1}`;
      rowEl.appendChild(label);

      row.forEach((typeId, colIndex) => {
        const select = document.createElement('select');
        for (const id of UNIT_TYPE_IDS) {
          const option = document.createElement('option');
          option.value = id;
          option.textContent = UNIT_CONFIGS[id]?.name ?? id;
          if (id === typeId) option.selected = true;
          select.appendChild(option);
        }
        select.addEventListener('change', () => {
          row[colIndex] = select.value as UnitTypeId;
          if (IS_DEV_SERVER) renderEditor();
          refreshPreview();
        });
        rowEl.appendChild(select);

        const removeUnit = document.createElement('button');
        removeUnit.type = 'button';
        removeUnit.className = 'deck-icon-button';
        removeUnit.textContent = '×';
        removeUnit.title = '移除单位';
        removeUnit.addEventListener('click', () => {
          if (row.length <= 1 && draft.rows.length <= 1) return;
          row.splice(colIndex, 1);
          if (row.length === 0) draft.rows.splice(rowIndex, 1);
          if (IS_DEV_SERVER) renderEditor();
          refreshPreview();
        });
        rowEl.appendChild(removeUnit);
      });

      const addUnit = document.createElement('button');
      addUnit.type = 'button';
      addUnit.className = 'deck-mini-button';
      addUnit.textContent = '+单位';
      addUnit.addEventListener('click', () => {
        row.push(DEFAULT_MOBILE_TYPE_ID);
        if (IS_DEV_SERVER) renderEditor();
        refreshPreview();
      });
      rowEl.appendChild(addUnit);

      if (draft.rows.length > 1) {
        const removeRow = document.createElement('button');
        removeRow.type = 'button';
        removeRow.className = 'deck-mini-button';
        removeRow.textContent = '删排';
        removeRow.addEventListener('click', () => {
          draft.rows.splice(rowIndex, 1);
          if (IS_DEV_SERVER) renderEditor();
          refreshPreview();
        });
        rowEl.appendChild(removeRow);
      }

      section.appendChild(rowEl);
    });

    const addRow = document.createElement('button');
    addRow.type = 'button';
    addRow.className = 'deck-mini-button';
    addRow.textContent = '+后排';
    addRow.addEventListener('click', () => {
      draft.rows.push([DEFAULT_MOBILE_TYPE_ID]);
      if (IS_DEV_SERVER) renderEditor();
      refreshPreview();
    });
    section.appendChild(addRow);
    return section;
  }

  function addFormation(): void {
    const number = drafts[category].length + 1;
    drafts[category].push({
      id: `${category}_custom_${number}`,
      name: `${HAND_CATEGORY_NAMES[category]}阵型 ${number}`,
      match: { kind: 'any' },
      level: { kind: 'fixed', value: 1 },
      rows: [[DEFAULT_MOBILE_TYPE_ID]],
      colSpacing: 1.2,
      rowSpacing: 1.4,
      thumbScale: FORMATION_THUMB_SCALE,
    });
    formationIndex = drafts[category].length - 1;
    renderAll();
  }

  /** 用样例牌面走配置规则展开预览。 */
  function previewFormationFromDraftFor(
    handCategory: HandCategory,
    draft: FormationDraft,
  ): CardFormation | null {
    try {
      const template = createCardFormation(handCategory, draft);
      const cards = getPreviewCardsForFormation(handCategory, draft);
      return resolveCardFormation(template, cards) ?? template;
    } catch {
      return null;
    }
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
      if (IS_DEV_SERVER) {
        handOddsButton.removeEventListener('click', openHandOdds);
      }
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
