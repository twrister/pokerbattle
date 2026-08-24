// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const preview = { render: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
vi.mock('../src/view/formationPreview.js', () => ({
  createFormationPreview: vi.fn(() => preview),
}));
vi.mock('../src/view/formationThumbnail.js', () => ({
  getFormationThumbnail: vi.fn(async () => 'data:image/png;base64,preview'),
}));

import {
  CARD_FORMATIONS,
  HAND_CATEGORY_ORDER,
  applySpecialTierDrafts,
  dumpSpecialTierDrafts,
  resetCardFormationsToDefault,
  resetSpecialTiersToDefault,
} from '@pb/sim';
import { createDeckConfigPage } from '../src/ui/deckConfigPage.js';
import { getFormationThumbnail } from '../src/view/formationThumbnail.js';

describe('卡组阵型配置页', () => {
  beforeEach(() => {
    preview.render.mockClear();
    preview.resize.mockClear();
    preview.dispose.mockClear();
    vi.mocked(getFormationThumbnail).mockClear();
    document.body.innerHTML = `
      <main id="deck-config" class="is-hidden">
        <div class="deck-shell">
          <button id="btn-deck-back"></button>
          <button id="btn-deck-hand-odds"></button>
          <button id="btn-deck-add-formation"></button>
          <button id="btn-deck-tier-table"></button>
          <button id="btn-deck-save"></button>
          <button id="btn-deck-reset"></button>
          <div id="deck-category-list"></div>
          <div id="deck-situation-list"></div>
          <div id="deck-formation-list"></div>
          <div id="deck-editor"></div>
          <div id="deck-status"></div>
          <button id="deck-preview-tab-3d" class="is-active" aria-selected="true"></button>
          <button id="deck-preview-tab-button" aria-selected="false"></button>
          <div id="deck-preview"></div>
          <div id="deck-preview-button" class="is-hidden"></div>
        </div>
      </main>
    `;
  });

  afterEach(() => {
    resetSpecialTiersToDefault();
    resetCardFormationsToDefault();
  });

  it('进入后显示牌型、创建阵型并在返回时通知页面控制器', () => {
    const onBack = vi.fn();
    const page = createDeckConfigPage({ onBack });

    page.show();
    const categoryNames = [...document.querySelectorAll('.deck-category')].map((el) => el.textContent);
    expect(categoryNames).toHaveLength(12);
    expect(categoryNames.indexOf('连对')).toBeGreaterThan(-1);
    expect(categoryNames.indexOf('四顺')).toBeLessThan(categoryNames.indexOf('连对'));
    expect(preview.resize).toHaveBeenCalledOnce();
    expect(preview.render).toHaveBeenCalled();

    const initialCount = document.querySelectorAll('.deck-formation').length;
    document.querySelector<HTMLButtonElement>('#btn-deck-add-formation')!.click();
    expect(document.querySelectorAll('.deck-formation')).toHaveLength(initialCount + 1);

    document.querySelector<HTMLButtonElement>('#btn-deck-back')!.click();
    expect(onBack).toHaveBeenCalledOnce();
    page.dispose();
    expect(preview.dispose).toHaveBeenCalledOnce();
  });

  it('连对新增阵型 id 避开已占用的 custom 编号', () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();
    clickCategory('连对');
    document.querySelector<HTMLButtonElement>('#btn-deck-add-formation')!.click();
    const newId = editorFieldValue('阵型 ID');
    const existingIds = new Set(
      HAND_CATEGORY_ORDER.flatMap((category) => CARD_FORMATIONS[category].map((entry) => entry.id)),
    );
    expect(newId).toMatch(/^two_pair_custom_\d+$/);
    expect(existingIds.has(newId!)).toBe(false);
    page.dispose();
  });

  it('牌型验证入口会通知页面控制器', () => {
    const onOpenHandOdds = vi.fn();
    const page = createDeckConfigPage({ onBack: vi.fn(), onOpenHandOdds });
    page.show();
    document.querySelector<HTMLButtonElement>('#btn-deck-hand-odds')!.click();
    expect(onOpenHandOdds).toHaveBeenCalledOnce();
    page.dispose();
  });

  it('档位表配置入口会通知页面控制器', () => {
    const onOpenSpecialTiers = vi.fn();
    const page = createDeckConfigPage({ onBack: vi.fn(), onOpenSpecialTiers });
    page.show();
    document.querySelector<HTMLButtonElement>('#btn-deck-tier-table')!.click();
    expect(onOpenSpecialTiers).toHaveBeenCalledOnce();
    page.dispose();
  });

  it('单张默认情况为数字牌，阵型只列出该组方案', () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();

    expect(situationNames()).toEqual(['数字牌 2～10', 'J', 'Q', 'K', 'A', '小王', '大王']);
    expect(document.querySelector('.deck-situation.is-active')?.textContent).toBe('数字牌 2～10');
    expect(formationNames()).toEqual(['单民兵', '单弓手']);

    clickSituation('J');
    expect(formationNames()).toEqual(['单张 J']);

    page.dispose();
  });

  it('同花按 J～A 张数分成两档', () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();

    clickCategory('同花');
    expect(situationNames()).toEqual(['任意']);
    expect(formationNames()).toEqual(['双射手箭塔', '飞龙', '小石头人']);

    page.dispose();
  });

  it('同花顺只有任意情况，其下列出全部阵型', () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();

    clickCategory('同花顺');
    expect(situationNames()).toEqual(['任意']);
    expect(formationNames()).toEqual(['双石头人', '双喷火龙']);

    page.dispose();
  });

  it('可切换到按钮显示并复用阵型缩略图', async () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();

    document.querySelector<HTMLButtonElement>('#deck-preview-tab-button')!.click();
    expect(document.querySelector('#deck-preview')?.classList.contains('is-hidden')).toBe(true);
    expect(document.querySelector('#deck-preview-button')?.classList.contains('is-hidden')).toBe(false);
    expect(getFormationThumbnail).toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(document.querySelector('#deck-preview-button .formation-option img.formation-thumb')).not.toBeNull();
    });

    page.dispose();
  });

  it('按钮预览在单兵种阵型右下角显示标签', async () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();
    document.querySelector<HTMLButtonElement>('#deck-preview-tab-button')!.click();
    await vi.waitFor(() => {
      expect(
        document.querySelector('#deck-preview-button .formation-option .formation-tag')?.textContent,
      ).toBe('近战');
    });
    page.dispose();
  });

  it('单张阵型可编辑站位兵种并刷新预览', () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();
    preview.render.mockClear();

    clickSituation('J');
    const jButton = [...document.querySelectorAll<HTMLButtonElement>('.deck-formation')].find(
      (button) => button.textContent === '单张 J',
    );
    expect(jButton).toBeDefined();
    jButton!.click();

    const titles = [...document.querySelectorAll('.deck-section-title')].map((el) => el.textContent);
    expect(titles).toContain('站位配置');
    expect(titles).toContain('牌面匹配');
    expect(titles).not.toContain('等级规则');

    const select = document.querySelector<HTMLSelectElement>('#deck-editor .deck-row select');
    expect(select).not.toBeNull();

    const nextType = [...select!.options].find((option) => option.value !== select!.value)?.value;
    expect(nextType).toBeTruthy();
    select!.value = nextType!;
    select!.dispatchEvent(new Event('change', { bubbles: true }));

    expect(preview.render).toHaveBeenCalled();
    const rendered = preview.render.mock.calls.at(-1)?.[0] as { rows?: string[][] } | null;
    expect(rendered?.rows?.flat()).toContain(nextType);

    page.dispose();
  });

  it('对子阵型可编辑站位兵种并刷新预览', () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();

    clickCategory('对子');
    clickSituation('J');
    preview.render.mockClear();

    const jButton = [...document.querySelectorAll<HTMLButtonElement>('.deck-formation')].find(
      (button) => button.textContent === '对子 J',
    );
    expect(jButton).toBeDefined();
    jButton!.click();

    const select = document.querySelector<HTMLSelectElement>('#deck-editor .deck-row select');
    expect(select).not.toBeNull();
    const titles = [...document.querySelectorAll('.deck-section-title')].map((el) => el.textContent);
    expect(titles).toContain('站位配置');

    const nextType = [...select!.options].find((option) => option.value !== select!.value)?.value;
    expect(nextType).toBeTruthy();
    select!.value = nextType!;
    select!.dispatchEvent(new Event('change', { bubbles: true }));

    expect(preview.render).toHaveBeenCalled();
    const rendered = preview.render.mock.calls.at(-1)?.[0] as { rows?: string[][] } | null;
    expect(rendered?.rows?.flat()).toContain(nextType);

    page.dispose();
  });

  it('三条阵型可编辑站位兵种并刷新预览', () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();

    clickCategory('三张');
    clickSituation('J');
    preview.render.mockClear();

    const jButton = [...document.querySelectorAll<HTMLButtonElement>('.deck-formation')].find(
      (button) => button.textContent === '三条 J',
    );
    expect(jButton).toBeDefined();
    jButton!.click();

    const select = document.querySelector<HTMLSelectElement>('#deck-editor .deck-row select');
    expect(select).not.toBeNull();
    const titles = [...document.querySelectorAll('.deck-section-title')].map((el) => el.textContent);
    expect(titles).toContain('站位配置');

    const nextType = [...select!.options].find((option) => option.value !== select!.value)?.value;
    expect(nextType).toBeTruthy();
    select!.value = nextType!;
    select!.dispatchEvent(new Event('change', { bubbles: true }));

    expect(preview.render).toHaveBeenCalled();
    const rendered = preview.render.mock.calls.at(-1)?.[0] as { rows?: string[][] } | null;
    expect(rendered?.rows?.flat()).toContain(nextType);

    page.dispose();
  });

  it('三顺各点数段均可编辑站位并按段预览', () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();

    clickCategory('三顺');
    expect(situationNames()).toEqual(['数字牌 2～10', 'A-2-3', '9-10-J', '10-J-Q', 'J-Q-K', 'Q-K-A']);

    clickSituation('J-Q-K');
    expect(formationNames()).toEqual(['J-Q-K', '2档：连弩车 / 冲锋战车']);
    preview.render.mockClear();

    const titles = [...document.querySelectorAll('.deck-section-title')].map((el) => el.textContent);
    expect(titles).toContain('站位配置');

    const select = document.querySelector<HTMLSelectElement>('#deck-editor .deck-row select');
    expect(select).not.toBeNull();
    const nextType = [...select!.options].find((option) => option.value !== select!.value)?.value;
    expect(nextType).toBeTruthy();
    select!.value = nextType!;
    select!.dispatchEvent(new Event('change', { bubbles: true }));

    expect(preview.render).toHaveBeenCalled();
    const rendered = preview.render.mock.calls.at(-1)?.[0] as { rows?: string[][]; id?: string } | null;
    expect(rendered?.id).toBe('straight3_JQK');
    expect(rendered?.rows?.flat()).toContain(nextType);

    page.dispose();
  });

  it('连对各点数段均可编辑站位并按段预览', () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();

    clickCategory('连对');
    expect(situationNames()).toEqual(['数字牌 2～10', 'A-2', '10-J', 'J-Q', 'Q-K', 'K-A']);

    clickSituation('Q-K');
    expect(formationNames()[0]).toBe('Q-K');
    preview.render.mockClear();

    const titles = [...document.querySelectorAll('.deck-section-title')].map((el) => el.textContent);
    expect(titles).toContain('站位配置');

    const select = document.querySelector<HTMLSelectElement>('#deck-editor .deck-row select');
    expect(select).not.toBeNull();
    const nextType = [...select!.options].find((option) => option.value !== select!.value)?.value;
    expect(nextType).toBeTruthy();
    select!.value = nextType!;
    select!.dispatchEvent(new Event('change', { bubbles: true }));

    expect(preview.render).toHaveBeenCalled();
    const rendered = preview.render.mock.calls.at(-1)?.[0] as { rows?: string[][]; id?: string } | null;
    expect(rendered?.id).toBe('two_pair_QK');
    expect(rendered?.rows?.flat()).toContain(nextType);

    page.dispose();
  });

  it('四顺各点数段均可编辑站位并按段预览', () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();

    clickCategory('四顺');
    expect(situationNames()).toEqual(['数字牌 2～10', 'A-2-3-4', '8-9-10-J', '9-10-J-Q', '10-J-Q-K', 'J-Q-K-A']);

    clickSituation('J-Q-K-A');
    expect(formationNames()).toEqual(['J-Q-K-A', '3档：箭塔 / 小石头人']);
    preview.render.mockClear();

    const titles = [...document.querySelectorAll('.deck-section-title')].map((el) => el.textContent);
    expect(titles).toContain('站位配置');

    const select = document.querySelector<HTMLSelectElement>('#deck-editor .deck-row select');
    expect(select).not.toBeNull();
    const nextType = [...select!.options].find((option) => option.value !== select!.value)?.value;
    expect(nextType).toBeTruthy();
    select!.value = nextType!;
    select!.dispatchEvent(new Event('change', { bubbles: true }));

    expect(preview.render).toHaveBeenCalled();
    const rendered = preview.render.mock.calls.at(-1)?.[0] as { rows?: string[][]; id?: string } | null;
    expect(rendered?.id).toBe('straight4_JQKA');
    expect(rendered?.rows?.flat()).toContain(nextType);

    page.dispose();
  });

  it('五顺各点数段均可编辑站位并按段预览', () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();

    clickCategory('五顺');
    expect(situationNames()).toEqual([
      '数字牌 2～10',
      'A-2-3-4-5',
      '7-8-9-10-J',
      '8-9-10-J-Q',
      '9-10-J-Q-K',
      '10-J-Q-K-A',
    ]);

    clickSituation('10-J-Q-K-A');
    expect(formationNames()[0]).toBe('10-J-Q-K-A');
    preview.render.mockClear();

    const titles = [...document.querySelectorAll('.deck-section-title')].map((el) => el.textContent);
    expect(titles).toContain('站位配置');

    const select = document.querySelector<HTMLSelectElement>('#deck-editor .deck-row select');
    expect(select).not.toBeNull();
    const nextType = [...select!.options].find((option) => option.value !== select!.value)?.value;
    expect(nextType).toBeTruthy();
    select!.value = nextType!;
    select!.dispatchEvent(new Event('change', { bubbles: true }));

    expect(preview.render).toHaveBeenCalled();
    const rendered = preview.render.mock.calls.at(-1)?.[0] as { rows?: string[][]; id?: string } | null;
    expect(rendered?.id).toBe('straight5_10JQKA');
    expect(rendered?.rows?.flat()).toContain(nextType);

    page.dispose();
  });

  it('炸弹阵型按钮预览显示爆炸伤害', async () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();

    clickCategory('三张');
    clickSituation('任意');
    const bombButton = [...document.querySelectorAll<HTMLButtonElement>('.deck-formation')].find(
      (button) => button.textContent === '小炸弹',
    );
    expect(bombButton).toBeDefined();
    bombButton!.click();

    document.querySelector<HTMLButtonElement>('#deck-preview-tab-button')!.click();
    await vi.waitFor(() => {
      expect(
        document.querySelector('#deck-preview-button .formation-option .formation-bomb-damage')?.textContent,
      ).toBe('500');
    });
    expect(
      document.querySelector('#deck-preview-button .formation-option')?.getAttribute('aria-label'),
    ).toContain('爆炸伤害 500');

    page.dispose();
  });

  it('小炸弹阵型可编辑点数伤害', () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();

    clickCategory('三张');
    clickSituation('任意');
    const bombButton = [...document.querySelectorAll<HTMLButtonElement>('.deck-formation')].find(
      (button) => button.textContent === '小炸弹',
    );
    expect(bombButton).toBeDefined();
    bombButton!.click();

    const titles = [...document.querySelectorAll('.deck-section-title')].map((el) => el.textContent);
    expect(titles).toContain('点数伤害');

    const numberRow = [...document.querySelectorAll('.deck-field')].find((el) =>
      el.textContent?.startsWith('2～10 伤害'),
    );
    expect(numberRow).toBeDefined();
    expect(numberRow!.querySelector('input')!.value).toBe('500');

    const aRow = [...document.querySelectorAll('.deck-field')].find((el) =>
      el.textContent?.startsWith('A 伤害'),
    );
    expect(aRow).toBeDefined();
    const input = aRow!.querySelector('input')!;
    expect(input.value).toBe('900');
    input.value = '1230';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.value).toBe('1230');

    page.dispose();
  });

  it('火箭阵型可编辑固定炸弹伤害', () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();

    clickCategory('王炸');
    expect(situationNames()).toEqual(['任意']);

    const titles = [...document.querySelectorAll('.deck-section-title')].map((el) => el.textContent);
    expect(titles).toContain('炸弹伤害');

    const row = [...document.querySelectorAll('.deck-field')].find((el) =>
      el.textContent?.startsWith('炸弹伤害'),
    );
    expect(row).toBeDefined();
    const input = row!.querySelector('input')!;
    expect(input.value).toBe('800');
    input.value = '1600';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.value).toBe('1600');

    page.dispose();
  });

  it('葫芦情况显示档位哨兵，按钮预览一次画出整档着色按钮', async () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();
    clickCategory('葫芦');

    expect(situationNames()).toEqual(['三条 2～10', '三条 J～A']);
    expect(formationNames()).toEqual(['4档：双射手箭塔 / 飞龙 / 投弹车']);
    expect(document.querySelector<HTMLSelectElement>('.deck-tier-field select')?.value).toBe('4');
    expect([...document.querySelectorAll('.deck-section-title')].map((el) => el.textContent)).toContain(
      '档位展开',
    );
    expect([...document.querySelectorAll('.deck-section-title')].map((el) => el.textContent)).not.toContain(
      '站位配置',
    );

    document.querySelector<HTMLButtonElement>('#deck-preview-tab-button')!.click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll('#deck-preview-button .formation-option.is-tier-4')).toHaveLength(3);
    });

    const select = document.querySelector<HTMLSelectElement>('.deck-tier-field select')!;
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(situationNames()).toEqual(['三条 J～A']);
    expect(formationNames()).toEqual(['5档：三射手箭塔 / 喷火龙 / 石头人']);

    page.dispose();
  });

  it('从档位表返回后重绘哨兵标签', () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();
    clickCategory('葫芦');
    expect(formationNames()[0]).toBe('4档：双射手箭塔 / 飞龙 / 投弹车');

    const drafts = dumpSpecialTierDrafts();
    const previous = drafts[4].units[0]!;
    drafts[4].units[0] = 'melee_grunt';
    drafts[4].formations.melee_grunt = drafts[4].formations[previous];
    delete drafts[4].formations[previous];
    applySpecialTierDrafts(drafts);
    page.show();
    expect(formationNames()[0]).toBe('4档：民兵 / 飞龙 / 投弹车');

    page.dispose();
  });
});

/** 读取编辑器里指定标签对应的文本框当前值。 */
function editorFieldValue(label: string): string | undefined {
  const row = [...document.querySelectorAll('#deck-editor .deck-field')].find((el) =>
    el.textContent?.startsWith(label),
  );
  return row?.querySelector('input')?.value;
}

/** 当前情况列文案，按渲染顺序。 */
function situationNames(): string[] {
  return [...document.querySelectorAll('.deck-situation')].map((el) => el.textContent ?? '');
}

/** 当前阵型列文案，按渲染顺序。 */
function formationNames(): string[] {
  return [...document.querySelectorAll('.deck-formation')].map((el) => el.textContent ?? '');
}

/** 点选牌型按钮。 */
function clickCategory(name: string): void {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.deck-category')].find(
    (item) => item.textContent === name,
  );
  expect(button, `缺少牌型按钮：${name}`).toBeDefined();
  button!.click();
}

/** 点选情况按钮。 */
function clickSituation(name: string): void {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.deck-situation')].find(
    (item) => item.textContent === name,
  );
  expect(button, `缺少情况按钮：${name}`).toBeDefined();
  button!.click();
}
