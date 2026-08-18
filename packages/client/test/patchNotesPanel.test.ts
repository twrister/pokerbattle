// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH_NOTES, resetPatchNotesToDefault } from '../src/data/patchNotes.js';
import { createPatchNotesPanel } from '../src/ui/patchNotesPanel.js';

const envState = vi.hoisted(() => ({ isDev: false }));

vi.mock('../src/env.js', () => ({
  get IS_DEV_SERVER() {
    return envState.isDev;
  },
  APP_VERSION: '0.1.5',
  formatLobbyVersion: (version: string) => `v${version.trim().replace(/^v/i, '') || '0.0.0'}`,
}));

function mountDom(): void {
  document.body.innerHTML = `
    <div id="patch-notes-dialog" class="is-hidden" aria-hidden="true">
      <button data-patch-notes-close></button>
      <div id="patch-notes-list"></div>
      <p id="patch-notes-status"></p>
      <button id="btn-patch-notes-add" type="button">新增版本</button>
      <button id="btn-patch-notes-save" type="button">保存</button>
    </div>
  `;
}

describe('更新公告面板', () => {
  beforeEach(() => {
    envState.isDev = false;
    resetPatchNotesToDefault();
    mountDom();
  });

  afterEach(() => {
    resetPatchNotesToDefault();
    vi.unstubAllGlobals();
  });

  it('正式服按静态数据渲染版本与条目', () => {
    createPatchNotesPanel();

    const notes = document.querySelectorAll('.patch-note');
    expect(notes).toHaveLength(PATCH_NOTES.length);
    const newest = PATCH_NOTES[0];
    expect(document.querySelector('.patch-note-version')?.textContent).toBe(`v${newest.version}`);
    expect(document.querySelector('.patch-note-date')?.textContent).toBe(newest.date);
    expect(document.querySelector('.patch-note-items')?.textContent).toContain(newest.items[0]);
    expect(document.querySelector('#patch-notes-list')?.textContent).toContain('首个可玩版本');
    expect(document.querySelector('.patch-note-version-input')).toBeNull();
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

  it('开发服渲染可编辑表单，新增版本插到最前', () => {
    envState.isDev = true;
    createPatchNotesPanel();

    expect(document.querySelectorAll('.patch-note.is-editing')).toHaveLength(PATCH_NOTES.length);
    expect(document.querySelector<HTMLInputElement>('.patch-note-version-input')?.value).toBe(
      PATCH_NOTES[0]!.version,
    );

    document.querySelector<HTMLButtonElement>('#btn-patch-notes-add')!.click();
    expect(document.querySelectorAll('.patch-note.is-editing')).toHaveLength(PATCH_NOTES.length + 1);
    expect(document.querySelector<HTMLInputElement>('.patch-note-version-input')?.value).toBe('0.1.5');
  });

  it('开发服改条目后保存会更新运行时并 POST 写盘', async () => {
    envState.isDev = true;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    createPatchNotesPanel();
    const items = document.querySelector<HTMLTextAreaElement>('.patch-note-items-input')!;
    items.value = '测试公告一行\n另一行';
    items.dispatchEvent(new Event('input'));

    document.querySelector<HTMLButtonElement>('#btn-patch-notes-save')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('#patch-notes-status')?.textContent).toContain('已保存');
    });

    expect(PATCH_NOTES[0]!.items).toEqual(['测试公告一行', '另一行']);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/__pb/patch-notes');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body[0].items).toEqual(['测试公告一行', '另一行']);
  });

  it('拖拽公告正文会滚动列表，开发服输入框不抢手势', () => {
    const panel = createPatchNotesPanel();
    const list = document.querySelector<HTMLElement>('#patch-notes-list')!;
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 400 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 200 });
    list.scrollTop = 0;

    const text = document.querySelector('.patch-note-items')!;
    text.dispatchEvent(pointerEvent('pointerdown', 1, 40, 120));
    list.dispatchEvent(pointerEvent('pointermove', 1, 40, 80));
    expect(list.scrollTop).toBe(40);
    expect(list.classList.contains('is-dragging')).toBe(true);

    list.dispatchEvent(pointerEvent('pointerup', 1, 40, 80));
    expect(list.classList.contains('is-dragging')).toBe(false);
    panel.dispose();
  });

  it('开发服拖拽条目输入框不会滚动列表', () => {
    envState.isDev = true;
    createPatchNotesPanel();
    const list = document.querySelector<HTMLElement>('#patch-notes-list')!;
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 400 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 200 });
    list.scrollTop = 0;

    const items = document.querySelector<HTMLTextAreaElement>('.patch-note-items-input')!;
    items.dispatchEvent(pointerEvent('pointerdown', 2, 40, 120));
    list.dispatchEvent(pointerEvent('pointermove', 2, 40, 80));
    expect(list.scrollTop).toBe(0);
  });

  it('开发服空条目保存失败且不写盘', () => {
    envState.isDev = true;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    createPatchNotesPanel();
    const items = document.querySelector<HTMLTextAreaElement>('.patch-note-items-input')!;
    items.value = '   \n';
    items.dispatchEvent(new Event('input'));

    document.querySelector<HTMLButtonElement>('#btn-patch-notes-save')!.click();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('#patch-notes-status')?.classList.contains('is-error')).toBe(true);
    expect(PATCH_NOTES[0]!.items[0]).not.toBe('');
  });
});

/** 给 jsdom 的 MouseEvent 补 pointerId，覆盖公告拖拽滚动的最小 PointerEvent 契约。 */
function pointerEvent(type: string, pointerId: number, clientX: number, clientY: number): Event {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}
