import {
  FORMATION_COL_SPACING,
  FORMATION_ROW_SPACING,
  FORMATION_THUMB_SCALE,
  SPECIAL_TIERS,
  UNIT_CONFIGS,
  UNIT_TYPE_IDS,
  applySpecialTierDrafts,
  captureSpecialTiersAsDefault,
  createDefaultSpecialUnitFormation,
  createSpecialUnitCardFormation,
  dumpDefaultSpecialTierDrafts,
  dumpSpecialTierDrafts,
  getFormationSpecialTier,
  isBuildingConfig,
  type CardFormation,
  type SpecialTier,
  type SpecialTierDrafts,
  type SpecialUnitFormationDraft,
  type UnitTypeId,
} from '@pb/sim';
import { appendFormationTag, applyFormationNameFallback } from './formationTag.js';
import { createFormationPreview, type FormationPreviewHandle } from '../view/formationPreview.js';
import { getFormationThumbnail } from '../view/formationThumbnail.js';

export interface SpecialTierPageOptions {
  onBack: () => void;
}

export interface SpecialTierPageHandle {
  show(): void;
  hide(): void;
  dispose(): void;
}

type PreviewMode = '3d' | 'button';

/** 预览用占位哨兵；category 不影响站位，只为复用展开入口。 */
const PREVIEW_SENTINEL = { id: 'special_preview', match: { kind: 'any' as const } };

/** 开发服档位表：四档名单与每兵种阵型参数，保存写回 specialTiers.json。 */
export function createSpecialTierPage(options: SpecialTierPageOptions): SpecialTierPageHandle {
  const root = required<HTMLElement>('#special-tiers');
  const backButton = required<HTMLButtonElement>('#btn-special-tiers-back', root);
  const saveButton = required<HTMLButtonElement>('#btn-special-tiers-save', root);
  const resetButton = required<HTMLButtonElement>('#btn-special-tiers-reset', root);
  const table = required<HTMLElement>('#special-tiers-table', root);
  const editor = required<HTMLElement>('#special-tiers-editor', root);
  const statusEl = required<HTMLElement>('#special-tiers-status', root);
  const tab3d = required<HTMLButtonElement>('#special-tiers-preview-tab-3d', root);
  const tabButton = required<HTMLButtonElement>('#special-tiers-preview-tab-button', root);
  const previewRoot = required<HTMLElement>('#special-tiers-preview', root);
  const buttonPreviewRoot = required<HTMLElement>('#special-tiers-preview-button', root);

  let drafts = dumpSpecialTierDrafts();
  let selected: { tier: SpecialTier; typeId: UnitTypeId } | null = null;
  let previewMode: PreviewMode = '3d';
  let preview: FormationPreviewHandle | null = null;
  let saveSeq = 0;
  let buttonThumbGeneration = 0;

  const back = (): void => options.onBack();
  const show3d = (): void => setPreviewMode('3d');
  const showButton = (): void => setPreviewMode('button');
  backButton.addEventListener('click', back);
  saveButton.addEventListener('click', save);
  resetButton.addEventListener('click', reset);
  tab3d.addEventListener('click', show3d);
  tabButton.addEventListener('click', showButton);

  /** 把档位草稿立刻应用到运行时，让卡组页哨兵文案与预览跟上。 */
  function commitDrafts(remountTable: boolean): void {
    try {
      applySpecialTierDrafts(drafts);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
      return;
    }
    ensureSelection();
    if (remountTable) renderTable();
    if (remountTable) renderEditor();
    refreshPreview();
    setStatus('未保存的修改已应用到运行时', false);
  }

  /** 默认选 5 档第一个；当前选中被删后落到仍存在的兵种。 */
  function ensureSelection(): void {
    if (selected && drafts[selected.tier].units.includes(selected.typeId)) return;
    for (const tier of [...SPECIAL_TIERS].reverse()) {
      const typeId = drafts[tier].units[0];
      if (typeId) {
        selected = { tier, typeId };
        return;
      }
    }
    selected = null;
  }

  /** 点选兵种行时只刷新高亮，避免整表重挂丢失下拉焦点。 */
  function selectUnit(tier: SpecialTier, typeId: UnitTypeId): void {
    selected = { tier, typeId };
    for (const row of table.querySelectorAll<HTMLElement>('.deck-tier-unit-row')) {
      row.classList.toggle(
        'is-active',
        row.dataset.tier === String(tier) && row.dataset.typeId === typeId,
      );
    }
    renderEditor();
    refreshPreview();
  }

  /** 其他档已占用的兵种，当前档下拉里不再出现。 */
  function unitsTakenByOtherTiers(except: SpecialTier): Set<UnitTypeId> {
    const taken = new Set<UnitTypeId>();
    for (const tier of SPECIAL_TIERS) {
      if (tier === except) continue;
      for (const typeId of drafts[tier].units) taken.add(typeId);
    }
    return taken;
  }

  /** 四列只编名单；阵型参数改到右侧选中兵种。 */
  function renderTable(): void {
    table.replaceChildren();
    const grid = document.createElement('div');
    grid.className = 'deck-tier-grid';
    for (const tier of SPECIAL_TIERS) {
      grid.appendChild(renderColumn(tier));
    }
    table.appendChild(grid);
  }

  /** 单档：兵种增删换人。 */
  function renderColumn(tier: SpecialTier): HTMLElement {
    const draft = drafts[tier];
    const column = document.createElement('section');
    column.className = 'deck-tier-column';
    column.dataset.tier = String(tier);
    const title = document.createElement('div');
    title.className = 'deck-tier-column-title';
    title.textContent = `${tier}档`;
    column.appendChild(title);

    const list = document.createElement('div');
    list.className = 'deck-tier-units';
    const taken = unitsTakenByOtherTiers(tier);
    draft.units.forEach((typeId, index) => {
      list.appendChild(renderUnitRow(tier, typeId, index, taken));
    });
    column.appendChild(list);

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'deck-mini-button';
    add.textContent = '添加兵种';
    const nextId = UNIT_TYPE_IDS.find((id) => !taken.has(id) && !draft.units.includes(id));
    add.disabled = nextId === undefined;
    add.addEventListener('click', () => {
      if (!nextId) return;
      draft.units.push(nextId);
      draft.formations[nextId] = createDefaultSpecialUnitFormation(nextId);
      selected = { tier, typeId: nextId };
      commitDrafts(true);
    });
    column.appendChild(add);
    return column;
  }

  /** 单行兵种下拉与删除；点行使右侧编辑该兵种阵型。 */
  function renderUnitRow(
    tier: SpecialTier,
    typeId: UnitTypeId,
    index: number,
    taken: ReadonlySet<UnitTypeId>,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'deck-tier-unit-row';
    row.dataset.tier = String(tier);
    row.dataset.typeId = typeId;
    if (selected?.tier === tier && selected.typeId === typeId) row.classList.add('is-active');
    row.addEventListener('click', () => selectUnit(tier, typeId));

    const select = document.createElement('select');
    for (const id of UNIT_TYPE_IDS) {
      if (taken.has(id) && id !== typeId) continue;
      const option = document.createElement('option');
      option.value = id;
      option.textContent = UNIT_CONFIGS[id]?.name ?? id;
      if (id === typeId) option.selected = true;
      select.appendChild(option);
    }
    // 未选中时拦住 mousedown，避免点行切兵种却把下拉展开。
    select.addEventListener('mousedown', (event) => {
      if (selected?.tier === tier && selected.typeId === typeId) return;
      event.preventDefault();
      selectUnit(tier, typeId);
    });
    select.addEventListener('change', () => {
      const next = select.value as UnitTypeId;
      const prev = drafts[tier].units[index];
      drafts[tier].units[index] = next;
      if (prev !== next) {
        // 换人时参数跟着槽位走，避免误触下拉把间距放大清掉。
        drafts[tier].formations[next] =
          drafts[tier].formations[prev] ?? createDefaultSpecialUnitFormation(next);
        delete drafts[tier].formations[prev];
      }
      selected = { tier, typeId: next };
      commitDrafts(true);
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'deck-icon-button';
    remove.textContent = '×';
    remove.title = '移出该档';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      const [removed] = drafts[tier].units.splice(index, 1);
      if (removed) delete drafts[tier].formations[removed];
      commitDrafts(true);
    });
    row.append(select, remove);
    return row;
  }

  /** 右侧只编当前选中兵种的数量/间距/放大。 */
  function renderEditor(): void {
    editor.replaceChildren();
    if (!selected) {
      editor.textContent = '请先在某一档添加兵种。';
      return;
    }
    const formation = drafts[selected.tier].formations[selected.typeId];
    if (!formation) {
      editor.textContent = '缺少该兵种的阵型配置。';
      return;
    }
    const title = document.createElement('div');
    title.className = 'deck-section-title';
    title.textContent = `${UNIT_CONFIGS[selected.typeId]?.name ?? selected.typeId}（${selected.tier}档）`;
    const building = isBuildingConfig(UNIT_CONFIGS[selected.typeId]);
    const hint = document.createElement('p');
    hint.className = 'deck-tier-hint';
    hint.textContent = '每阵数量对建筑不生效，建筑仍单独成阵。';
    editor.append(
      title,
      integerInput(
        '每阵数量',
        formation.unitCount,
        (value) => updateSelectedFormation({ unitCount: value }),
        building,
      ),
      numberInput('横向间距', formation.colSpacing ?? FORMATION_COL_SPACING, 0.1, (value) =>
        updateSelectedFormation({ colSpacing: value }),
      ),
      numberInput('排间距', formation.rowSpacing ?? FORMATION_ROW_SPACING, 0.1, (value) =>
        updateSelectedFormation({ rowSpacing: value }),
      ),
      numberInput('阵型放大', formation.thumbScale ?? FORMATION_THUMB_SCALE, 0.05, (value) =>
        updateSelectedFormation({ thumbScale: value }),
      ),
      hint,
    );
  }

  /** 只改当前兵种参数，不重挂表单以免输入框失焦。 */
  function updateSelectedFormation(patch: Partial<SpecialUnitFormationDraft>): void {
    if (!selected) return;
    const formation = drafts[selected.tier].formations[selected.typeId];
    if (!formation) return;
    Object.assign(formation, patch);
    commitDrafts(false);
  }

  /** 切换 3D / 按钮预览页签。 */
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

  /** 按当前页签更新预览；无选中兵种时先清空。 */
  function refreshPreview(): void {
    if (previewMode === 'button') {
      preview?.render(null);
      void refreshButtonPreview();
      return;
    }
    buttonPreviewRoot.replaceChildren();
    if (!preview || !selected) {
      preview?.render(null);
      return;
    }
    preview.render(createSpecialUnitCardFormation('full_house', PREVIEW_SENTINEL, selected.typeId));
  }

  /** 按钮页签画出当前档全部着色按钮，与卡组页哨兵预览一致。 */
  async function refreshButtonPreview(): Promise<void> {
    const generation = ++buttonThumbGeneration;
    buttonPreviewRoot.replaceChildren();
    if (!selected) return;
    const formations = drafts[selected.tier].units.map((typeId) =>
      createSpecialUnitCardFormation('full_house', PREVIEW_SENTINEL, typeId),
    );
    const pending: Array<{ button: HTMLButtonElement; formation: CardFormation }> = [];
    for (const formation of formations) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = formationOptionClassName(formation);
      button.setAttribute('aria-label', formation.name);
      const image = document.createElement('img');
      image.className = 'formation-thumb';
      image.alt = '';
      button.appendChild(image);
      appendFormationTag(button, formation);
      buttonPreviewRoot.appendChild(button);
      pending.push({ button, formation });
    }
    for (const item of pending) {
      const url = await getFormationThumbnail(item.formation);
      if (generation !== buttonThumbGeneration) return;
      if (url) {
        item.button.querySelector('img.formation-thumb')?.setAttribute('src', url);
        continue;
      }
      applyFormationNameFallback(item.button, item.formation.name);
    }
  }

  /** 应用到运行时并尝试写回 specialTiers.json。 */
  function save(): void {
    try {
      applySpecialTierDrafts(drafts);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
      return;
    }
    const seq = ++saveSeq;
    void persistSpecialTiers(drafts).then((result) => {
      if (seq !== saveSeq) return;
      if (result.ok) {
        captureSpecialTiersAsDefault();
        drafts = dumpSpecialTierDrafts();
        setStatus('已保存并写回 specialTiers.json', false);
      } else {
        setStatus(`已应用到运行时（未能写回文件：${result.error}）`, true);
      }
    });
  }

  function reset(): void {
    drafts = dumpDefaultSpecialTierDrafts();
    applySpecialTierDrafts(drafts);
    selected = null;
    ensureSelection();
    setStatus('已恢复为最近一次配置文件快照', false);
    renderTable();
    renderEditor();
    refreshPreview();
  }

  function setStatus(text: string, isError: boolean): void {
    statusEl.textContent = text;
    statusEl.classList.toggle('is-error', isError);
  }

  ensureSelection();
  renderTable();
  renderEditor();

  return {
    show() {
      drafts = dumpSpecialTierDrafts();
      ensureSelection();
      renderTable();
      renderEditor();
      setStatus('改完点保存写回配置文件', false);
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
      saveButton.removeEventListener('click', save);
      resetButton.removeEventListener('click', reset);
      tab3d.removeEventListener('click', show3d);
      tabButton.removeEventListener('click', showButton);
      preview?.dispose();
      preview = null;
      buttonPreviewRoot.replaceChildren();
    },
  };
}

function integerInput(
  label: string,
  value: number,
  onChange: (value: number) => void,
  disabled = false,
): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'deck-field';
  row.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.step = '1';
  input.value = String(value);
  input.disabled = disabled;
  input.addEventListener('input', () => {
    const parsed = Number(input.value);
    if (!Number.isInteger(parsed) || parsed < 1) return;
    onChange(parsed);
  });
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

/** 独占特殊兵种按档位着色；与卡组页 / 局内按钮一致。 */
function formationOptionClassName(formation: CardFormation): string {
  const tier = getFormationSpecialTier(formation);
  return tier ? `formation-option is-tier-${tier}` : 'formation-option';
}

/** 开发服务器负责源码写盘，静态构建中该请求会失败并由调用方明确提示。 */
async function persistSpecialTiers(
  tiers: SpecialTierDrafts,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch('/__pb/special-tiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tiers),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: payload?.error ?? `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`档位表配置页缺少元素：${selector}`);
  return element;
}
