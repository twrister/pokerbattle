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

    expect(document.querySelectorAll('.codex-unit-card')).toHaveLength(23);
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
    ).toEqual(['全部兵种', '单兵种', '高级兵种', '其他']);
    expect(categoryNamed('全部兵种')?.classList.contains('is-active')).toBe(true);

    categoryNamed('单兵种')?.click();
    expect(document.querySelectorAll('.codex-unit-card')).toHaveLength(8);
    expect(
      Array.from(document.querySelectorAll('.codex-unit-name')).map((node) => node.textContent),
    ).toEqual(['民兵', '弓手', '卫士', '女王', '国王', '皇家骑士', '法师', '大法师']);
    expect(document.querySelector('#codex-detail')?.textContent).toContain('民兵');

    categoryNamed('高级兵种')?.click();
    expect(document.querySelectorAll('.codex-unit-card')).toHaveLength(10);
    expect(
      Array.from(document.querySelectorAll('.codex-unit-name')).map((node) => node.textContent),
    ).toEqual(['石头人', '小石头人', '投弹车', '连弩车', '冲锋战车', '飞龙', '喷火龙', '箭塔', '双射手箭塔', '三射手箭塔']);
    expect(document.querySelector('#codex-detail')?.textContent).toContain('投弹车');
    expect(document.querySelector('#codex-detail')?.textContent).toContain('无法攻击空中单位');

    categoryNamed('其他')?.click();
    expect(document.querySelectorAll('.codex-unit-card')).toHaveLength(5);
    expect(
      Array.from(document.querySelectorAll('.codex-unit-name')).map((node) => node.textContent),
    ).toEqual(['巨型炸弹', '小炸弹', '基地', '骷髅兵', '炸弹兵']);

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

  it('冲锋战车图鉴写明优先攻击建筑并阵亡派出民兵', () => {
    const page = createCodexPage({ onBack: vi.fn() });
    page.show();

    const wagon = Array.from(document.querySelectorAll<HTMLButtonElement>('.codex-unit-card')).find(
      (button) => button.textContent?.includes('冲锋战车'),
    );
    wagon?.click();
    expect(document.querySelector('#codex-detail')?.textContent).toContain('优先攻击建筑');
    expect(document.querySelector('#codex-detail')?.textContent).toContain('无敌方建筑时攻击最近敌人');
    expect(document.querySelector('#codex-detail')?.textContent).toContain('派出 4 个民兵');
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

  it('小石头人、连弩车、小炸弹的左侧缩略图带缩小标记', () => {
    const page = createCodexPage({ onBack: vi.fn() });
    page.show();

    const scaleOf = (name: string): string | undefined =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('.codex-unit-card')).find(
        (button) => button.querySelector('.codex-unit-name')?.textContent === name,
      )?.dataset.thumbScale;

    expect(scaleOf('小石头人')).toBe('0.7');
    expect(scaleOf('连弩车')).toBe('0.7');
    expect(scaleOf('小炸弹')).toBe('0.55');
    expect(scaleOf('巨型炸弹')).toBeUndefined();
    page.dispose();
  });

  it('三种箭塔立绘叠弓手，人数与局内部署一致', () => {
    const page = createCodexPage({ onBack: vi.fn() });
    page.show();

    const portraitOf = (name: string): HTMLElement | null => {
      const card = Array.from(document.querySelectorAll<HTMLButtonElement>('.codex-unit-card')).find(
        (button) => button.querySelector('.codex-unit-name')?.textContent === name,
      );
      return card?.querySelector<HTMLElement>('.codex-portrait') ?? null;
    };

    expect(portraitOf('箭塔')?.dataset.garrison).toBe('1');
    expect(portraitOf('箭塔')?.querySelectorAll('.codex-portrait-archer')).toHaveLength(1);
    expect(portraitOf('双射手箭塔')?.dataset.garrison).toBe('2');
    expect(portraitOf('双射手箭塔')?.querySelectorAll('.codex-portrait-archer')).toHaveLength(2);
    expect(portraitOf('三射手箭塔')?.dataset.garrison).toBe('3');
    expect(portraitOf('三射手箭塔')?.querySelectorAll('.codex-portrait-archer')).toHaveLength(3);

    portraitOf('三射手箭塔')?.closest('button')?.click();
    expect(
      document.querySelector<HTMLElement>('#codex-detail .codex-portrait')?.dataset.garrison,
    ).toBe('3');
    page.dispose();
  });

  it('详情在介绍下方按牌型列出一组样例牌', () => {
    const page = createCodexPage({ onBack: vi.fn() });
    page.show();

    const clickNamed = (name: string): void => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.codex-unit-card'))
        .find((button) => button.querySelector('.codex-unit-name')?.textContent === name)
        ?.click();
    };

    clickNamed('小石头人');
    const golemHands = Array.from(document.querySelectorAll('.codex-hand-name')).map(
      (node) => node.textContent,
    );
    expect(golemHands).toEqual(['四顺', '连对', '五顺', '同花']);
    expect(document.querySelectorAll('.codex-hand-card').length).toBeGreaterThan(0);

    clickNamed('基地');
    expect(document.querySelector('.codex-hands-empty')?.textContent).toBe('无法通过出牌获得');
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
