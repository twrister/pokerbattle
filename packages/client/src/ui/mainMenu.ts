import {
  hasPromptedFirstPlayRename,
  markFirstPlayRenamePrompted,
} from '../account/firstPlayRename.js';
import { isDefaultDisplayName } from '../account/id.js';
import type { PlayerProfile } from '../account/types.js';
import type { SoloDifficulty } from '@pb/sim';
import { APP_VERSION, formatLobbyVersion, IS_DEV_SERVER } from '../env.js';

const RENAME_TITLE_DEFAULT = '玩家名称';
const RENAME_TITLE_FIRST_PLAY = '请先设置玩家名称';
/** 略长于收起动画，避免 animationend 丢失时弹层卡在半透明。 */
const RENAME_CLOSE_ANIM_MS = 280;

export interface MainMenuOptions {
  onStartSandbox: () => void;
  onStartSolo: (difficulty: SoloDifficulty) => void;
  /** 开发服调试模式：人机对局但玩家侧改为任意单兵种放置。 */
  onStartSoloDebug: () => void;
  /** 进入独立联机大厅页。 */
  onOpenOnline: () => void;
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
  const soloAiButton = required<HTMLButtonElement>('#btn-solo-ai', root);
  const soloDebugButton = required<HTMLButtonElement>('#btn-solo-debug', root);
  const soloDialog = required<HTMLElement>('#mode-solo-dialog', root);
  const renameDialog = required<HTMLElement>('#rename-dialog', root);
  const renamePanel = required<HTMLElement>('.mode-dialog-panel', renameDialog);
  const renameTitle = required<HTMLElement>('#rename-title', renameDialog);
  const renameForm = required<HTMLFormElement>('#rename-form', root);
  const renameInput = required<HTMLInputElement>('#rename-input', root);
  const renameError = required<HTMLElement>('#rename-error', root);
  const profileButton = required<HTMLButtonElement>('#btn-player-profile', root);
  const playerAvatar = required<HTMLElement>('#player-avatar', root);
  const playerName = required<HTMLElement>('#player-name', root);
  const playerLevel = required<HTMLElement>('#player-level', root);
  const status = required<HTMLElement>('#lobby-status', root);
  const versionLabel = required<HTMLElement>('#lobby-version', root);
  const placeholderButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-placeholder]'),
  );
  const closeButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-mode-close]'),
  );
  const renameCloseButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-rename-close]'),
  );

  /** 默认名点开局时记下目标模式，改名成功并收起后再打开。 */
  let pendingPlayAction: (() => void) | null = null;
  /** 主动改名本会话只弹一次；关页后再进仍会引导。 */
  let firstPlayRenamePrompted = hasPromptedFirstPlayRename();
  /** 递增以作废进行中的收起回调，避免切屏后误开模式弹窗。 */
  let renameAnimGeneration = 0;

  /** 关闭所有模式弹层，回到纯大厅态。 */
  const closeModeDialogs = (): void => {
    hideDialog(soloDialog);
  };

  /** 仍是建档默认名则拦截开局，引导先改名。 */
  const usesDefaultName = (): boolean => isDefaultDisplayName(options.getProfile());

  const invalidateRenameAnim = (): void => {
    renameAnimGeneration += 1;
  };

  /** 真正隐藏改名弹层并还原标题，供动画结束或整页切走调用。 */
  const finishHideRenameDialog = (): void => {
    renameDialog.classList.remove('is-opening', 'is-closing', 'is-preparing');
    hideDialog(renameDialog);
    renameError.textContent = '';
    renameError.classList.remove('is-visible');
    renameTitle.textContent = RENAME_TITLE_DEFAULT;
    profileButton.classList.remove('is-rename-anchor');
  };

  /** 整页切走或切到其他弹层时立刻关掉，不等收起动画。 */
  const hideRenameDialogInstant = (): void => {
    pendingPlayAction = null;
    invalidateRenameAnim();
    finishHideRenameDialog();
  };

  /** 用玩家卡片中心相对面板中心的偏移驱动展开/收起轨迹。 */
  const syncRenameOrigin = (): void => {
    const card = profileButton.getBoundingClientRect();
    const panel = renamePanel.getBoundingClientRect();
    const fromX = card.left + card.width / 2 - (panel.left + panel.width / 2);
    const fromY = card.top + card.height / 2 - (panel.top + panel.height / 2);
    renamePanel.style.setProperty('--rename-from-x', `${fromX}px`);
    renamePanel.style.setProperty('--rename-from-y', `${fromY}px`);
  };

  const waitForRenamePanelAnimation = (onDone: () => void): void => {
    const generation = ++renameAnimGeneration;
    const finish = (): void => {
      if (generation !== renameAnimGeneration) return;
      invalidateRenameAnim();
      renamePanel.removeEventListener('animationend', onAnimationEnd);
      window.clearTimeout(timer);
      onDone();
    };
    const onAnimationEnd = (event: AnimationEvent): void => {
      if (event.target !== renamePanel) return;
      finish();
    };
    renamePanel.addEventListener('animationend', onAnimationEnd);
    const timer = window.setTimeout(finish, RENAME_CLOSE_ANIM_MS);
  };

  /** 往玩家卡片收起后再隐藏，让用户看见改名入口在左上角。 */
  const closeRenameDialog = (onClosed?: () => void): void => {
    if (renameDialog.classList.contains('is-hidden')) {
      finishHideRenameDialog();
      onClosed?.();
      return;
    }
    renameDialog.classList.remove('is-opening', 'is-preparing');
    renameDialog.classList.add('is-closing');
    profileButton.classList.add('is-rename-anchor');
    waitForRenamePanelAnimation(() => {
      finishHideRenameDialog();
      onClosed?.();
    });
  };

  const dismissRenameDialog = (): void => {
    pendingPlayAction = null;
    closeRenameDialog();
  };

  const handleModeClose = (): void => {
    closeModeDialogs();
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
    hideRenameDialogInstant();
  };

  const openSoloDialog = (): void => {
    hideRenameDialogInstant();
    showDialog(soloDialog);
  };

  const openOnlinePage = (): void => {
    hideRenameDialogInstant();
    closeModeDialogs();
    options.onOpenOnline();
  };

  /** 从玩家卡片展开改名弹层；首次开局引导换标题。 */
  const openRenameDialog = (firstPlay = false): void => {
    closeModeDialogs();
    const profile = options.getProfile();
    renameInput.value = profile.displayName;
    renameError.textContent = '';
    renameError.classList.remove('is-visible');
    renameTitle.textContent = firstPlay ? RENAME_TITLE_FIRST_PLAY : RENAME_TITLE_DEFAULT;
    invalidateRenameAnim();
    renameDialog.classList.remove('is-opening', 'is-closing', 'is-hidden');
    renameDialog.classList.add('is-preparing');
    renameDialog.setAttribute('aria-hidden', 'false');
    profileButton.classList.remove('is-rename-anchor');
    void renamePanel.offsetWidth;
    syncRenameOrigin();
    renameDialog.classList.remove('is-preparing');
    void renamePanel.offsetWidth;
    renameDialog.classList.add('is-opening');
    renameInput.focus();
    renameInput.select();
  };

  const openRenameFromProfile = (): void => {
    pendingPlayAction = null;
    openRenameDialog(false);
  };

  /** 未自定义名且本会话尚未主动提示过时先改名；之后不再拦截开局。 */
  const requestPlayDialog = (openMode: () => void): void => {
    if (usesDefaultName() && !firstPlayRenamePrompted) {
      firstPlayRenamePrompted = true;
      markFirstPlayRenamePrompted();
      pendingPlayAction = openMode;
      openRenameDialog(true);
      return;
    }
    openMode();
  };

  const requestSoloDialog = (): void => requestPlayDialog(openSoloDialog);
  const requestOnlinePage = (): void => requestPlayDialog(openOnlinePage);

  /** 开发服进入沙盒；正式服仅提示不可进入，入口仍保留。 */
  const startSandbox = (): void => {
    if (!IS_DEV_SERVER) {
      status.textContent = '正式服不可进入模拟沙盒，请使用开发服';
      status.classList.add('is-visible');
      return;
    }
    options.onStartSandbox();
  };
  /** 关弹层后以人机对战（hard）进入单机。 */
  const startSoloAi = (): void => {
    closeModeDialogs();
    options.onStartSolo('hard');
  };
  /** 开发服进入调试放兵；正式服仅提示不可进入。 */
  const startSoloDebug = (): void => {
    closeModeDialogs();
    if (!IS_DEV_SERVER) {
      status.textContent = '正式服不可进入调试模式，请使用开发服';
      status.classList.add('is-visible');
      return;
    }
    options.onStartSoloDebug();
  };
  const openDeckConfig = (): void => options.onOpenDeckConfig();
  const openCodex = (): void => options.onOpenCodex();

  const submitRename = (event: Event): void => {
    event.preventDefault();
    try {
      options.onRename(renameInput.value);
      refreshProfile();
      const next = pendingPlayAction;
      pendingPlayAction = null;
      closeRenameDialog(() => {
        if (next && !usesDefaultName()) {
          next();
        }
      });
    } catch (error) {
      renameError.textContent = error instanceof Error ? error.message : String(error);
      renameError.classList.add('is-visible');
    }
  };

  soloButton.addEventListener('click', requestSoloDialog);
  matchButton.addEventListener('click', requestOnlinePage);
  sandboxButton.addEventListener('click', startSandbox);
  deckButton.addEventListener('click', openDeckConfig);
  codexButton.addEventListener('click', openCodex);
  soloAiButton.addEventListener('click', startSoloAi);
  soloDebugButton.addEventListener('click', startSoloDebug);
  profileButton.addEventListener('click', openRenameFromProfile);
  renameForm.addEventListener('submit', submitRename);
  for (const button of placeholderButtons) {
    button.addEventListener('click', showPlaceholder);
  }
  for (const button of closeButtons) {
    button.addEventListener('click', handleModeClose);
  }
  for (const button of renameCloseButtons) {
    button.addEventListener('click', dismissRenameDialog);
  }

  refreshProfile();
  versionLabel.textContent = formatLobbyVersion(APP_VERSION);

  return {
    show() {
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
      status.classList.remove('is-visible');
      closeModeDialogs();
      hideRenameDialogInstant();
      refreshProfile();
    },
    hide() {
      root.classList.add('is-hidden');
      root.setAttribute('aria-hidden', 'true');
      closeModeDialogs();
      hideRenameDialogInstant();
    },
    refreshProfile,
    dispose() {
      soloButton.removeEventListener('click', requestSoloDialog);
      matchButton.removeEventListener('click', requestOnlinePage);
      sandboxButton.removeEventListener('click', startSandbox);
      deckButton.removeEventListener('click', openDeckConfig);
      codexButton.removeEventListener('click', openCodex);
      soloAiButton.removeEventListener('click', startSoloAi);
      soloDebugButton.removeEventListener('click', startSoloDebug);
      profileButton.removeEventListener('click', openRenameFromProfile);
      renameForm.removeEventListener('submit', submitRename);
      for (const button of placeholderButtons) {
        button.removeEventListener('click', showPlaceholder);
      }
      for (const button of closeButtons) {
        button.removeEventListener('click', handleModeClose);
      }
      for (const button of renameCloseButtons) {
        button.removeEventListener('click', dismissRenameDialog);
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
