export interface VersusExitConfirmHandle {
  /** 弹出确认；重复调用只更新确认回调。 */
  show(onConfirm: () => void): void;
  hide(): void;
  isOpen(): boolean;
}

/** 真人对战中途退出的二次确认；观战不使用。 */
export function createVersusExitConfirm(): VersusExitConfirmHandle {
  const root = requiredElement<HTMLElement>('#versus-exit-dialog');
  const confirmButton = requiredElement<HTMLButtonElement>('#btn-versus-exit-confirm', root);
  const cancelButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-versus-exit-cancel]'),
  );

  let pendingConfirm: (() => void) | null = null;

  const hide = (): void => {
    pendingConfirm = null;
    root.classList.add('is-hidden');
    root.setAttribute('aria-hidden', 'true');
  };

  const confirm = (): void => {
    const next = pendingConfirm;
    hide();
    next?.();
  };

  confirmButton.addEventListener('click', confirm);
  for (const button of cancelButtons) {
    button.addEventListener('click', hide);
  }

  return {
    show(onConfirm) {
      pendingConfirm = onConfirm;
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
    },
    hide,
    isOpen: () => !root.classList.contains('is-hidden'),
  };
}

function requiredElement<T extends HTMLElement>(selector: string, parent: ParentNode = document): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  return element;
}
