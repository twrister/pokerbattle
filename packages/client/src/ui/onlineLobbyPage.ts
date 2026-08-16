import { normalizeRoomId, normalizeRoomName, type RoomListEntry } from '@pb/net';
import type { RoomJoinRequest } from '../net/session.js';

const LIST_REFRESH_MS = 4000;

export interface OnlineLobbyPageOptions {
  onBack: () => void;
  onJoinRoom: (request: RoomJoinRequest) => void;
  onSpectateRoom: (roomId: string) => void;
  getDefaultRoomName: () => string;
  listRooms: () => Promise<RoomListEntry[]>;
}

export interface OnlineLobbyPageHandle {
  show(): void;
  hide(): void;
  /** 入房失败等提示，显示在大厅页底部。 */
  showError(message: string): void;
  dispose(): void;
}

/** 联机大厅：房间卡片列表 + 创建/加入弹窗。 */
export function createOnlineLobbyPage(options: OnlineLobbyPageOptions): OnlineLobbyPageHandle {
  const root = required<HTMLElement>('#online-lobby');
  const backButton = required<HTMLButtonElement>('#btn-online-lobby-back', root);
  const refreshButton = required<HTMLButtonElement>('#btn-online-lobby-refresh', root);
  const roomList = required<HTMLElement>('#online-lobby-list', root);
  const createButton = required<HTMLButtonElement>('#btn-online-lobby-create', root);
  const joinButton = required<HTMLButtonElement>('#btn-online-lobby-join', root);
  const status = required<HTMLElement>('#online-lobby-status', root);
  const createDialog = required<HTMLElement>('#online-create-dialog', root);
  const joinDialog = required<HTMLElement>('#online-join-dialog', root);
  const createNameInput = required<HTMLInputElement>('#online-create-name-input', root);
  const createConfirm = required<HTMLButtonElement>('#btn-online-create-confirm', root);
  const joinIdInput = required<HTMLInputElement>('#online-join-id-input', root);
  const joinConfirm = required<HTMLButtonElement>('#btn-online-join-confirm', root);
  const createError = required<HTMLElement>('#online-create-error', root);
  const joinError = required<HTMLElement>('#online-join-error', root);
  const createCloseButtons = Array.from(
    createDialog.querySelectorAll<HTMLButtonElement>('[data-online-create-close]'),
  );
  const joinCloseButtons = Array.from(
    joinDialog.querySelectorAll<HTMLButtonElement>('[data-online-join-close]'),
  );

  let listRequestId = 0;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  const clearStatus = (): void => {
    status.textContent = '';
    status.classList.remove('is-visible');
  };

  const showStatus = (message: string): void => {
    status.textContent = message;
    status.classList.toggle('is-visible', Boolean(message));
  };

  const hideDialogs = (): void => {
    hideDialog(createDialog);
    hideDialog(joinDialog);
    createError.textContent = '';
    createError.classList.remove('is-visible');
    joinError.textContent = '';
    joinError.classList.remove('is-visible');
  };

  const renderRoomList = (rooms: RoomListEntry[]): void => {
    roomList.replaceChildren();
    if (rooms.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'online-lobby-empty';
      empty.textContent = '暂无房间';
      roomList.append(empty);
      return;
    }

    for (const room of rooms) {
      const phase = room.phase === 'playing' ? 'playing' : 'waiting';
      const card = document.createElement('div');
      card.className = 'online-room-card';
      if (phase === 'playing') card.classList.add('is-playing');
      card.setAttribute('role', 'listitem');
      card.dataset.roomId = room.roomId;

      const meta = document.createElement('div');
      meta.className = 'online-room-card-meta';

      // 房号与房间名同一行，保证卡片高度固定、长名省略。
      const title = document.createElement('div');
      title.className = 'online-room-card-title';

      const id = document.createElement('span');
      id.className = 'online-room-card-id';
      id.textContent = room.roomId;

      const name = document.createElement('span');
      name.className = 'online-room-card-name';
      name.textContent = room.roomName;
      title.append(id, name);

      const info = document.createElement('div');
      info.className = 'online-room-card-info';

      const count = document.createElement('span');
      count.className = 'online-room-card-count';
      count.textContent = `${room.playerCount}/${room.maxPlayers}`;

      const state = document.createElement('span');
      state.className = 'online-room-card-state';
      if (phase === 'playing') {
        state.textContent = `对局中 · 观战 ${room.spectatorCount ?? 0}`;
      } else if (room.playerCount >= room.maxPlayers) {
        state.textContent = '已满';
      } else {
        state.textContent = '等待中';
      }
      info.append(count, state);
      meta.append(title, info);

      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'online-room-card-action';

      if (phase === 'playing') {
        action.textContent = '观战';
        action.addEventListener('click', () => {
          hideDialogs();
          options.onSpectateRoom(room.roomId);
        });
      } else if (room.playerCount >= room.maxPlayers) {
        action.textContent = '已满';
        action.disabled = true;
      } else {
        action.textContent = '加入';
        action.addEventListener('click', () => {
          hideDialogs();
          options.onJoinRoom({ mode: 'room', roomId: room.roomId });
        });
      }

      card.append(meta, action);
      roomList.append(card);
    }
  };

  const refreshRoomList = (): void => {
    const requestId = ++listRequestId;
    if (roomList.childElementCount === 0) {
      const loading = document.createElement('div');
      loading.className = 'online-lobby-empty';
      loading.textContent = '加载中…';
      roomList.append(loading);
    }

    void options
      .listRooms()
      .then((rooms) => {
        if (requestId !== listRequestId) return;
        renderRoomList(rooms);
      })
      .catch((error: unknown) => {
        if (requestId !== listRequestId) return;
        roomList.replaceChildren();
        const failed = document.createElement('div');
        failed.className = 'online-lobby-empty';
        failed.textContent = error instanceof Error ? error.message : '加载房间列表失败';
        roomList.append(failed);
      });
  };

  const openCreateDialog = (): void => {
    hideDialog(joinDialog);
    createError.textContent = '';
    createError.classList.remove('is-visible');
    createNameInput.value = options.getDefaultRoomName();
    showDialog(createDialog);
    createNameInput.focus();
    createNameInput.select();
  };

  const openJoinDialog = (): void => {
    hideDialog(createDialog);
    joinError.textContent = '';
    joinError.classList.remove('is-visible');
    joinIdInput.value = '';
    showDialog(joinDialog);
    joinIdInput.focus();
  };

  const confirmCreate = (): void => {
    const roomName = normalizeRoomName(createNameInput.value) ?? options.getDefaultRoomName();
    hideDialogs();
    options.onJoinRoom({ mode: 'create', roomName });
  };

  const confirmJoin = (): void => {
    const roomId = normalizeRoomId(joinIdInput.value);
    if (!roomId) {
      joinError.textContent = '房间号须为 3 位数字';
      joinError.classList.add('is-visible');
      return;
    }
    hideDialogs();
    options.onJoinRoom({ mode: 'room', roomId });
  };

  const startRefresh = (): void => {
    stopRefresh();
    refreshRoomList();
    refreshTimer = setInterval(refreshRoomList, LIST_REFRESH_MS);
  };

  const stopRefresh = (): void => {
    if (!refreshTimer) return;
    clearInterval(refreshTimer);
    refreshTimer = null;
  };

  backButton.addEventListener('click', options.onBack);
  refreshButton.addEventListener('click', refreshRoomList);
  createButton.addEventListener('click', openCreateDialog);
  joinButton.addEventListener('click', openJoinDialog);
  createConfirm.addEventListener('click', confirmCreate);
  joinConfirm.addEventListener('click', confirmJoin);
  createNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      confirmCreate();
    }
  });
  joinIdInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      confirmJoin();
    }
  });
  for (const button of createCloseButtons) {
    button.addEventListener('click', () => hideDialog(createDialog));
  }
  for (const button of joinCloseButtons) {
    button.addEventListener('click', () => hideDialog(joinDialog));
  }

  return {
    show() {
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
      clearStatus();
      hideDialogs();
      startRefresh();
    },
    hide() {
      root.classList.add('is-hidden');
      root.setAttribute('aria-hidden', 'true');
      hideDialogs();
      stopRefresh();
    },
    showError(message) {
      showStatus(message);
    },
    dispose() {
      stopRefresh();
      backButton.removeEventListener('click', options.onBack);
      refreshButton.removeEventListener('click', refreshRoomList);
      createButton.removeEventListener('click', openCreateDialog);
      joinButton.removeEventListener('click', openJoinDialog);
      createConfirm.removeEventListener('click', confirmCreate);
      joinConfirm.removeEventListener('click', confirmJoin);
    },
  };
}

function showDialog(dialog: HTMLElement): void {
  dialog.classList.remove('is-hidden');
  dialog.setAttribute('aria-hidden', 'false');
}

function hideDialog(dialog: HTMLElement): void {
  dialog.classList.add('is-hidden');
  dialog.setAttribute('aria-hidden', 'true');
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`联机大厅缺少元素：${selector}`);
  return element;
}
