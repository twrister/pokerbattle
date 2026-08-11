import type { PlayerProfile } from '../account/types.js';
import type { SoloDifficulty } from '@pb/sim';

export interface MainMenuOptions {
  onStartSandbox: () => void;
  onStartSolo: (difficulty: SoloDifficulty) => void;
  onStartVersus: () => void;
  onOpenDeckConfig: () => void;
  onOpenCodex: () => void;
  /** 读取当前设备档案，供大厅展示。 */
  getProfile: () => PlayerProfile;
  /** 改名成功后由编排层持久化；失败应抛错。 */
  onRename: (displayName: string) => void;
}

export interface MainMenuHandle {
  show(): void;
  hide(): void;
  /** 档案变更后刷新名字/等级展示。 */
  refreshProfile(): void;
  dispose(): void;
}

/** 绑定大厅入口并管理大厅层显隐，避免页面编排逻辑散落到 DOM 事件中。 */
export function createMainMenu(options: MainMenuOptions): MainMenuHandle {
  const root = required<HTMLElement>('#main-menu');
  const soloButton = required<HTMLButtonElement>('#btn-solo', root);
  const matchButton = required<HTMLButtonElement>('#btn-match', root);
  const sandboxButton = required<HTMLButtonElement>('#btn-sandbox', root);
  const deckButton = required<HTMLButtonElement>('#btn-deck', root);
  const codexButton = required<HTMLButtonElement>('#btn-codex', root);
  const soloEasyButton = required<HTMLButtonElement>('#btn-solo-easy', root);
  const soloHardButton = required<HTMLButtonElement>('#btn-solo-hard', root);
  const onlineQuickButton = required<HTMLButtonElement>('#btn-online-quick', root);
  const soloDialog = required<HTMLElement>('#mode-solo-dialog', root);
  const onlineDialog = required<HTMLElement>('#mode-online-dialog', root);
  const renameDialog = required<HTMLElement>('#rename-dialog', root);
  const renameForm = required<HTMLFormElement>('#rename-form', root);
  const renameInput = required<HTMLInputElement>('#rename-input', root);
  const renameError = required<HTMLElement>('#rename-error', root);
  const profileButton = required<HTMLButtonElement>('#btn-player-profile', root);
  const playerAvatar = required<HTMLElement>('#player-avatar', root);
  const playerName = required<HTMLElement>('#player-name', root);
  const playerLevel = required<HTMLElement>('#player-level', root);
  const status = required<HTMLElement>('#lobby-status', root);
  const placeholderButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-placeholder]'),
  );
  const closeButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-mode-close]'),
  );
  const renameCloseButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-rename-close]'),
  );

  /** 关闭所有模式弹层，回到纯大厅态。 */
  const closeModeDialogs = (): void => {
    hideDialog(soloDialog);
    hideDialog(onlineDialog);
  };

  /** 关闭改名弹层并清空错误提示。 */
  const closeRenameDialog = (): void => {
    hideDialog(renameDialog);
    renameError.textContent = '';
    renameError.classList.remove('is-visible');
  };

  /** 把档案写到大厅玩家卡片。 */
  const refreshProfile = (): void => {
    const profile = options.getProfile();
    playerName.textContent = profile.displayName;
    playerLevel.textContent = formatLevelLine(profile.level);
    playerAvatar.textContent = avatarInitials(profile.displayName);
  };

  const showPlaceholder = (event: Event): void => {
    const button = event.currentTarget as HTMLButtonElement;
    status.textContent = `${button.dataset.placeholder ?? '该功能'}正在筹备中`;
    status.classList.add('is-visible');
    closeModeDialogs();
    closeRenameDialog();
  };

  const openSoloDialog = (): void => {
    closeRenameDialog();
    hideDialog(onlineDialog);
    showDialog(soloDialog);
  };

  const openOnlineDialog = (): void => {
    closeRenameDialog();
    hideDialog(soloDialog);
    showDialog(onlineDialog);
  };

  const openRenameDialog = (): void => {
    closeModeDialogs();
    const profile = options.getProfile();
    renameInput.value = profile.displayName;
    renameError.textContent = '';
    renameError.classList.remove('is-visible');
    showDialog(renameDialog);
    renameInput.focus();
    renameInput.select();
  };

  const startSandbox = (): void => options.onStartSandbox();
  /** 关弹层后把选择的难度交给战斗编排层。 */
  const startSolo = (difficulty: SoloDifficulty): void => {
    closeModeDialogs();
    options.onStartSolo(difficulty);
  };
  const startSoloEasy = (): void => startSolo('easy');
  const startSoloHard = (): void => startSolo('hard');
  const startOnlineQuick = (): void => {
    closeModeDialogs();
    options.onStartVersus();
  };
  const openDeckConfig = (): void => options.onOpenDeckConfig();
  const openCodex = (): void => options.onOpenCodex();

  const submitRename = (event: Event): void => {
    event.preventDefault();
    try {
      options.onRename(renameInput.value);
      refreshProfile();
      closeRenameDialog();
    } catch (error) {
      renameError.textContent = error instanceof Error ? error.message : String(error);
      renameError.classList.add('is-visible');
    }
  };

  soloButton.addEventListener('click', openSoloDialog);
  matchButton.addEventListener('click', openOnlineDialog);
  sandboxButton.addEventListener('click', startSandbox);
  deckButton.addEventListener('click', openDeckConfig);
  codexButton.addEventListener('click', openCodex);
  soloEasyButton.addEventListener('click', startSoloEasy);
  soloHardButton.addEventListener('click', startSoloHard);
  onlineQuickButton.addEventListener('click', startOnlineQuick);
  profileButton.addEventListener('click', openRenameDialog);
  renameForm.addEventListener('submit', submitRename);
  for (const button of placeholderButtons) {
    button.addEventListener('click', showPlaceholder);
  }
  for (const button of closeButtons) {
    button.addEventListener('click', closeModeDialogs);
  }
  for (const button of renameCloseButtons) {
    button.addEventListener('click', closeRenameDialog);
  }

  refreshProfile();

  return {
    show() {
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
      status.classList.remove('is-visible');
      closeModeDialogs();
      closeRenameDialog();
      refreshProfile();
    },
    hide() {
      root.classList.add('is-hidden');
      root.setAttribute('aria-hidden', 'true');
      closeModeDialogs();
      closeRenameDialog();
    },
    refreshProfile,
    dispose() {
      soloButton.removeEventListener('click', openSoloDialog);
      matchButton.removeEventListener('click', openOnlineDialog);
      sandboxButton.removeEventListener('click', startSandbox);
      deckButton.removeEventListener('click', openDeckConfig);
      codexButton.removeEventListener('click', openCodex);
      soloEasyButton.removeEventListener('click', startSoloEasy);
      soloHardButton.removeEventListener('click', startSoloHard);
      onlineQuickButton.removeEventListener('click', startOnlineQuick);
      profileButton.removeEventListener('click', openRenameDialog);
      renameForm.removeEventListener('submit', submitRename);
      for (const button of placeholderButtons) {
        button.removeEventListener('click', showPlaceholder);
      }
      for (const button of closeButtons) {
        button.removeEventListener('click', closeModeDialogs);
      }
      for (const button of renameCloseButtons) {
        button.removeEventListener('click', closeRenameDialog);
      }
    },
  };
}

/** 等级行展示：补齐两位等级。 */
function formatLevelLine(level: number): string {
  const levelText = String(Math.max(1, Math.floor(level))).padStart(2, '0');
  return `等级 ${levelText}`;
}

/** 头像缩写：取展示名前两个可见字符。 */
function avatarInitials(displayName: string): string {
  const compact = displayName.trim().replace(/\s+/g, '');
  if (!compact) return 'PB';
  return compact.slice(0, 2).toUpperCase();
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
