// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVersusExitConfirm } from '../src/ui/versusExitConfirm.js';

function mountDialog(): void {
  document.body.innerHTML = `
    <div id="versus-exit-dialog" class="mode-dialog is-hidden" aria-hidden="true">
      <button data-versus-exit-cancel type="button">遮罩</button>
      <button id="btn-versus-exit-cancel" type="button" data-versus-exit-cancel>取消</button>
      <button id="btn-versus-exit-confirm" type="button">确定退出</button>
    </div>
  `;
}

describe('真人对战退出确认', () => {
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
});
