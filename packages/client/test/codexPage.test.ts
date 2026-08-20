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

    expect(document.querySelectorAll('.codex-unit-card')).toHaveLength(22);
    expect(document.querySelector('#codex-detail')?.textContent).toContain('民兵');
    expect(document.querySelectorAll('.codex-stat-bar')).toHaveLength(5);
    expect(document.querySelector('.codex-stat-bar span')?.getAttribute('style')).toMatch(/^width: 6.25%/);
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
    expect(document.querySelectorAll('.codex-unit-card')).toHaveLength(9);
    expect(
      Array.from(document.querySelectorAll('.codex-unit-name')).map((node) => node.textContent),
    ).toEqual(['民兵', '弓手', '卫士', '石头人', '女王', '国王', '皇家骑士', '法师', '大法师']);
    expect(document.querySelector('#codex-detail')?.textContent).toContain('民兵');

    categoryNamed('特殊兵种')?.click();
    expect(document.querySelectorAll('.codex-unit-card')).toHaveLength(11);
    expect(
      Array.from(document.querySelectorAll('.codex-unit-name')).map((node) => node.textContent),
    ).toEqual(['投弹车', '连弩车', '冲锋战车', '巨型炸弹', '小炸弹', '巨龙', '喷火龙', '基地', '箭塔', '双射手箭塔', '三射手箭塔']);
    expect(document.querySelector('#codex-detail')?.textContent).toContain('投弹车');
    expect(document.querySelector('#codex-detail')?.textContent).toContain('无法攻击空中单位');

    categoryNamed('召唤物')?.click();
    expect(document.querySelectorAll('.codex-unit-card')).toHaveLength(2);

    categoryNamed('单兵种')?.click();
    const mage = Array.from(document.querySelectorAll<HTMLButtonElement>('.codex-unit-card')).find(
      (button) => button.textContent?.includes('法师') && !button.textContent?.includes('大法师'),
    );
    mage?.click();
    expect(document.querySelector('#codex-detail')?.textContent).toContain('召唤');
  });

  it('三种箭塔图鉴写明优先攻击空中单位', () => {
    const page = createCodexPage({ onBack: vi.fn() });
    page.show();

    for (const name of ['箭塔', '双射手箭塔', '三射手箭塔']) {
      const card = Array.from(document.querySelectorAll<HTMLButtonElement>('.codex-unit-card')).find(
        (button) => button.querySelector('.codex-unit-name')?.textContent === name,
      );
      card?.click();
      expect(document.querySelector('#codex-detail')?.textContent).toContain('优先攻击空中单位');
    }
    page.dispose();
  });

  it('连弩车图鉴写明优先攻击空中单位', () => {
    const page = createCodexPage({ onBack: vi.fn() });
    page.show();

    const ballista = Array.from(document.querySelectorAll<HTMLButtonElement>('.codex-unit-card')).find(
      (button) => button.textContent?.includes('连弩车'),
    );
    ballista?.click();
    expect(document.querySelector('#codex-detail')?.textContent).toContain('优先攻击空中单位');
    page.dispose();
  });

  it('冲锋战车图鉴写明只攻击建筑并阵亡派出民兵', () => {
    const page = createCodexPage({ onBack: vi.fn() });
    page.show();

    const wagon = Array.from(document.querySelectorAll<HTMLButtonElement>('.codex-unit-card')).find(
      (button) => button.textContent?.includes('冲锋战车'),
    );
    wagon?.click();
    expect(document.querySelector('#codex-detail')?.textContent).toContain('只攻击建筑');
    expect(document.querySelector('#codex-detail')?.textContent).toContain('派出 5 个民兵');
    page.dispose();
  });

  it('战车图鉴写明无法攻击空中单位', () => {
    const page = createCodexPage({ onBack: vi.fn() });
    page.show();

    const chariot = Array.from(document.querySelectorAll<HTMLButtonElement>('.codex-unit-card')).find(
      (button) => button.querySelector('.codex-unit-name')?.textContent === '投弹车',
    );
    chariot?.click();
    expect(document.querySelector('#codex-detail')?.textContent).toContain('无法攻击空中单位');
    page.dispose();
  });

  it('详情不展示等级切换', () => {
    const page = createCodexPage({ onBack: vi.fn() });
    page.show();
    expect(document.querySelectorAll('.codex-level')).toHaveLength(0);
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

  it('开发服单位参数入口会回调 onOpenUnitStats', () => {
    document.body.innerHTML = `
      <main id="codex" class="is-hidden">
        <button id="btn-codex-back"></button>
        <button id="btn-codex-unit-stats"></button>
        <nav id="codex-category-list"></nav>
        <div id="codex-unit-list"></div>
        <article id="codex-detail"></article>
      </main>
    `;
    const onOpenUnitStats = vi.fn();
    const page = createCodexPage({ onBack: vi.fn(), onOpenUnitStats });
    document.querySelector<HTMLButtonElement>('#btn-codex-unit-stats')?.click();
    expect(onOpenUnitStats).toHaveBeenCalledOnce();
    page.dispose();
  });
});
