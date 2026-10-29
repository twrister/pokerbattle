// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVersusExitConfirm } from '../src/ui/versusExitConfirm.js';

function mountDialog(): void {
  document.body.innerHTML = `
    <div id="versus-exit-dialog" class="mode-dialog is-hidden" aria-hidden="true">
      <button data-versus-exit-cancel type="button">遮罩</button>
      <div class="mode-dialog-panel">
        <h2 id="versus-exit-title">退出对局</h2>
        <p id="versus-exit-detail">中途退出将记为失败，确定要离开吗？</p>
        <button id="btn-versus-exit-cancel" type="button" data-versus-exit-cancel>取消</button>
        <button id="btn-versus-exit-confirm" type="button">确定退出</button>
      </div>
    </div>
  `;
}

describe('局内退出确认', () => {
  beforeEach(() => {
    mountDialog();
  });

  it('取消或点遮罩只关弹窗，不离开对局', () => {
    const onConfirm = vi.fn();
    const dialog = createVersusExitConfirm();
    dialog.show(onConfirm);

    expect(dialog.isOpen()).toBe(true);
    document.querySelector<HTMLButtonElement>('#btn-versus-exit-cancel')!.click();
    expect(dialog.isOpen()).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();

    dialog.show(onConfirm);
    document.querySelector<HTMLButtonElement>('[data-versus-exit-cancel]')!.click();
    expect(dialog.isOpen()).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('确定退出后关闭弹窗并执行离开', () => {
    const onConfirm = vi.fn();
    const dialog = createVersusExitConfirm();
    dialog.show(onConfirm);

    document.querySelector<HTMLButtonElement>('#btn-versus-exit-confirm')!.click();
    expect(dialog.isOpen()).toBe(false);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('取消时回调，供单机恢复暂停状态', () => {
    const onCancel = vi.fn();
    const dialog = createVersusExitConfirm();
    dialog.show(() => {}, { onCancel });

    document.querySelector<HTMLButtonElement>('#btn-versus-exit-cancel')!.click();
    expect(onCancel).toHaveBeenCalledTimes(1);

    // 确认走另一条回调，取消不再触发
    const onConfirm = vi.fn();
    dialog.show(onConfirm, { onCancel });
    document.querySelector<HTMLButtonElement>('#btn-versus-exit-confirm')!.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('按传入参数改写标题、正文与确认文案，缺省时回落原本文案', () => {
    const dialog = createVersusExitConfirm();
    const title = document.querySelector('#versus-exit-title')!;
    const detail = document.querySelector('#versus-exit-detail')!;
    const confirm = document.querySelector('#btn-versus-exit-confirm')!;

    dialog.show(() => {}, { title: '暂停', detail: '退出后本局进度不会保留。', confirmLabel: '退出对局' });
    expect(title.textContent).toBe('暂停');
    expect(detail.textContent).toBe('退出后本局进度不会保留。');
    expect(confirm.textContent).toBe('退出对局');

    dialog.show(() => {});
    expect(title.textContent).toBe('退出对局');
    expect(confirm.textContent).toBe('确定退出');
  });
});
