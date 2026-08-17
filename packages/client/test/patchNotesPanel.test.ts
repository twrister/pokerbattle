// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { PATCH_NOTES } from '../src/data/patchNotes.js';
import { createPatchNotesPanel } from '../src/ui/patchNotesPanel.js';

describe('更新公告面板', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="patch-notes-dialog" class="is-hidden" aria-hidden="true">
        <button data-patch-notes-close></button>
        <div id="patch-notes-list"></div>
      </div>
    `;
  });

  it('构造时按静态数据渲染版本与条目', () => {
    createPatchNotesPanel();

    const notes = document.querySelectorAll('.patch-note');
    expect(notes).toHaveLength(PATCH_NOTES.length);
    const newest = PATCH_NOTES[0];
    expect(document.querySelector('.patch-note-version')?.textContent).toBe(`v${newest.version}`);
    expect(document.querySelector('.patch-note-date')?.textContent).toBe(newest.date);
    expect(document.querySelector('.patch-note-items')?.textContent).toContain(newest.items[0]);
    expect(document.querySelector('#patch-notes-list')?.textContent).toContain('首个可玩版本');
  });

  it('打开后去掉隐藏，点击关闭按钮再收起', () => {
    const panel = createPatchNotesPanel();
    const dialog = document.querySelector('#patch-notes-dialog')!;

    panel.open();
    expect(dialog.classList.contains('is-hidden')).toBe(false);
    expect(dialog.getAttribute('aria-hidden')).toBe('false');

    document.querySelector<HTMLButtonElement>('[data-patch-notes-close]')!.click();
    expect(dialog.classList.contains('is-hidden')).toBe(true);
    expect(dialog.getAttribute('aria-hidden')).toBe('true');
  });
});
