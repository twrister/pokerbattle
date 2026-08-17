import type { RoomStateMessage } from '@pb/net';
import { slotCount, slotFaction, type MatchMode } from '@pb/sim';

export interface OnlineRoomPageOptions {
  onLeave: () => void;
  onStartMatch: () => void;
  /** 非房主切换准备。 */
  onSetReady: (ready: boolean) => void;
  /** 房主切换对局模式。 */
  onSetMatchMode: (mode: MatchMode) => void;
  /** 点空席换座。 */
  onPickSeat: (seat: number) => void;
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

/** 房间等待页：两队席位、换座、房主切模式与开局。 */
export function createOnlineRoomPage(options: OnlineRoomPageOptions): OnlineRoomPageHandle {
  const root = required<HTMLElement>('#online-room');
  const leaveButton = required<HTMLButtonElement>('#btn-online-room-leave', root);
  const startButton = required<HTMLButtonElement>('#btn-online-room-start', root);
  const readyButton = required<HTMLButtonElement>('#btn-online-room-ready', root);
  const roomIdLabel = required<HTMLElement>('#online-room-id', root);
  const roomNameLabel = required<HTMLElement>('#online-room-name', root);
  const members = required<HTMLElement>('#online-room-members', root);
  const status = required<HTMLElement>('#online-room-status', root);
  const modeBar = required<HTMLElement>('#online-room-mode', root);
  const mode1v1 = required<HTMLButtonElement>('#btn-online-room-mode-1v1', root);
  const mode2v2 = required<HTMLButtonElement>('#btn-online-room-mode-2v2', root);

  let localSeat = 0;
  let canStart = false;
  let selfReady = true;
  let latest: RoomStateMessage | null = null;

  const renderMembers = (state: RoomStateMessage | null): void => {
    members.replaceChildren();
    const mode: MatchMode = state?.matchMode === '2v2' ? '2v2' : '1v1';
    const max = state?.maxPlayers ?? slotCount(mode);
    const teams = document.createElement('div');
    teams.className = 'online-room-teams';

    for (const faction of [0, 1] as const) {
      const column = document.createElement('section');
      column.className = `online-room-team is-${faction === 0 ? 'blue' : 'red'}`;
      const title = document.createElement('h2');
      title.className = 'online-room-team-title';
      title.textContent = faction === 0 ? '蓝队' : '红队';
      column.append(title);

      for (let seat = 0; seat < max; seat += 1) {
        if (slotFaction(seat, mode) !== faction) continue;
        const member = state?.members.find((entry) => entry.seat === seat) ?? null;
        const card = document.createElement('article');
        card.className = 'online-room-member';
        card.dataset.seat = String(seat);
        if (member?.isHost) card.classList.add('is-host');
        if (seat === localSeat) card.classList.add('is-self');
        if (!member) {
          card.classList.add('is-empty');
          card.dataset.state = 'empty';
        } else {
          card.classList.toggle('is-ready', member.ready);
          card.classList.toggle('is-unready', !member.ready);
          card.dataset.state = member.ready ? 'ready' : 'unready';
        }

        const name = document.createElement('div');
        name.className = 'online-room-member-name';
        name.textContent = member?.name ?? '空位 · 点击入座';

        const meta = document.createElement('div');
        meta.className = 'online-room-member-meta';
        if (!member) {
          meta.append(createRoomTag(`席位 ${seat + 1}`));
          card.setAttribute('role', 'button');
          card.setAttribute('tabindex', '0');
          card.setAttribute('aria-label', `入座席位 ${seat + 1}`);
          card.addEventListener('click', () => options.onPickSeat(seat));
        } else {
          if (member.isHost) meta.append(createRoomTag('房主', 'is-host'));
          if (seat === localSeat) meta.append(createRoomTag('我', 'is-self'));
          meta.append(createRoomTag(member.ready ? '已准备' : '未准备', member.ready ? 'is-ready' : 'is-unready'));
        }

        card.append(name, meta);
        column.append(card);
      }
      teams.append(column);
    }
    members.append(teams);
  };

  const syncModeBar = (state: RoomStateMessage | null): void => {
    const self = state?.members.find((entry) => entry.seat === localSeat);
    const mode: MatchMode = state?.matchMode === '2v2' ? '2v2' : '1v1';
    modeBar.classList.toggle('is-hidden', !self?.isHost || state?.phase !== 'waiting');
    mode1v1.classList.toggle('is-active', mode === '1v1');
    mode2v2.classList.toggle('is-active', mode === '2v2');
    mode1v1.setAttribute('aria-pressed', mode === '1v1' ? 'true' : 'false');
    mode2v2.setAttribute('aria-pressed', mode === '2v2' ? 'true' : 'false');
  };

  const syncActionButtons = (state: RoomStateMessage | null): void => {
    const self = state?.members.find((entry) => entry.seat === localSeat);
    const max = state?.maxPlayers ?? 2;
    const allReady = (state?.members.length ?? 0) >= max && (state?.members.every((entry) => entry.ready) ?? false);
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
  mode1v1.addEventListener('click', () => options.onSetMatchMode('1v1'));
  mode2v2.addEventListener('click', () => options.onSetMatchMode('2v2'));

  renderMembers(null);
  syncActionButtons(null);
  syncModeBar(null);

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
      latest = state;
      localSeat = seat;
      roomIdLabel.textContent = state.roomId;
      roomNameLabel.textContent = state.roomName;
      renderMembers(state);
      syncActionButtons(state);
      syncModeBar(state);
      const max = state.maxPlayers ?? 2;
      const waiting = state.members.length < max;
      const allReady = state.members.length >= max && state.members.every((entry) => entry.ready);
      const modeLabel = state.matchMode === '2v2' ? '2v2' : '1v1';
      status.textContent = waiting
        ? `当前 ${modeLabel}，等待其他玩家加入…`
        : allReady
          ? `全员已准备，房主可以开始 ${modeLabel}`
          : '等待其他玩家准备…';
      status.classList.add('is-visible');
    },
    showStatus(message) {
      status.textContent = message;
      status.classList.toggle('is-visible', Boolean(message));
    },
    dispose() {
      leaveButton.removeEventListener('click', options.onLeave);
      void latest;
    },
  };
}

/** 席位状态小标签，统一房主 / 自己 / 准备态的视觉层级。 */
function createRoomTag(text: string, extraClass = ''): HTMLSpanElement {
  const tag = document.createElement('span');
  tag.className = extraClass ? `online-room-tag ${extraClass}` : 'online-room-tag';
  tag.textContent = text;
  return tag;
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`房间页缺少元素：${selector}`);
  return element;
}
