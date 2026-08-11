import { normalizeRoomId, normalizeRoomName, type JoinMode, type RoomListEntry } from '@pb/net';
import type { PlayerProfile } from '../account/types.js';
import { fetchRoomList } from '../net/session.js';
import type { SoloDifficulty } from '@pb/sim';

/** 大厅发起联机时的入房参数。 */
export interface VersusJoinRequest {
  mode: JoinMode;
  roomId?: string;
  roomName?: string;
}

export interface MainMenuOptions {
  onStartSandbox: () => void;
  onStartSolo: (difficulty: SoloDifficulty) => void;
  onStartVersus: (request: VersusJoinRequest) => void;
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
  const onlineRoomButton = required<HTMLButtonElement>('#btn-online-room', root);
  const onlineRoomPanel = required<HTMLElement>('#online-room-panel', root);
  const onlineRoomNameInput = required<HTMLInputElement>('#online-room-name-input', root);
  const onlineRoomInput = required<HTMLInputElement>('#online-room-input', root);
  const onlineRoomError = required<HTMLElement>('#online-room-error', root);
  const onlineRoomCreateButton = required<HTMLButtonElement>('#btn-online-room-create', root);
  const onlineRoomJoinButton = required<HTMLButtonElement>('#btn-online-room-join', root);
  const onlineRoomRefreshButton = required<HTMLButtonElement>('#btn-online-room-refresh', root);
  const onlineRoomList = required<HTMLElement>('#online-room-list', root);
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

  let roomListRequestId = 0;

  /** 关闭所有模式弹层，回到纯大厅态。 */
  const closeModeDialogs = (): void => {
    hideDialog(soloDialog);
    hideDialog(onlineDialog);
    hideRoomPanel();
  };

  /** 关闭改名弹层并清空错误提示。 */
  const closeRenameDialog = (): void => {
    hideDialog(renameDialog);
    renameError.textContent = '';
    renameError.classList.remove('is-visible');
  };

  /** 收起自定义房间输入区。 */
  const hideRoomPanel = (): void => {
    onlineRoomPanel.classList.add('is-hidden');
    onlineRoomError.textContent = '';
    onlineRoomError.classList.remove('is-visible');
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
    closeRenameDialog();
  };

  const openSoloDialog = (): void => {
    closeRenameDialog();
    hideDialog(onlineDialog);
    hideRoomPanel();
    showDialog(soloDialog);
  };

  const openOnlineDialog = (): void => {
    closeRenameDialog();
    hideDialog(soloDialog);
    hideRoomPanel();
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

    void fetchRoomList()
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

  /** 展开房号面板；再次点击可收起。 */
  const toggleRoomPanel = (): void => {
    const opening = onlineRoomPanel.classList.contains('is-hidden');
    if (!opening) {
      hideRoomPanel();
      return;
    }
    clearRoomError();
    if (!onlineRoomNameInput.value.trim()) {
      onlineRoomNameInput.value = defaultRoomName();
    }
    onlineRoomPanel.classList.remove('is-hidden');
    onlineRoomNameInput.focus();
    onlineRoomNameInput.select();
    refreshRoomList();
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
  onlineRoomButton.addEventListener('click', toggleRoomPanel);
  onlineRoomCreateButton.addEventListener('click', startOnlineCreate);
  onlineRoomJoinButton.addEventListener('click', startOnlineRoom);
  onlineRoomRefreshButton.addEventListener('click', refreshRoomList);
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
      onlineRoomButton.removeEventListener('click', toggleRoomPanel);
      onlineRoomCreateButton.removeEventListener('click', startOnlineCreate);
      onlineRoomJoinButton.removeEventListener('click', startOnlineRoom);
      onlineRoomRefreshButton.removeEventListener('click', refreshRoomList);
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
