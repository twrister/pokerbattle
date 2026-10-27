// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRejoinDialog } from '../src/ui/rejoinDialog.js';

/** 与 index.html 保持同构的最小 DOM，便于断言显隐与倒计时。 */
const DIALOG_HTML = `
  <div id="rejoin-dialog" class="mode-dialog is-hidden" aria-hidden="true">
    <button class="mode-dialog-backdrop" type="button" data-rejoin-close></button>
    <div class="mode-dialog-panel">
      <header class="mode-dialog-header">
        <h2 id="rejoin-title" class="mode-dialog-title">继续对局</h2>
        <button class="mode-dialog-close" type="button" data-rejoin-close></button>
      </header>
      <p id="rejoin-detail"></p>
      <p id="rejoin-countdown"></p>
      <div class="rejoin-actions">
        <button id="btn-rejoin-decline" type="button" data-rejoin-close>放弃</button>
        <button id="btn-rejoin-accept" type="button">重连</button>
      </div>
    </div>
  </div>
`;

const INFO = {
  roomId: '042',
  roomName: '对局房',
  opponentName: 'Rival',
  remainingMs: 30_000,
};

describe('局外重连弹窗', () => {
  beforeEach(() => {
    document.body.innerHTML = DIALOG_HTML;
    vi.useFakeTimers();
  });

  it('弹出后展示房间与对手，倒计时逐秒递减', () => {
    const dialog = createRejoinDialog();
    dialog.show(INFO, { onAccept: () => {}, onDecline: () => {} });

    expect(dialog.isOpen()).toBe(true);
    expect(document.querySelector('#rejoin-detail')?.textContent).toContain('042 · 对局房');
    expect(document.querySelector('#rejoin-detail')?.textContent).toContain('Rival');
    expect(document.querySelector('#rejoin-countdown')?.textContent).toBe('30 秒后自动关闭');

    vi.advanceTimersByTime(5_000);
    expect(document.querySelector('#rejoin-countdown')?.textContent).toBe('25 秒后自动关闭');
    dialog.dispose();
  });

  it('点重连只触发一次，并禁用按钮避免重复接回', () => {
    const onAccept = vi.fn();
    const dialog = createRejoinDialog();
    dialog.show(INFO, { onAccept, onDecline: () => {} });

    const accept = document.querySelector<HTMLButtonElement>('#btn-rejoin-accept')!;
    accept.click();
    accept.click();

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(accept.disabled).toBe(true);
    expect(document.querySelector('#rejoin-countdown')?.textContent).toBe('正在重连…');
    dialog.dispose();
  });

  it('关闭视为放弃，并按 user 原因回调', () => {
    const onDecline = vi.fn();
    const dialog = createRejoinDialog();
    dialog.show(INFO, { onAccept: () => {}, onDecline });

    document.querySelector<HTMLButtonElement>('#btn-rejoin-decline')!.click();

    expect(onDecline).toHaveBeenCalledWith('user');
    expect(dialog.isOpen()).toBe(false);
    dialog.dispose();
  });

  it('倒计时归零自动关闭，并按 expired 原因回调', () => {
    const onDecline = vi.fn();
    const dialog = createRejoinDialog();
    dialog.show({ ...INFO, remainingMs: 2_000 }, { onAccept: () => {}, onDecline });

    vi.advanceTimersByTime(2_500);

    expect(onDecline).toHaveBeenCalledWith('expired');
    expect(dialog.isOpen()).toBe(false);
    dialog.dispose();
  });

  it('hide 只收起弹窗，不触发任何回调', () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    const dialog = createRejoinDialog();
    dialog.show(INFO, { onAccept, onDecline });

    dialog.hide();

    expect(dialog.isOpen()).toBe(false);
    expect(onAccept).not.toHaveBeenCalled();
    expect(onDecline).not.toHaveBeenCalled();
    dialog.dispose();
  });
});
