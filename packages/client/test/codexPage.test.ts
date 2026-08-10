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

  it('只展示可移动单位，并按分类切换档案', () => {
    const page = createCodexPage({ onBack: vi.fn() });
    page.show();

    expect(document.querySelectorAll('.codex-unit-card')).toHaveLength(12);
    expect(document.querySelector('#codex-detail')?.textContent).toContain('民兵');
    expect(document.querySelectorAll('.codex-stat-bar')).toHaveLength(5);
    expect(document.querySelector('.codex-stat-bar span')?.getAttribute('style')).toContain('20%');
    expect(document.querySelector('#codex-detail')?.textContent).not.toContain('400');

    const allCategory = Array.from(document.querySelectorAll<HTMLButtonElement>('.codex-category')).find(
      (button) => button.textContent === '全部兵种',
    );
    expect(allCategory?.classList.contains('is-active')).toBe(true);

    const heroCategory = Array.from(document.querySelectorAll<HTMLButtonElement>('.codex-category')).find(
      (button) => button.textContent === '英雄',
    );
    heroCategory?.click();
    expect(document.querySelectorAll('.codex-unit-card')).toHaveLength(4);
    expect(document.querySelector('#codex-detail')?.textContent).toContain('国王');

    const mage = Array.from(document.querySelectorAll<HTMLButtonElement>('.codex-unit-card')).find(
      (button) => button.textContent?.includes('法师'),
    );
    mage?.click();
    expect(document.querySelector('#codex-detail')?.textContent).toContain('召唤');
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
