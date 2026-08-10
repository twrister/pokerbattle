export interface MainMenuOptions {
  onStartSandbox: () => void;
  onStartSolo: () => void;
  onStartVersus: () => void;
  onOpenDeckConfig: () => void;
}

export interface MainMenuHandle {
  show(): void;
  hide(): void;
  dispose(): void;
}

/** 绑定大厅入口并管理大厅层显隐，避免页面编排逻辑散落到 DOM 事件中。 */
export function createMainMenu(options: MainMenuOptions): MainMenuHandle {
  const root = required<HTMLElement>('#main-menu');
  const soloButton = required<HTMLButtonElement>('#btn-solo', root);
  const matchButton = required<HTMLButtonElement>('#btn-match', root);
  const sandboxButton = required<HTMLButtonElement>('#btn-sandbox', root);
  const deckButton = required<HTMLButtonElement>('#btn-deck', root);
  const soloEasyButton = required<HTMLButtonElement>('#btn-solo-easy', root);
  const onlineQuickButton = required<HTMLButtonElement>('#btn-online-quick', root);
  const soloDialog = required<HTMLElement>('#mode-solo-dialog', root);
  const onlineDialog = required<HTMLElement>('#mode-online-dialog', root);
  const status = required<HTMLElement>('#lobby-status', root);
  const placeholderButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-placeholder]'),
  );
  const closeButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-mode-close]'),
  );

  /** 关闭所有模式弹层，回到纯大厅态。 */
  const closeModeDialogs = (): void => {
    hideDialog(soloDialog);
    hideDialog(onlineDialog);
  };

  const showPlaceholder = (event: Event): void => {
    const button = event.currentTarget as HTMLButtonElement;
    status.textContent = `${button.dataset.placeholder ?? '该功能'}正在筹备中`;
    status.classList.add('is-visible');
    closeModeDialogs();
  };

  const openSoloDialog = (): void => {
    hideDialog(onlineDialog);
    showDialog(soloDialog);
  };

  const openOnlineDialog = (): void => {
    hideDialog(soloDialog);
    showDialog(onlineDialog);
  };

  const startSandbox = (): void => options.onStartSandbox();
  // 简单人机 / 快速匹配：关弹层后走原有进房回调
  const startSoloEasy = (): void => {
    closeModeDialogs();
    options.onStartSolo();
  };
  const startOnlineQuick = (): void => {
    closeModeDialogs();
    options.onStartVersus();
  };
  const openDeckConfig = (): void => options.onOpenDeckConfig();

  soloButton.addEventListener('click', openSoloDialog);
  matchButton.addEventListener('click', openOnlineDialog);
  sandboxButton.addEventListener('click', startSandbox);
  deckButton.addEventListener('click', openDeckConfig);
  soloEasyButton.addEventListener('click', startSoloEasy);
  onlineQuickButton.addEventListener('click', startOnlineQuick);
  for (const button of placeholderButtons) {
    button.addEventListener('click', showPlaceholder);
  }
  for (const button of closeButtons) {
    button.addEventListener('click', closeModeDialogs);
  }

  return {
    show() {
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
      status.classList.remove('is-visible');
      closeModeDialogs();
    },
    hide() {
      root.classList.add('is-hidden');
      root.setAttribute('aria-hidden', 'true');
      closeModeDialogs();
    },
    dispose() {
      soloButton.removeEventListener('click', openSoloDialog);
      matchButton.removeEventListener('click', openOnlineDialog);
      sandboxButton.removeEventListener('click', startSandbox);
      deckButton.removeEventListener('click', openDeckConfig);
      soloEasyButton.removeEventListener('click', startSoloEasy);
      onlineQuickButton.removeEventListener('click', startOnlineQuick);
      for (const button of placeholderButtons) {
        button.removeEventListener('click', showPlaceholder);
      }
      for (const button of closeButtons) {
        button.removeEventListener('click', closeModeDialogs);
      }
    },
  };
}

/** 显示模式弹层。 */
function showDialog(dialog: HTMLElement): void {
  dialog.classList.remove('is-hidden');
  dialog.setAttribute('aria-hidden', 'false');
}

/** 隐藏模式弹层。 */
function hideDialog(dialog: HTMLElement): void {
  dialog.classList.add('is-hidden');
  dialog.setAttribute('aria-hidden', 'true');
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`主界面缺少元素：${selector}`);
  return element;
}
