// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { createPauseConfirm } from '../src/ui/pauseConfirm.js';
import type { VersusExitConfirmHandle } from '../src/ui/versusExitConfirm.js';

/** 用桩弹窗替代真实 DOM，专注验证暂停状态机。 */
function createDialogStub(): VersusExitConfirmHandle & {
  confirm: () => void;
  cancel: () => void;
  shown: number;
} {
  let onConfirm: (() => void) | null = null;
  let onCancel: (() => void) | null = null;
  const stub = {
    shown: 0,
    show(next: () => void, options?: { onCancel?: () => void }) {
      stub.shown += 1;
      onConfirm = next;
      onCancel = options?.onCancel ?? null;
    },
    hide() {
      onConfirm = null;
      onCancel = null;
    },
    isOpen: () => onConfirm !== null,
    confirm: () => onConfirm?.(),
    cancel: () => onCancel?.(),
  };
  return stub;
}

describe('单机返回暂停确认', () => {
  let paused: boolean;
  let resolved: boolean;
  let endless: boolean;
  let exited: number;
  let abandoned: number;

  beforeEach(() => {
    paused = false;
    resolved = false;
    endless = false;
    exited = 0;
    abandoned = 0;
  });

  const build = (dialog: ReturnType<typeof createDialogStub>) =>
    createPauseConfirm({
      dialog,
      isResolved: () => resolved,
      isPaused: () => paused,
      setPaused: (next) => {
        paused = next;
      },
      isEndless: () => endless,
      onEndlessAbandon: () => {
        abandoned += 1;
      },
      onExit: () => {
        exited += 1;
      },
    });

  it('点返回先暂停再弹框，取消后恢复到弹窗前的状态', () => {
    const dialog = createDialogStub();
    const handle = build(dialog);

    handle.requestExit();
    expect(paused).toBe(true);
    expect(dialog.shown).toBe(1);
    expect(exited).toBe(0);

    dialog.cancel();
    expect(paused).toBe(false);
    expect(exited).toBe(0);
  });

  it('弹框前已暂停（调试面板手动暂停）时，取消仍然保持暂停', () => {
    const dialog = createDialogStub();
    paused = true;
    const handle = build(dialog);

    handle.requestExit();
    dialog.cancel();
    expect(paused).toBe(true);
  });

  it('确认后直接离开，不再恢复暂停状态', () => {
    const dialog = createDialogStub();
    const handle = build(dialog);

    handle.requestExit();
    dialog.confirm();
    expect(exited).toBe(1);
    expect(paused).toBe(true);
    expect(abandoned).toBe(0);
  });

  it('无限防守主动退出先按失败记账再离开', () => {
    const dialog = createDialogStub();
    endless = true;
    const handle = build(dialog);

    handle.requestExit();
    dialog.confirm();
    expect(abandoned).toBe(1);
    expect(exited).toBe(1);
  });

  it('已结算时返回不弹框也不暂停', () => {
    const dialog = createDialogStub();
    resolved = true;
    const handle = build(dialog);

    handle.requestExit();
    expect(dialog.shown).toBe(0);
    expect(paused).toBe(false);
    expect(exited).toBe(1);
  });

  it('弹框已开着时重复点返回不会改写暂停快照', () => {
    const dialog = createDialogStub();
    const handle = build(dialog);

    handle.requestExit();
    handle.requestExit();
    expect(dialog.shown).toBe(1);

    dialog.cancel();
    expect(paused).toBe(false);
  });
});
