import { normalizeRoomId, normalizeRoomName, type JoinMode, type RoomListEntry } from '@pb/net';
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

/** 大厅发起联机时的入房参数。 */
export interface VersusJoinRequest {
  mode: JoinMode;
  roomId?: string;
  roomName?: string;
}

export interface MainMenuOptions {
  onStartSandbox: () => void;
  onStartSolo: (difficulty: SoloDifficulty) => void;
  /** 开发服调试模式：人机对局但玩家侧改为任意单兵种放置。 */
  onStartSoloDebug: () => void;
  onStartVersus: (request: VersusJoinRequest) => void;
  /** 匹配等待中取消：编排层应离开 versus 并断连。 */
  onCancelVersus: () => void;
  onOpenDeckConfig: () => void;
  onOpenCodex: () => void;
  /** 读取当前设备档案，供大厅展示。 */
  getProfile: () => PlayerProfile;
  /** 改名成功后由编排层持久化；失败应抛错。 */
  onRename: (displayName: string) => void;
  /** 复用应用层大厅 presence 拉取可加入房间。 */
  listRooms: () => Promise<RoomListEntry[]>;
}

export interface MainMenuHandle {
  show(): void;
  hide(): void;
  /** 档案变更后刷新名字/等级展示。 */
  refreshProfile(): void;
  /** 匹配等待时显示大厅状态旁的取消按钮。 */
  setRoomWaitingCancelVisible(visible: boolean): void;
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
  const onlineQuickButton = required<HTMLButtonElement>('#btn-online-quick', root);
  const onlineRoomButton = required<HTMLButtonElement>('#btn-online-room', root);
  const onlineRoomPanel = required<HTMLElement>('#online-room-panel', root);
  const onlineRoomNameInput = required<HTMLInputElement>('#online-room-name-input', root);
  const onlineRoomInput = required<HTMLInputElement>('#online-room-input', root);
  const onlineRoomError = required<HTMLElement>('#online-room-error', root);
  const onlineRoomCreateButton = required<HTMLButtonElement>('#btn-online-room-create', root);
  const onlineRoomJoinButton = required<HTMLButtonElement>('#btn-online-room-join', root);
  const onlineRoomRefreshButton = required<HTMLButtonElement>('#btn-online-room-refresh', root);
  const onlineRoomList = required<HTMLElement>('#online-room-list', root);
  const lobbyRoomCancelButton = required<HTMLButtonElement>('#btn-lobby-room-cancel', root);
  const soloDialog = required<HTMLElement>('#mode-solo-dialog', root);
  const onlineDialog = required<HTMLElement>('#mode-online-dialog', root);
  const onlineDialogTitle = required<HTMLElement>('#mode-online-title', root);
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

  let roomListRequestId = 0;
  /** 默认名点开局时记下目标模式，改名成功并收起后再打开。 */
  let pendingPlayAction: (() => void) | null = null;
  /** 主动改名本会话只弹一次；关页后再进仍会引导。 */
  let firstPlayRenamePrompted = hasPromptedFirstPlayRename();
  /** 递增以作废进行中的收起回调，避免切屏后误开模式弹窗。 */
  let renameAnimGeneration = 0;

  /** 关闭所有模式弹层，回到纯大厅态。 */
  const closeModeDialogs = (): void => {
    hideDialog(soloDialog);
    hideDialog(onlineDialog);
    hideRoomPanel();
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

  /** 收起房间视图，恢复快速匹配/房间入口。 */
  const hideRoomPanel = (): void => {
    onlineRoomPanel.classList.add('is-hidden');
    onlineDialog.classList.remove('is-room');
    onlineDialogTitle.textContent = '多人联机';
    onlineRoomError.textContent = '';
    onlineRoomError.classList.remove('is-visible');
  };

  /** 房间视图先退回联机选项；否则关弹层。 */
  const handleModeClose = (): void => {
    if (!onlineRoomPanel.classList.contains('is-hidden')) {
      hideRoomPanel();
      return;
    }
    closeModeDialogs();
  };

  /** 显示/隐藏大厅房间等待取消按钮。 */
  const setRoomWaitingCancelVisible = (visible: boolean): void => {
    lobbyRoomCancelButton.classList.toggle('is-hidden', !visible);
  };

  /** 大厅状态旁取消：离开匹配中的房间。 */
  const cancelLobbyRoomWaiting = (): void => {
    setRoomWaitingCancelVisible(false);
    status.classList.remove('is-visible');
    options.onCancelVersus();
  };

  /** 展示房间面板错误文案。 */
  const showRoomError = (message: string): void => {
    onlineRoomError.textContent = message;
    onlineRoomError.classList.add('is-visible');
  };

  /** 清空房间面板错误。 */
  const clearRoomError = (): void => {
    onlineRoomError.textContent = '';
    onlineRoomError.classList.remove('is-visible');
  };

  /** 默认房间名：当前展示名 + 「的房间」。 */
  const defaultRoomName = (): string => {
    const displayName = options.getProfile().displayName.trim() || '玩家';
    return `${displayName}的房间`;
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
    hideDialog(onlineDialog);
    hideRoomPanel();
    showDialog(soloDialog);
  };

  const openOnlineDialog = (): void => {
    hideRenameDialogInstant();
    hideDialog(soloDialog);
    hideRoomPanel();
    showDialog(onlineDialog);
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
  const requestOnlineDialog = (): void => requestPlayDialog(openOnlineDialog);

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
  /** 关弹层后发起快速匹配，等待态与主动创建房间相同（大厅状态 + 取消）。 */
  const startOnlineQuick = (): void => {
    closeModeDialogs();
    options.onStartVersus({ mode: 'quick' });
  };

  /** 渲染可加入房间列表。 */
  const renderRoomList = (rooms: RoomListEntry[]): void => {
    onlineRoomList.replaceChildren();
    if (rooms.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'online-room-list-empty';
      empty.textContent = '暂无可加入房间';
      onlineRoomList.append(empty);
      return;
    }

    for (const room of rooms) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'online-room-list-item';
      button.setAttribute('role', 'listitem');
      button.dataset.roomId = room.roomId;

      const id = document.createElement('span');
      id.className = 'online-room-list-id';
      id.textContent = room.roomId;

      const name = document.createElement('span');
      name.className = 'online-room-list-name';
      name.textContent = room.roomName;

      const count = document.createElement('span');
      count.className = 'online-room-list-count';
      count.textContent = `${room.playerCount}/${room.maxPlayers}`;

      button.append(id, name, count);
      button.addEventListener('click', () => {
        closeModeDialogs();
        options.onStartVersus({ mode: 'room', roomId: room.roomId });
      });
      onlineRoomList.append(button);
    }
  };

  /** 拉取并刷新可加入房间列表。 */
  const refreshRoomList = (): void => {
    const requestId = ++roomListRequestId;
    onlineRoomList.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'online-room-list-empty';
    loading.textContent = '加载中…';
    onlineRoomList.append(loading);

    void options
      .listRooms()
      .then((rooms) => {
        if (requestId !== roomListRequestId) return;
        renderRoomList(rooms);
      })
      .catch((error: unknown) => {
        if (requestId !== roomListRequestId) return;
        onlineRoomList.replaceChildren();
        const failed = document.createElement('div');
        failed.className = 'online-room-list-empty';
        failed.textContent = error instanceof Error ? error.message : '加载房间列表失败';
        onlineRoomList.append(failed);
      });
  };

  /** 展开房间视图：隐藏入口按钮并放大内容区。 */
  const showRoomPanel = (): void => {
    clearRoomError();
    if (!onlineRoomNameInput.value.trim()) {
      onlineRoomNameInput.value = defaultRoomName();
    }
    onlineDialog.classList.add('is-room');
    onlineDialogTitle.textContent = '房间';
    onlineRoomPanel.classList.remove('is-hidden');
    onlineRoomNameInput.focus();
    onlineRoomNameInput.select();
    refreshRoomList();
  };

  /** 展开房间视图；再次调用可收起（入口隐藏后主要由关闭键退回）。 */
  const toggleRoomPanel = (): void => {
    if (!onlineRoomPanel.classList.contains('is-hidden')) {
      hideRoomPanel();
      return;
    }
    showRoomPanel();
  };

  /** 用当前房间名创建房间。 */
  const startOnlineCreate = (): void => {
    clearRoomError();
    const roomName = normalizeRoomName(onlineRoomNameInput.value) ?? defaultRoomName();
    closeModeDialogs();
    options.onStartVersus({ mode: 'create', roomName });
  };

  /** 校验三位房号后加入已有房间。 */
  const startOnlineRoom = (): void => {
    const roomId = normalizeRoomId(onlineRoomInput.value);
    if (!roomId) {
      showRoomError('房间号须为 3 位数字');
      return;
    }
    closeModeDialogs();
    options.onStartVersus({ mode: 'room', roomId });
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
  matchButton.addEventListener('click', requestOnlineDialog);
  sandboxButton.addEventListener('click', startSandbox);
  deckButton.addEventListener('click', openDeckConfig);
  codexButton.addEventListener('click', openCodex);
  soloAiButton.addEventListener('click', startSoloAi);
  soloDebugButton.addEventListener('click', startSoloDebug);
  onlineQuickButton.addEventListener('click', startOnlineQuick);
  onlineRoomButton.addEventListener('click', toggleRoomPanel);
  onlineRoomCreateButton.addEventListener('click', startOnlineCreate);
  onlineRoomJoinButton.addEventListener('click', startOnlineRoom);
  onlineRoomRefreshButton.addEventListener('click', refreshRoomList);
  lobbyRoomCancelButton.addEventListener('click', cancelLobbyRoomWaiting);
  onlineRoomInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      startOnlineRoom();
    }
  });
  onlineRoomNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      startOnlineCreate();
    }
  });
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
      setRoomWaitingCancelVisible(false);
      closeModeDialogs();
      hideRenameDialogInstant();
      refreshProfile();
    },
    hide() {
      root.classList.add('is-hidden');
      root.setAttribute('aria-hidden', 'true');
      setRoomWaitingCancelVisible(false);
      closeModeDialogs();
      hideRenameDialogInstant();
    },
    refreshProfile,
    setRoomWaitingCancelVisible,
    dispose() {
      soloButton.removeEventListener('click', requestSoloDialog);
      matchButton.removeEventListener('click', requestOnlineDialog);
      sandboxButton.removeEventListener('click', startSandbox);
      deckButton.removeEventListener('click', openDeckConfig);
      codexButton.removeEventListener('click', openCodex);
      soloAiButton.removeEventListener('click', startSoloAi);
      soloDebugButton.removeEventListener('click', startSoloDebug);
      onlineQuickButton.removeEventListener('click', startOnlineQuick);
      onlineRoomButton.removeEventListener('click', toggleRoomPanel);
      onlineRoomCreateButton.removeEventListener('click', startOnlineCreate);
      onlineRoomJoinButton.removeEventListener('click', startOnlineRoom);
      onlineRoomRefreshButton.removeEventListener('click', refreshRoomList);
      lobbyRoomCancelButton.removeEventListener('click', cancelLobbyRoomWaiting);
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
