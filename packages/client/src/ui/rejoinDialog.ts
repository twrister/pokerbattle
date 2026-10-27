export interface RejoinDialogHandle {
  /**
   * 弹出重连窗：显示房间与对手信息并开始倒计时。
   * 回调只在用户真实点击或倒计时归零时触发；hide 不回调。
   */
  show(
    info: { roomId: string; roomName: string; opponentName: string; remainingMs: number },
    handlers: { onAccept: () => void; onDecline: (reason: 'user' | 'expired') => void },
  ): void;
  /** 切到"正在重连"状态：禁用按钮并接管倒计时文案。 */
  setBusy(text?: string): void;
  hide(): void;
  isOpen(): boolean;
  dispose(): void;
}

/**
 * 局外重连窗：只在主菜单/联机大厅出现。
 * 倒计时归零自动按放弃处理，让玩家明白错过后席位会被释放。
 */
export function createRejoinDialog(): RejoinDialogHandle {
  const root = requiredElement<HTMLElement>('#rejoin-dialog');
  const detail = requiredElement<HTMLElement>('#rejoin-detail', root);
  const countdown = requiredElement<HTMLElement>('#rejoin-countdown', root);
  const acceptButton = requiredElement<HTMLButtonElement>('#btn-rejoin-accept', root);
  const declineButton = requiredElement<HTMLButtonElement>('#btn-rejoin-decline', root);
  const closeButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-rejoin-close]'),
  );

  let acceptHandler: (() => void) | null = null;
  let declineHandler: ((reason: 'user' | 'expired') => void) | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let deadline = 0;

  const clearTick = (): void => {
    if (!tickTimer) return;
    clearInterval(tickTimer);
    tickTimer = null;
  };

  /** 关闭面板并交还回调，保证同一时机只触发一次。 */
  const takeHandlers = (): {
    accept: (() => void) | null;
    decline: ((reason: 'user' | 'expired') => void) | null;
  } => {
    clearTick();
    const handlers = { accept: acceptHandler, decline: declineHandler };
    acceptHandler = null;
    declineHandler = null;
    root.classList.add('is-hidden');
    root.setAttribute('aria-hidden', 'true');
    return handlers;
  };

  const setButtonsEnabled = (enabled: boolean): void => {
    acceptButton.disabled = !enabled;
    declineButton.disabled = !enabled;
    for (const button of closeButtons) button.disabled = !enabled;
  };

  /** 刷新剩余秒数；归零按放弃处理，避免弹窗停在过期席位上。 */
  const syncCountdown = (): void => {
    const remaining = Math.max(0, deadline - Date.now());
    countdown.textContent = `${Math.ceil(remaining / 1000)} 秒后自动关闭`;
    if (remaining > 0) return;
    takeHandlers().decline?.('expired');
  };

  const accept = (): void => {
    // 先取回调再清状态：重连过程中重复点击不会再发一次
    const next = acceptHandler;
    acceptHandler = null;
    declineHandler = null;
    clearTick();
    setButtonsEnabled(false);
    countdown.textContent = '正在重连…';
    next?.();
  };

  const decline = (): void => {
    takeHandlers().decline?.('user');
  };

  acceptButton.addEventListener('click', accept);
  declineButton.addEventListener('click', decline);
  for (const button of closeButtons) button.addEventListener('click', decline);

  return {
    show(info, handlers) {
      acceptHandler = handlers.onAccept;
      declineHandler = handlers.onDecline;
      const label = info.roomName ? `${info.roomId} · ${info.roomName}` : info.roomId;
      detail.textContent = `你还有一局对战未结束（房间 ${label}${
        info.opponentName ? `，对手 ${info.opponentName}` : ''
      }）。现在回去可以继续打，关闭则视为放弃本局。`;
      deadline = Date.now() + Math.max(0, info.remainingMs);
      setButtonsEnabled(true);
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
      clearTick();
      syncCountdown();
      // 归零前持续刷新，给出明确的时间压力；已因归零关闭则不再起表
      if (!root.classList.contains('is-hidden')) {
        tickTimer = setInterval(syncCountdown, 500);
      }
    },
    setBusy(text) {
      clearTick();
      setButtonsEnabled(false);
      if (text) countdown.textContent = text;
    },
    hide() {
      takeHandlers();
    },
    isOpen: () => !root.classList.contains('is-hidden'),
    dispose() {
      takeHandlers();
      acceptButton.removeEventListener('click', accept);
      declineButton.removeEventListener('click', decline);
      for (const button of closeButtons) button.removeEventListener('click', decline);
    },
  };
}

function requiredElement<T extends HTMLElement>(selector: string, parent: ParentNode = document): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  return element;
}
