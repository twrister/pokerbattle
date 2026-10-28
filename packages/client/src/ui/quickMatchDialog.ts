export interface QuickMatchDialogHandle {
  /** 显示匹配中弹窗并接管取消回调；重复调用只更新状态文案。 */
  show(onCancel: () => void): void;
  /** 更新状态行，例如「对手已找到，即将开局…」。 */
  setStatus(text: string): void;
  hide(): void;
  dispose(): void;
}

/**
 * 快速匹配等待弹窗：只负责展示与取消，房间连接由编排层管理。
 * 服务端凑满人数会自动下发开局，因此这里不需要轮询。
 */
export function createQuickMatchDialog(): QuickMatchDialogHandle {
  const root = required<HTMLElement>('#quick-match-dialog');
  const status = required<HTMLElement>('#quick-match-status', root);
  const cancelButton = required<HTMLButtonElement>('#btn-quick-match-cancel', root);
  const closeButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-quick-match-cancel]'),
  );

  /** 每次 show 覆盖旧回调，避免取消动作打到上一次匹配的连接上。 */
  let onCancel: (() => void) | null = null;

  const cancel = (): void => {
    const handler = onCancel;
    onCancel = null;
    hide();
    handler?.();
  };

  const hide = (): void => {
    root.classList.add('is-hidden');
    root.setAttribute('aria-hidden', 'true');
  };

  cancelButton.addEventListener('click', cancel);
  for (const button of closeButtons) {
    button.addEventListener('click', cancel);
  }

  return {
    show(handler) {
      onCancel = handler;
      status.textContent = '正在寻找对手…';
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
    },
    setStatus(text) {
      if (root.classList.contains('is-hidden')) return;
      status.textContent = text;
    },
    hide() {
      onCancel = null;
      hide();
    },
    dispose() {
      cancelButton.removeEventListener('click', cancel);
      for (const button of closeButtons) {
        button.removeEventListener('click', cancel);
      }
    },
  };
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`快速匹配弹窗缺少元素：${selector}`);
  return element;
}
