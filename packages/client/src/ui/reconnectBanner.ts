export interface ReconnectBannerHandle {
  showReconnecting(remainingMs: number): void;
  showRestored(): void;
  showFailed(reason: string): void;
  showPeerDisconnected(): void;
  showPeerReconnected(): void;
  hide(): void;
  dispose(): void;
}

/**
 * 战斗层轻量状态条：大厅隐藏后仍提示重连/对手离线，不打断渲染循环。
 */
export function createReconnectBanner(root: HTMLElement = document.body): ReconnectBannerHandle {
  const el = document.createElement('div');
  el.id = 'reconnect-banner';
  el.className = 'reconnect-banner is-hidden';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  root.appendChild(el);

  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const clearHideTimer = (): void => {
    if (!hideTimer) return;
    clearTimeout(hideTimer);
    hideTimer = null;
  };

  /** 按语气切换状态色，避免和顶部 HUD 抢层级。 */
  const show = (text: string, tone: 'info' | 'warn' | 'ok' | 'error'): void => {
    clearHideTimer();
    el.textContent = text;
    el.dataset.tone = tone;
    el.className = `reconnect-banner is-${tone}`;
  };

  return {
    showReconnecting(remainingMs) {
      const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
      show(`连接中断，正在重连…（剩余 ${seconds}s）`, 'warn');
    },
    showRestored() {
      show('连接已恢复', 'ok');
      hideTimer = setTimeout(() => {
        el.classList.add('is-hidden');
      }, 1800);
    },
    showFailed(reason) {
      show(reason || '重连失败', 'error');
    },
    showPeerDisconnected() {
      show('对手暂时断线，对局继续…', 'warn');
    },
    showPeerReconnected() {
      show('对手已重新连接', 'ok');
      hideTimer = setTimeout(() => {
        el.classList.add('is-hidden');
      }, 1800);
    },
    hide() {
      clearHideTimer();
      el.classList.add('is-hidden');
    },
    dispose() {
      clearHideTimer();
      el.remove();
    },
  };
}
