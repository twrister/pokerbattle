// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const preview = { render: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
vi.mock('../src/view/formationPreview.js', () => ({
  createFormationPreview: vi.fn(() => preview),
}));

import { createDeckConfigPage } from '../src/ui/deckConfigPage.js';

describe('卡组阵型配置页', () => {
  beforeEach(() => {
    preview.render.mockClear();
    preview.resize.mockClear();
    preview.dispose.mockClear();
    document.body.innerHTML = `
      <main id="deck-config" class="is-hidden">
        <button id="btn-deck-back"></button>
        <button id="btn-deck-add-formation"></button>
        <button id="btn-deck-save"></button>
        <button id="btn-deck-reset"></button>
        <div id="deck-category-list"></div>
        <div id="deck-formation-list"></div>
        <div id="deck-editor"></div>
        <div id="deck-status"></div>
        <div id="deck-preview"></div>
      </main>
    `;
  });

  it('进入后显示牌型、创建阵型并在返回时通知页面控制器', () => {
    const onBack = vi.fn();
    const page = createDeckConfigPage({ onBack });

    page.show();
    expect(document.querySelectorAll('.deck-category')).toHaveLength(13);
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
});
