// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCodexPage } from '../src/ui/codexPage.js';

describe('兵种图鉴页', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main id="codex" class="is-hidden">
        <button id="btn-codex-back"></button>
        <nav id="codex-category-list"></nav>
        <div id="codex-unit-list"></div>
        <article id="codex-detail"></article>
      </main>
    `;
  });

  it('展示可移动单位与特殊建筑，并按分类切换档案', () => {
    const page = createCodexPage({ onBack: vi.fn() });
    page.show();

    expect(document.querySelectorAll('.codex-unit-card')).toHaveLength(14);
    expect(document.querySelector('#codex-detail')?.textContent).toContain('民兵');
    expect(document.querySelectorAll('.codex-stat-bar')).toHaveLength(5);
    expect(document.querySelector('.codex-stat-bar span')?.getAttribute('style')).toMatch(/^width: 16\.5289/);
    expect(document.querySelector('#codex-detail')?.textContent).not.toContain('400');

    /** 页签每次渲染会重建，点击前需重新查询。 */
    const categoryNamed = (name: string): HTMLButtonElement | undefined =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('.codex-category')).find(
        (button) => button.textContent === name,
      );

    expect(
      Array.from(document.querySelectorAll('.codex-category')).map((button) => button.textContent),
    ).toEqual(['全部兵种', '单兵种', '特殊兵种', '召唤物']);
    expect(categoryNamed('全部兵种')?.classList.contains('is-active')).toBe(true);

    categoryNamed('单兵种')?.click();
    expect(document.querySelectorAll('.codex-unit-card')).toHaveLength(8);
    expect(
      Array.from(document.querySelectorAll('.codex-unit-name')).map((node) => node.textContent),
    ).toEqual(['民兵', '弓手', '卫士', '女王', '国王', '皇家骑士', '法师', '大法师']);
    expect(document.querySelector('#codex-detail')?.textContent).toContain('民兵');

    categoryNamed('特殊兵种')?.click();
    expect(document.querySelectorAll('.codex-unit-card')).toHaveLength(4);
    expect(
      Array.from(document.querySelectorAll('.codex-unit-name')).map((node) => node.textContent),
    ).toEqual(['战车', '巨型炸弹', '巨龙', '防御塔']);
    expect(document.querySelector('#codex-detail')?.textContent).toContain('战车');

    categoryNamed('召唤物')?.click();
    expect(document.querySelectorAll('.codex-unit-card')).toHaveLength(2);

    categoryNamed('单兵种')?.click();
    const mage = Array.from(document.querySelectorAll<HTMLButtonElement>('.codex-unit-card')).find(
      (button) => button.textContent?.includes('法师') && !button.textContent?.includes('大法师'),
    );
    mage?.click();
    expect(document.querySelector('#codex-detail')?.textContent).toContain('召唤');
  });

  it('民兵与弓手可切换等级，属性条随等级变化', () => {
    const page = createCodexPage({ onBack: vi.fn() });
    page.show();

    const levelButtons = (): HTMLButtonElement[] =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('.codex-level'));
    const hpFillWidth = (): string =>
      document.querySelector('.codex-stat-bar span')?.getAttribute('style') ?? '';

    expect(levelButtons().map((button) => button.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
    ]);
    expect(levelButtons()[0]?.classList.contains('is-active')).toBe(true);
    const levelOneHp = hpFillWidth();

    levelButtons()[8]?.click();
    expect(levelButtons()[8]?.classList.contains('is-active')).toBe(true);
    expect(hpFillWidth()).not.toBe(levelOneHp);

    const archer = Array.from(document.querySelectorAll<HTMLButtonElement>('.codex-unit-card')).find(
      (button) => button.textContent?.includes('弓手'),
    );
    archer?.click();
    expect(levelButtons()[0]?.classList.contains('is-active')).toBe(true);
    expect(levelButtons()).toHaveLength(12);

    page.dispose();
  });

  it('返回按钮会通知页面控制器并正确隐藏页面', () => {
    const onBack = vi.fn();
    const page = createCodexPage({ onBack });
    page.show();

    document.querySelector<HTMLButtonElement>('#btn-codex-back')?.click();
    expect(onBack).toHaveBeenCalledOnce();

    page.hide();
    expect(document.querySelector('#codex')?.classList.contains('is-hidden')).toBe(true);
    page.dispose();
  });
});
