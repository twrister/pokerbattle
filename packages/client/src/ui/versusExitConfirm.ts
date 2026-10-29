export interface VersusExitConfirmOptions {
  /** 弹窗标题；单机是「暂停」，联机沿用「退出对局」。 */
  title?: string;
  /** 正文说明，用来讲清这次退出的后果。 */
  detail?: string;
  /** 确认按钮文案。 */
  confirmLabel?: string;
  /**
   * 点取消 / 遮罩 / 右上角关闭时的回调。
   * 单机靠它把 loop.paused 恢复成弹窗前的状态。
   */
  onCancel?: () => void;
}

export interface VersusExitConfirmHandle {
  /** 弹出确认；重复调用只更新确认回调与文案。 */
  show(onConfirm: () => void, options?: VersusExitConfirmOptions): void;
  hide(): void;
  isOpen(): boolean;
}

const DEFAULT_TITLE = '退出对局';
const DEFAULT_DETAIL = '中途退出将记为失败，确定要离开吗？';
const DEFAULT_CONFIRM_LABEL = '确定退出';

/**
 * 局内退出确认弹窗，单机与联机共用一套外观。
 *
 * 文案与按钮由调用方传入：单机当暂停弹窗用（顺带放音效开关），
 * 联机则强调「记为失败」。弹窗本身不碰对局状态，暂停与恢复交给调用方。
 */
export function createVersusExitConfirm(): VersusExitConfirmHandle {
  const root = requiredElement<HTMLElement>('#versus-exit-dialog');
  // 标题/正文/确认文案可缺省：裁剪过的页面里仍能正常工作
  const titleNode = root.querySelector<HTMLElement>('#versus-exit-title');
  const detailNode = root.querySelector<HTMLElement>('#versus-exit-detail');
  const confirmButton = requiredElement<HTMLButtonElement>('#btn-versus-exit-confirm', root);
  const cancelButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-versus-exit-cancel]'),
  );

  let pendingConfirm: (() => void) | null = null;
  let cancelHandler: (() => void) | null = null;

  /** 收起弹窗并清掉两条回调，避免下次误触发。 */
  const hide = (): void => {
    pendingConfirm = null;
    cancelHandler = null;
    root.classList.add('is-hidden');
    root.setAttribute('aria-hidden', 'true');
  };

  const confirm = (): void => {
    const next = pendingConfirm;
    hide();
    next?.();
  };

  /** 取消先收起弹窗再回调，调用方无需自己关框。 */
  const cancel = (): void => {
    const next = cancelHandler;
    hide();
    next?.();
  };

  confirmButton.addEventListener('click', confirm);
  for (const button of cancelButtons) {
    button.addEventListener('click', cancel);
  }

  return {
    show(onConfirm, options = {}) {
      pendingConfirm = onConfirm;
      cancelHandler = options.onCancel ?? null;
      if (titleNode) titleNode.textContent = options.title ?? DEFAULT_TITLE;
      if (detailNode) detailNode.textContent = options.detail ?? DEFAULT_DETAIL;
      confirmButton.textContent = options.confirmLabel ?? DEFAULT_CONFIRM_LABEL;
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
