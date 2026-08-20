import {
  FORMATION_MATCH_RANKS,
  FORMATION_THUMB_SCALE,
  FUSE_BOMB_DAMAGE_RANKS,
  FUSE_BOMB_DAMAGE_RANK_LABELS,
  HAND_CATEGORY_NAMES,
  HAND_CATEGORY_ORDER,
  UNIT_CONFIGS,
  UNIT_TYPE_IDS,
  allocateCopiedFormationIdentity,
  allocateNewFormationIdentity,
  applyCardFormationDrafts,
  captureCardFormationsAsDefault,
  cloneFormationDraft,
  createCardFormation,
  dumpCardFormationDrafts,
  dumpDefaultCardFormationDrafts,
  getPreviewCardsForFormation,
  groupFormationsByMatch,
  isBuildingConfig,
  isBuildingOnlyFormation,
  isFuseBombFormation,
  resolveCardFormation,
  type CardFormation,
  type CardFormationDrafts,
  type CardRank,
  type FormationDraft,
  type FormationMatchGroup,
  type FormationMatchRule,
  type HandCategory,
  type UnitTypeId,
} from '@pb/sim';
import { IS_DEV_SERVER } from '../env.js';
import {
  appendFormationBombDamage,
  fuseBombDisplayDamage,
  withBombDamageAriaLabel,
} from './formationBombDamage.js';
import { appendFormationTag, applyFormationNameFallback } from './formationTag.js';
import { createFormationPreview, type FormationPreviewHandle } from '../view/formationPreview.js';
import { getFormationThumbnail } from '../view/formationThumbnail.js';

/** 普通阵型默认落子（非建筑） */
const DEFAULT_MOBILE_TYPE_ID =
  UNIT_TYPE_IDS.find((id) => !isBuildingConfig(UNIT_CONFIGS[id])) ?? UNIT_TYPE_IDS[0]!;

type PreviewMode = '3d' | 'button';

export interface DeckConfigPageOptions {
  onBack: () => void;
  /** 开发服：打开牌型概率/强度验证页。 */
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
  const situationList = required<HTMLElement>('#deck-situation-list', root);
  const formationList = required<HTMLElement>('#deck-formation-list', root);
  const editor = required<HTMLElement>('#deck-editor', root);
  const previewRoot = required<HTMLElement>('#deck-preview', root);
  const buttonPreviewRoot = required<HTMLElement>('#deck-preview-button', root);
  const tab3d = required<HTMLButtonElement>('#deck-preview-tab-3d', root);
  const tabButton = required<HTMLButtonElement>('#deck-preview-tab-button', root);
  const backButton = required<HTMLButtonElement>('#btn-deck-back', root);
  const addFormationButton = required<HTMLButtonElement>('#btn-deck-add-formation', root);
  const copyFormationButton = required<HTMLButtonElement>('#btn-deck-copy-formation', root);
  const handOddsButton = required<HTMLButtonElement>('#btn-deck-hand-odds', root);
  const saveButton = required<HTMLButtonElement>('#btn-deck-save', root);
  const resetButton = required<HTMLButtonElement>('#btn-deck-reset', root);

  let drafts = dumpCardFormationDrafts();
  let category: HandCategory = HAND_CATEGORY_ORDER[0]!;
  let situationKey = '';
  let formationIndex = 0;
  let preview: FormationPreviewHandle | null = null;
  let previewMode: PreviewMode = '3d';
  /** 丢弃切换阵型后仍返回的旧缩略图，避免按钮预览闪回。 */
  let buttonThumbGeneration = 0;
  let saveSeq = 0;

  const back = (): void => options.onBack();
  backButton.addEventListener('click', back);
  // 新增/复制/编辑/重置/保存/验证工具仅开发服开放；正式服只保留浏览与预览
  if (IS_DEV_SERVER) {
    addFormationButton.addEventListener('click', addFormation);
    copyFormationButton.addEventListener('click', copyFormation);
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

  /** 当前牌型按 match 收成的情况组。 */
  function situationGroups(): FormationMatchGroup[] {
    return groupFormationsByMatch(drafts[category]);
  }

  /**
   * 校正情况/阵型选中：编辑 match 后跟到新组，删除后留在原组或回第一组。
   */
  function ensureSelection(): void {
    const groups = situationGroups();
    if (groups.length === 0) {
      situationKey = '';
      formationIndex = 0;
      return;
    }

    const currentGroup = groups.find((group) => group.key === situationKey);
    if (currentGroup?.indices.includes(formationIndex)) return;

    const owner = groups.find((group) => group.indices.includes(formationIndex));
    if (owner) {
      situationKey = owner.key;
      return;
    }

    if (currentGroup) {
      formationIndex = currentGroup.indices[0]!;
      return;
    }

    situationKey = groups[0]!.key;
    formationIndex = groups[0]!.indices[0]!;
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

    const previewCards = getPreviewCardsForFormation(category, draft);
    const damage = fuseBombDisplayDamage(formation, previewCards);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'formation-option';
    button.setAttribute(
      'aria-label',
      withBombDamageAriaLabel(`${formation.name}：${formatFormationUnits(formation)}`, damage),
    );
    const image = document.createElement('img');
    image.className = 'formation-thumb';
    image.alt = '';
    button.appendChild(image);
    appendFormationTag(button, formation);
    appendFormationBombDamage(button, formation, previewCards);
    buttonPreviewRoot.appendChild(button);

    const url = await getFormationThumbnail(formation);
    if (generation !== buttonThumbGeneration) return;
    if (url) {
      image.src = url;
      return;
    }
    // 无 WebGL 时退回文字，与手牌阵型按钮一致。
    applyFormationNameFallback(button, formation.name);
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
          situationKey = '';
          formationIndex = 0;
          renderAll();
        });
        return button;
      }),
    );
  }

  function renderSituationList(): void {
    situationList.replaceChildren(
      ...situationGroups().map((group) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'deck-situation';
        button.classList.toggle('is-active', group.key === situationKey);
        button.textContent = group.label;
        button.addEventListener('click', () => {
          situationKey = group.key;
          formationIndex = group.indices[0] ?? 0;
          renderSituationList();
          renderFormationList();
          if (IS_DEV_SERVER) renderEditor();
          refreshPreview();
        });
        return button;
      }),
    );
  }

  function renderFormationList(): void {
    const group = situationGroups().find((item) => item.key === situationKey);
    const indices = group?.indices ?? [];
    formationList.replaceChildren(
      ...indices.map((index) => {
        const formation = drafts[category][index]!;
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
   * 编辑方案元数据：名称、牌面匹配、站位 rows、间距与缩略图放大。
   * 全部牌型的兵种搭配都以本页配置为准。
   */
  function renderEditor(): void {
    editor.replaceChildren();
    const draft = selected();
    if (!draft) {
      editor.textContent = '该情况下暂无可选方案。';
      return;
    }

    const buildingOnly = isBuildingOnlyFormation(draft);
    const rule = document.createElement('section');
    rule.className = 'deck-rows';
    rule.innerHTML = `
      <div class="deck-section-title">规则说明</div>
      <p>${HAND_CATEGORY_NAMES[category]}的兵种站位与牌面匹配均以本页配置为准。</p>
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
    editor.appendChild(renderRowsEditor(draft));
    if (isFuseBombFormation(draft)) {
      editor.appendChild(renderBombDamageEditor(draft));
    }

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

  /** 牌面匹配编辑：数字牌 / 指定点数 / 点数张数 / 大小王 / 任意。 */
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
      { value: 'tripleRanks', label: '三条点数' },
      { value: 'rankCount', label: '指定点数张数' },
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
      else if (kind === 'tripleRanks') {
        draft.match = { kind: 'tripleRanks', ranks: ['2', '3', '4', '5', '6', '7', '8', '9', '10'] };
      } else if (kind === 'rankCount') {
        draft.match = { kind: 'rankCount', ranks: ['J', 'Q', 'K', 'A'], min: 2 };
      } else draft.match = { kind: 'ranks', ranks: ['5'] };
      renderAll();
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
        refreshNavAfterMatchChange();
      });
      jokerRow.appendChild(jokerSelect);
      section.appendChild(jokerRow);
    }

    if (draft.match.kind === 'ranks' || draft.match.kind === 'tripleRanks' || draft.match.kind === 'rankCount') {
      const matchKind = draft.match.kind;
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
          const current = draft.match as {
            kind: 'ranks' | 'tripleRanks' | 'rankCount';
            ranks: CardRank[];
            min?: number;
            max?: number;
          };
          const next = new Set(current.ranks);
          if (input.checked) next.add(rank);
          else next.delete(rank);
          // 保持 FORMATION_MATCH_RANKS 顺序，便于预览样例稳定。
          const ranks = FORMATION_MATCH_RANKS.filter((item) => next.has(item));
          draft.match =
            matchKind === 'rankCount'
              ? {
                  kind: 'rankCount',
                  ranks,
                  ...(current.min === undefined ? {} : { min: current.min }),
                  ...(current.max === undefined ? {} : { max: current.max }),
                }
              : { kind: matchKind, ranks };
          refreshNavAfterMatchChange();
        });
        label.append(input, document.createTextNode(rank));
        ranksBox.appendChild(label);
      }
      section.appendChild(ranksBox);
    }

    if (draft.match.kind === 'rankCount') {
      section.appendChild(
        rankCountBoundField('至少张数', draft.match.min, (value) => {
          if (draft.match.kind !== 'rankCount') return;
          draft.match = {
            kind: 'rankCount',
            ranks: [...draft.match.ranks],
            ...(value === undefined ? {} : { min: value }),
            ...(draft.match.max === undefined ? {} : { max: draft.match.max }),
          };
          refreshNavAfterMatchChange();
        }),
      );
      section.appendChild(
        rankCountBoundField('至多张数', draft.match.max, (value) => {
          if (draft.match.kind !== 'rankCount') return;
          draft.match = {
            kind: 'rankCount',
            ranks: [...draft.match.ranks],
            ...(draft.match.min === undefined ? {} : { min: draft.match.min }),
            ...(value === undefined ? {} : { max: value }),
          };
          refreshNavAfterMatchChange();
        }),
      );
    }

    return section;
  }

  /** 引信炸弹伤害：三条/四条按 2～10 / J / Q / K / A 五档，火箭用固定伤害。 */
  function renderBombDamageEditor(draft: FormationDraft): HTMLElement {
    const section = document.createElement('section');
    section.className = 'deck-rows';
    const title = document.createElement('div');
    title.className = 'deck-section-title';
    title.textContent = category === 'rocket' ? '炸弹伤害' : '点数伤害';
    section.appendChild(title);

    if (category === 'rocket') {
      section.appendChild(
        optionalDamageInput('炸弹伤害', draft.damage, (value) => {
          if (value === undefined) delete draft.damage;
          else draft.damage = value;
        }),
      );
      return section;
    }

    for (const rank of FUSE_BOMB_DAMAGE_RANKS) {
      const label = FUSE_BOMB_DAMAGE_RANK_LABELS[rank];
      section.appendChild(
        optionalDamageInput(`${label} 伤害`, draft.rankDamage?.[rank], (value) => {
          if (value === undefined) {
            if (!draft.rankDamage) return;
            delete draft.rankDamage[rank];
            if (Object.keys(draft.rankDamage).length === 0) delete draft.rankDamage;
            return;
          }
          draft.rankDamage = { ...draft.rankDamage, [rank]: value };
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

  /** 收集全部牌型的阵型 id，新增/复制时按全局唯一分配。 */
  function allFormationIds(): Set<string> {
    return new Set(
      HAND_CATEGORY_ORDER.flatMap((handCategory) => drafts[handCategory].map((entry) => entry.id)),
    );
  }

  /** 追加一条空白阵型；id 避开已占用的 custom 编号，避免保存时报重复。 */
  function addFormation(): void {
    const identity = allocateNewFormationIdentity(category, allFormationIds());
    const group = situationGroups().find((item) => item.key === situationKey);
    drafts[category].push({
      id: identity.id,
      name: `${HAND_CATEGORY_NAMES[category]}阵型 ${identity.number}`,
      match: copyMatchRule(group?.match ?? { kind: 'any' }),
      rows: [[DEFAULT_MOBILE_TYPE_ID]],
      colSpacing: 1.2,
      rowSpacing: 1.4,
      thumbScale: FORMATION_THUMB_SCALE,
    });
    formationIndex = drafts[category].length - 1;
    renderAll();
  }

  /** 深拷贝当前阵型并插入到其后，用于快速改 match 或微调站位。 */
  function copyFormation(): void {
    const source = selected();
    if (!source) return;
    const existingIds = allFormationIds();
    const copy = cloneFormationDraft(source);
    const identity = allocateCopiedFormationIdentity(
      source,
      existingIds,
      drafts[category].map((entry) => entry.name),
    );
    copy.id = identity.id;
    copy.name = identity.name;
    drafts[category].splice(formationIndex + 1, 0, copy);
    formationIndex += 1;
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
    situationKey = '';
    formationIndex = 0;
    setStatus('已恢复为最近一次配置文件快照', false);
    renderAll();
  }

  /** 先把未保存草稿应用到运行时，再进验证页，避免对拆用到过期阵型。 */
  function openHandOdds(): void {
    try {
      applyCardFormationDrafts(drafts);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
      return;
    }
    options.onOpenHandOdds?.();
  }

  /** 改 match 后情况组可能变化，只刷新导航与预览，避免拆掉正在编辑的表单。 */
  function refreshNavAfterMatchChange(): void {
    ensureSelection();
    renderSituationList();
    renderFormationList();
    refreshPreview();
  }

  function renderAll(): void {
    ensureSelection();
    renderCategories();
    renderSituationList();
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

/** 炸弹伤害可留空，空值表示回落单位配置。 */
function optionalDamageInput(
  label: string,
  value: number | undefined,
  onChange: (value: number | undefined) => void,
): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'deck-field';
  row.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = '10';
  input.placeholder = '单位默认';
  input.value = value === undefined ? '' : String(value);
  input.addEventListener('input', () => {
    if (input.value.trim() === '') {
      onChange(undefined);
      return;
    }
    const next = Number(input.value);
    if (Number.isFinite(next) && next >= 0) onChange(next);
  });
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

/** 新增阵型时拷贝当前情况的 match，避免和分组对象共享引用。 */
function copyMatchRule(match: FormationMatchRule): FormationMatchRule {
  if (match.kind === 'ranks') return { kind: 'ranks', ranks: [...match.ranks] };
  if (match.kind === 'tripleRanks') return { kind: 'tripleRanks', ranks: [...match.ranks] };
  if (match.kind === 'rankCount') {
    return {
      kind: 'rankCount',
      ranks: [...match.ranks],
      ...(match.min === undefined ? {} : { min: match.min }),
      ...(match.max === undefined ? {} : { max: match.max }),
    };
  }
  if (match.kind === 'joker') return { kind: 'joker', joker: match.joker };
  return { kind: match.kind };
}

/** 点数张数的下限/上限输入；留空表示不限。 */
function rankCountBoundField(
  label: string,
  value: number | undefined,
  onChange: (value: number | undefined) => void,
): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'deck-field';
  row.append(document.createTextNode(label));
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = '1';
  input.placeholder = '不限';
  input.value = value === undefined ? '' : String(value);
  input.addEventListener('input', () => {
    const raw = input.value.trim();
    if (raw === '') {
      onChange(undefined);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) return;
    onChange(parsed);
  });
  row.appendChild(input);
  return row;
}


function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`卡组配置页缺少元素：${selector}`);
  return element;
}
