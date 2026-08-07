export interface MainMenuOptions {
  onStartSandbox: () => void;
  onStartSolo: () => void;
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
  const sandboxButton = required<HTMLButtonElement>('#btn-sandbox', root);
  const status = required<HTMLElement>('#lobby-status', root);
  const placeholderButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-placeholder]'),
  );

  const showPlaceholder = (event: Event): void => {
    const button = event.currentTarget as HTMLButtonElement;
    status.textContent = `${button.dataset.placeholder ?? '该功能'}正在筹备中`;
    status.classList.add('is-visible');
  };

  const startSandbox = (): void => options.onStartSandbox();
  const startSolo = (): void => options.onStartSolo();

  soloButton.addEventListener('click', startSolo);
  sandboxButton.addEventListener('click', startSandbox);
  for (const button of placeholderButtons) {
    button.addEventListener('click', showPlaceholder);
  }

  return {
    show() {
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
      status.classList.remove('is-visible');
    },
    hide() {
      root.classList.add('is-hidden');
      root.setAttribute('aria-hidden', 'true');
    },
    dispose() {
      soloButton.removeEventListener('click', startSolo);
      sandboxButton.removeEventListener('click', startSandbox);
      for (const button of placeholderButtons) {
        button.removeEventListener('click', showPlaceholder);
      }
    },
  };
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`主界面缺少元素：${selector}`);
  return element;
}
