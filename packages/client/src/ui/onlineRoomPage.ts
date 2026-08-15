import type { RoomStateMessage } from '@pb/net';

const MAX_PLAYERS = 2;

export interface OnlineRoomPageOptions {
  onLeave: () => void;
  onStartMatch: () => void;
  /** 非房主切换准备。 */
  onSetReady: (ready: boolean) => void;
}

export interface OnlineRoomPageHandle {
  show(): void;
  hide(): void;
  /** 写入房号与房间名。 */
  setRoomInfo(roomId: string, roomName: string): void;
  /** 用服务端快照刷新成员位与开始按钮。 */
  applyRoomState(state: RoomStateMessage, localSeat: number): void;
  /** 入房中或开局失败等提示。 */
  showStatus(message: string): void;
  dispose(): void;
}

/** 房间等待页：成员位、默认准备、房主开局。 */
export function createOnlineRoomPage(options: OnlineRoomPageOptions): OnlineRoomPageHandle {
  const root = required<HTMLElement>('#online-room');
  const leaveButton = required<HTMLButtonElement>('#btn-online-room-leave', root);
  const startButton = required<HTMLButtonElement>('#btn-online-room-start', root);
  const readyButton = required<HTMLButtonElement>('#btn-online-room-ready', root);
  const roomIdLabel = required<HTMLElement>('#online-room-id', root);
  const roomNameLabel = required<HTMLElement>('#online-room-name', root);
  const members = required<HTMLElement>('#online-room-members', root);
  const status = required<HTMLElement>('#online-room-status', root);

  let localSeat = 0;
  let canStart = false;
  let selfReady = true;

  const renderMembers = (state: RoomStateMessage | null): void => {
    members.replaceChildren();
    for (let seat = 0; seat < MAX_PLAYERS; seat += 1) {
      const member = state?.members.find((entry) => entry.seat === seat) ?? null;
      const card = document.createElement('article');
      card.className = 'online-room-member';
      if (member?.isHost) card.classList.add('is-host');
      if (seat === localSeat) card.classList.add('is-self');

      const name = document.createElement('div');
      name.className = 'online-room-member-name';
      name.textContent = member?.name ?? '等待加入…';

      const meta = document.createElement('div');
      meta.className = 'online-room-member-meta';
      if (!member) {
        meta.textContent = '空位';
      } else {
        const tags: string[] = [];
        if (member.isHost) tags.push('房主');
        if (seat === localSeat) tags.push('我');
        tags.push(member.ready ? '已准备' : '未准备');
        meta.textContent = tags.join(' · ');
      }

      card.append(name, meta);
      members.append(card);
    }
  };

  const syncActionButtons = (state: RoomStateMessage | null): void => {
    const self = state?.members.find((entry) => entry.seat === localSeat);
    const allReady =
      (state?.members.length ?? 0) >= MAX_PLAYERS &&
      (state?.members.every((entry) => entry.ready) ?? false);
    canStart = Boolean(self?.isHost && state?.phase === 'waiting' && allReady);
    selfReady = self?.ready ?? true;
    startButton.disabled = !canStart;
    startButton.classList.toggle('is-hidden', !self?.isHost);
    readyButton.classList.toggle('is-hidden', Boolean(self?.isHost) || !self);
    readyButton.classList.toggle('is-ready', selfReady);
    readyButton.textContent = selfReady ? '取消准备' : '准备';
  };

  const toggleReady = (): void => {
    if (readyButton.classList.contains('is-hidden')) return;
    options.onSetReady(!selfReady);
  };

  leaveButton.addEventListener('click', options.onLeave);
  startButton.addEventListener('click', () => {
    if (!canStart) return;
    options.onStartMatch();
  });
  readyButton.addEventListener('click', toggleReady);

  renderMembers(null);
  syncActionButtons(null);

  return {
    show() {
      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
    },
    hide() {
      root.classList.add('is-hidden');
      root.setAttribute('aria-hidden', 'true');
    },
    setRoomInfo(roomId, roomName) {
      roomIdLabel.textContent = roomId;
      roomNameLabel.textContent = roomName;
    },
    applyRoomState(state, seat) {
      localSeat = seat;
      roomIdLabel.textContent = state.roomId;
      roomNameLabel.textContent = state.roomName;
      renderMembers(state);
      syncActionButtons(state);
      const waiting = state.members.length < MAX_PLAYERS;
      const allReady = state.members.length >= MAX_PLAYERS && state.members.every((entry) => entry.ready);
      status.textContent = waiting
        ? '等待其他玩家加入…'
        : allReady
          ? '双方已准备，房主可以开始游戏'
          : '等待其他玩家准备…';
      status.classList.add('is-visible');
    },
    showStatus(message) {
      status.textContent = message;
      status.classList.toggle('is-visible', Boolean(message));
    },
    dispose() {
      leaveButton.removeEventListener('click', options.onLeave);
    },
  };
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`房间页缺少元素：${selector}`);
  return element;
}
