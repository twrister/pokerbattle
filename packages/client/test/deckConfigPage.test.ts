// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const preview = { render: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
vi.mock('../src/view/formationPreview.js', () => ({
  createFormationPreview: vi.fn(() => preview),
}));
vi.mock('../src/view/formationThumbnail.js', () => ({
  getFormationThumbnail: vi.fn(async () => 'data:image/png;base64,preview'),
}));

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
        <button id="btn-deck-back"></button>
        <button id="btn-deck-hand-odds"></button>
        <button id="btn-deck-add-formation"></button>
        <button id="btn-deck-copy-formation"></button>
        <button id="btn-deck-save"></button>
        <button id="btn-deck-reset"></button>
        <div id="deck-category-list"></div>
        <div id="deck-formation-list"></div>
        <div id="deck-editor"></div>
        <div id="deck-status"></div>
        <button id="deck-preview-tab-3d" class="is-active" aria-selected="true"></button>
        <button id="deck-preview-tab-button" aria-selected="false"></button>
        <div id="deck-preview"></div>
        <div id="deck-preview-button" class="is-hidden"></div>
      </main>
    `;
  });

  it('进入后显示牌型、创建阵型并在返回时通知页面控制器', () => {
    const onBack = vi.fn();
    const page = createDeckConfigPage({ onBack });

    page.show();
    const categoryNames = [...document.querySelectorAll('.deck-category')].map((el) => el.textContent);
    expect(categoryNames).toHaveLength(12);
    expect(categoryNames.indexOf('四顺')).toBeGreaterThan(-1);
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

  it('单张阵型可编辑站位兵种并刷新预览', () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();
    preview.render.mockClear();

    // 默认牌型即为单张；选中「单张 J」
    const formationButtons = [...document.querySelectorAll<HTMLButtonElement>('.deck-formation')];
    const jButton = formationButtons.find((button) => button.textContent === '单张 J');
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

    const pairCategory = [...document.querySelectorAll<HTMLButtonElement>('.deck-category')].find(
      (button) => button.textContent === '对子',
    );
    expect(pairCategory).toBeDefined();
    pairCategory!.click();
    preview.render.mockClear();

    const formationButtons = [...document.querySelectorAll<HTMLButtonElement>('.deck-formation')];
    const jButton = formationButtons.find((button) => button.textContent === '对子 J');
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

    const tripleCategory = [...document.querySelectorAll<HTMLButtonElement>('.deck-category')].find(
      (button) => button.textContent === '三张',
    );
    expect(tripleCategory).toBeDefined();
    tripleCategory!.click();
    preview.render.mockClear();

    const formationButtons = [...document.querySelectorAll<HTMLButtonElement>('.deck-formation')];
    const jButton = formationButtons.find((button) => button.textContent === '三条 J');
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

    const straight3Category = [...document.querySelectorAll<HTMLButtonElement>('.deck-category')].find(
      (button) => button.textContent === '三顺',
    );
    expect(straight3Category).toBeDefined();
    straight3Category!.click();

    const names = [...document.querySelectorAll<HTMLButtonElement>('.deck-formation')].map(
      (button) => button.textContent,
    );
    expect(names).toEqual(['数字三顺', 'A-2-3', '9-10-J', '10-J-Q', 'J-Q-K', 'Q-K-A']);

    const segmentButton = [...document.querySelectorAll<HTMLButtonElement>('.deck-formation')].find(
      (button) => button.textContent === 'J-Q-K',
    );
    expect(segmentButton).toBeDefined();
    segmentButton!.click();
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

    const twoPairCategory = [...document.querySelectorAll<HTMLButtonElement>('.deck-category')].find(
      (button) => button.textContent === '连对',
    );
    expect(twoPairCategory).toBeDefined();
    twoPairCategory!.click();

    const names = [...document.querySelectorAll<HTMLButtonElement>('.deck-formation')].map(
      (button) => button.textContent,
    );
    expect(names).toEqual(['数字连对', 'A-2', '10-J', 'J-Q', 'Q-K', 'K-A']);

    const segmentButton = [...document.querySelectorAll<HTMLButtonElement>('.deck-formation')].find(
      (button) => button.textContent === 'Q-K',
    );
    expect(segmentButton).toBeDefined();
    segmentButton!.click();
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

    const straight4Category = [...document.querySelectorAll<HTMLButtonElement>('.deck-category')].find(
      (button) => button.textContent === '四顺',
    );
    expect(straight4Category).toBeDefined();
    straight4Category!.click();

    const names = [...document.querySelectorAll<HTMLButtonElement>('.deck-formation')].map(
      (button) => button.textContent,
    );
    expect(names).toEqual(['数字四顺', 'A-2-3-4', '8-9-10-J', '9-10-J-Q', '10-J-Q-K', 'J-Q-K-A']);

    const segmentButton = [...document.querySelectorAll<HTMLButtonElement>('.deck-formation')].find(
      (button) => button.textContent === 'J-Q-K-A',
    );
    expect(segmentButton).toBeDefined();
    segmentButton!.click();
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

    const straight5Category = [...document.querySelectorAll<HTMLButtonElement>('.deck-category')].find(
      (button) => button.textContent === '五顺',
    );
    expect(straight5Category).toBeDefined();
    straight5Category!.click();

    const names = [...document.querySelectorAll<HTMLButtonElement>('.deck-formation')].map(
      (button) => button.textContent,
    );
    expect(names).toEqual(['数字五顺', 'A-2-3-4-5', '9-10-J-Q-K', '10-J-Q-K-A', '箭塔', '战车']);

    const segmentButton = [...document.querySelectorAll<HTMLButtonElement>('.deck-formation')].find(
      (button) => button.textContent === '10-J-Q-K-A',
    );
    expect(segmentButton).toBeDefined();
    segmentButton!.click();
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

  it('小炸弹阵型可编辑点数伤害', () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();

    const tripleCategory = [...document.querySelectorAll<HTMLButtonElement>('.deck-category')].find(
      (button) => button.textContent === '三张',
    );
    expect(tripleCategory).toBeDefined();
    tripleCategory!.click();

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
    expect(numberRow!.querySelector('input')!.value).toBe('600');

    const aRow = [...document.querySelectorAll('.deck-field')].find((el) =>
      el.textContent?.startsWith('A 伤害'),
    );
    expect(aRow).toBeDefined();
    const input = aRow!.querySelector('input')!;
    expect(input.value).toBe('1000');
    input.value = '1230';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.value).toBe('1230');

    page.dispose();
  });

  it('火箭阵型可编辑固定炸弹伤害', () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();

    const rocketCategory = [...document.querySelectorAll<HTMLButtonElement>('.deck-category')].find(
      (button) => button.textContent === '王炸',
    );
    expect(rocketCategory).toBeDefined();
    rocketCategory!.click();

    const titles = [...document.querySelectorAll('.deck-section-title')].map((el) => el.textContent);
    expect(titles).toContain('炸弹伤害');

    const row = [...document.querySelectorAll('.deck-field')].find((el) =>
      el.textContent?.startsWith('炸弹伤害'),
    );
    expect(row).toBeDefined();
    const input = row!.querySelector('input')!;
    expect(input.value).toBe('1500');
    input.value = '1600';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.value).toBe('1600');

    page.dispose();
  });

  it('可复制当前阵型并连续复制时递增 id', () => {
    const page = createDeckConfigPage({ onBack: vi.fn() });
    page.show();

    const formationButtons = [...document.querySelectorAll<HTMLButtonElement>('.deck-formation')];
    const jButton = formationButtons.find((button) => button.textContent === '单张 J');
    expect(jButton).toBeDefined();
    jButton!.click();

    const initialCount = document.querySelectorAll('.deck-formation').length;
    const sourceUnit = document.querySelector<HTMLSelectElement>('#deck-editor .deck-row select')?.value;
    const sourceKind = [...document.querySelectorAll<HTMLSelectElement>('#deck-editor select')].find(
      (select) => [...select.options].some((option) => option.value === 'ranks'),
    )?.value;
    expect(sourceUnit).toBe('melee_guard');
    expect(sourceKind).toBe('ranks');

    document.querySelector<HTMLButtonElement>('#btn-deck-copy-formation')!.click();
    expect(document.querySelectorAll('.deck-formation')).toHaveLength(initialCount + 1);
    expect(document.querySelector('.deck-formation.is-active')?.textContent).toBe('单张 J 副本');
    expect(editorFieldValue('阵型 ID')).toBe('single_J_copy');
    expect(document.querySelector<HTMLSelectElement>('#deck-editor .deck-row select')?.value).toBe(sourceUnit);
    expect(
      [...document.querySelectorAll<HTMLSelectElement>('#deck-editor select')].find((select) =>
        [...select.options].some((option) => option.value === 'ranks'),
      )?.value,
    ).toBe('ranks');

    document.querySelector<HTMLButtonElement>('#btn-deck-copy-formation')!.click();
    expect(document.querySelectorAll('.deck-formation')).toHaveLength(initialCount + 2);
    expect(document.querySelector('.deck-formation.is-active')?.textContent).toBe('单张 J 副本2');
    expect(editorFieldValue('阵型 ID')).toBe('single_J_copy2');

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
