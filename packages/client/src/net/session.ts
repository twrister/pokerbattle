import {
  DEFAULT_INPUT_DELAY,
  RECONNECT_TIMEOUT_MS,
  decodeServerMessage,
  encodeMessage,
  type JoinMode,
  type RoomListEntry,
  type ServerMessage,
} from '@pb/net';
import type { Faction, MatchResult } from '@pb/sim';
import { NetSimLoop } from './netLoop.js';

export interface VersusSession {
  loop: NetSimLoop;
  faction: Faction;
  seat: number;
  roomId: string;
  roomName: string;
  close: () => void;
}

export interface ConnectVersusOptions {
  name?: string;
  /** 加入模式；默认 quick。 */
  mode?: JoinMode;
  /** 已有房间号；mode=room 时必填。 */
  roomId?: string;
  /** 创建房间时的显示名；mode=create 时可选。 */
  roomName?: string;
  onStatus?: (text: string) => void;
  onDesync?: (tick: number, serverHash: number) => void;
  onPeerLeft?: () => void;
  onPeerDisconnected?: () => void;
  onPeerReconnected?: () => void;
  onMatchEnd?: (result: MatchResult) => void;
  /** 本端意外断线并进入自动重连时回调。 */
  onReconnecting?: (remainingMs: number) => void;
  /** 重连成功后回调。 */
  onReconnected?: () => void;
  /** 重连窗口耗尽或服务端拒绝恢复。 */
  onReconnectFailed?: (reason: string) => void;
}

/**
 * 连接同源 /ws（经 vite 代理到权威服），完成入座后返回 NetSimLoop。
 * 对局中意外断线会在重连窗口内自动恢复并补帧；主动 close 不重连。
 */
export function connectVersusSession(options: ConnectVersusOptions = {}): Promise<VersusSession> {
  const status = options.onStatus ?? (() => {});
  const mode: JoinMode = options.mode ?? 'quick';
  const joinRoomId = options.roomId ?? '';
  const joinRoomName = options.roomName ?? '';
  const playerName = options.name ?? `player-${Math.floor(Math.random() * 1000)}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    let intentionalClose = false;
    let loop: NetSimLoop | null = null;
    let faction: Faction | null = null;
    let seat = 0;
    let roomId = '';
    let roomName = '';
    let reconnectToken = '';
    let activeWs: WebSocket | null = null;
    let reconnectDeadline = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    /** welcome 建好 loop 前可能先到的下行，建好后立刻回放。 */
    const pending: ServerMessage[] = [];

    const clearReconnectTimer = (): void => {
      if (!reconnectTimer) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearReconnectTimer();
      intentionalClose = true;
      try {
        activeWs?.close();
      } catch {
        /* ignore */
      }
      reject(error);
    };

    const finish = (active: NetSimLoop, side: Faction): void => {
      if (settled) return;
      settled = true;
      status(`对局开始（房间 ${roomId}${roomName ? ` · ${roomName}` : ''}）`);
      resolve({
        loop: active,
        faction: side,
        seat,
        roomId,
        roomName,
        close: () => {
          intentionalClose = true;
          clearReconnectTimer();
          active.setInputPaused(false);
          try {
            activeWs?.close();
          } catch {
            /* ignore */
          }
        },
      });
    };

    const attachSocket = (ws: WebSocket, kind: 'join' | 'rejoin'): void => {
      activeWs = ws;

      ws.addEventListener('open', () => {
        if (kind === 'join') {
          if (mode === 'quick') {
            status('已连接，正在匹配对手…');
          } else if (mode === 'create') {
            status('已连接，正在创建房间…');
          } else {
            status(`已连接，正在加入房间 ${joinRoomId}…`);
          }
          ws.send(
            encodeMessage({
              type: 'join',
              mode,
              roomId: joinRoomId,
              name: playerName,
              ...(mode === 'create' && joinRoomName ? { roomName: joinRoomName } : {}),
            }),
          );
          return;
        }

        const lastTick = loop?.lastConfirmedTick ?? 0;
        status('正在恢复对局连接…');
        ws.send(
          encodeMessage({
            type: 'rejoin',
            roomId,
            token: reconnectToken,
            lastTick,
          }),
        );
      });

      ws.addEventListener('error', () => {
        if (kind === 'join' && !settled) {
          fail(new Error('无法连接联机服务，请确认已运行 pnpm dev:online 或 pnpm official:online'));
          return;
        }
        // 重连阶段的 error 会伴随 close，统一在 close 里重试
      });

      ws.addEventListener('close', () => {
        if (activeWs === ws) activeWs = null;
        if (intentionalClose) return;

        // 尚未开局就断开：直接失败
        if (!loop || !settled) {
          if (!settled) fail(new Error('连接已断开'));
          return;
        }

        beginReconnect();
      });

      ws.addEventListener('message', (event) => {
        const raw = String(event.data);
        const message = decodeServerMessage(raw);
        if (!message) return;

        if (message.type === 'error') {
          if (kind === 'rejoin') {
            intentionalClose = true;
            clearReconnectTimer();
            loop?.setInputPaused(false);
            options.onReconnectFailed?.(message.message);
            return;
          }
          fail(new Error(message.message));
          return;
        }

        if (message.type === 'welcome') {
          roomId = message.roomId || roomId;
          roomName = message.roomName || roomName;
          reconnectToken = message.reconnectToken || reconnectToken;
          seat = message.seat;
          faction = message.faction;

          if (message.seed === 0) {
            const label = roomName ? `${roomId} · ${roomName}` : roomId;
            status(`已入座房间 ${label}（${message.faction === 0 ? '蓝方' : '红方'}），等待对手…`);
            return;
          }

          // 重连：复用已有 NetSimLoop，只换发送通道并消化补帧
          if (loop) {
            clearReconnectTimer();
            reconnectAttempt = 0;
            loop.setSend((text) => {
              if (ws.readyState === WebSocket.OPEN) ws.send(text);
            });
            loop.setInputPaused(false);
            status(`已恢复房间 ${roomId}`);
            options.onReconnected?.();
            return;
          }

          status('对手已就绪，正在开局…');
          loop = new NetSimLoop({
            seed: message.seed,
            faction: message.faction,
            inputDelay: message.inputDelay || DEFAULT_INPUT_DELAY,
            send: (text) => {
              if (ws.readyState === WebSocket.OPEN) ws.send(text);
            },
            onDesync: options.onDesync,
            onPeerLeft: () => options.onPeerLeft?.(),
            onPeerDisconnected: () => options.onPeerDisconnected?.(),
            onPeerReconnected: () => options.onPeerReconnected?.(),
            onMatchEnd: options.onMatchEnd,
          });
          for (const queued of pending.splice(0)) {
            loop.handleServerMessage(queued);
            if (queued.type === 'start' && faction !== null) finish(loop, faction);
          }
          return;
        }

        if (!loop) {
          pending.push(message);
          return;
        }

        loop.handleServerMessage(message);
        if (message.type === 'start' && faction !== null) finish(loop, faction);
      });
    };

    /** 在重连窗口内指数退避重建 WebSocket。 */
    const beginReconnect = (): void => {
      if (intentionalClose || !loop || !reconnectToken || !roomId) return;
      loop.setInputPaused(true);
      if (!reconnectDeadline) {
        reconnectDeadline = Date.now() + RECONNECT_TIMEOUT_MS;
      }
      const remaining = reconnectDeadline - Date.now();
      if (remaining <= 0) {
        intentionalClose = true;
        clearReconnectTimer();
        loop.setInputPaused(false);
        options.onReconnectFailed?.('重连超时，对局已结束');
        return;
      }

      options.onReconnecting?.(remaining);
      status(`连接中断，正在重连…（剩余 ${Math.ceil(remaining / 1000)}s）`);

      const delay = Math.min(2000, 400 * 2 ** reconnectAttempt);
      reconnectAttempt += 1;
      clearReconnectTimer();
      reconnectTimer = setTimeout(() => {
        if (intentionalClose) return;
        if (Date.now() >= reconnectDeadline) {
          intentionalClose = true;
          loop?.setInputPaused(false);
          options.onReconnectFailed?.('重连超时，对局已结束');
          return;
        }
        attachSocket(new WebSocket(buildWsUrl()), 'rejoin');
      }, delay);
    };

    status('正在连接联机服务…');
    attachSocket(new WebSocket(buildWsUrl()), 'join');
  });
}

/**
 * 主菜单大厅 presence：常驻 WS 登记 lobby，并可复用同连接拉房间列表。
 */
export interface LobbyPresenceHandle {
  /** 复用大厅连接查询可加入房间。 */
  listRooms(): Promise<RoomListEntry[]>;
  /** 离开主菜单时关闭连接，服务端注销大厅计数。 */
  dispose(): void;
}

/**
 * 建立大厅 presence：连上后发 lobby；dispose 前保持连接。
 * 口径由应用层决定：未入联机房间即登记（可覆盖卡组/图鉴/单机等页面）。
 */
export function createLobbyPresence(): LobbyPresenceHandle {
  let disposed = false;
  let ws: WebSocket | null = null;
  let openWaiters: Array<{ resolve: (socket: WebSocket) => void; reject: (error: Error) => void }> =
    [];
  let listInflight: Promise<RoomListEntry[]> | null = null;
  let listWaiters: Array<{
    resolve: (rooms: RoomListEntry[]) => void;
    reject: (error: Error) => void;
  }> = [];

  const rejectOpenWaiters = (error: Error): void => {
    const waiters = openWaiters;
    openWaiters = [];
    for (const waiter of waiters) waiter.reject(error);
  };

  const rejectListWaiters = (error: Error): void => {
    const waiters = listWaiters;
    listWaiters = [];
    listInflight = null;
    for (const waiter of waiters) waiter.reject(error);
  };

  const resolveOpenWaiters = (socket: WebSocket): void => {
    const waiters = openWaiters;
    openWaiters = [];
    for (const waiter of waiters) waiter.resolve(socket);
  };

  /** 等待 WS 打开；已打开则立即返回。 */
  const ensureOpen = (): Promise<WebSocket> => {
    if (disposed) return Promise.reject(new Error('大厅连接已关闭'));
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);
    return new Promise((resolve, reject) => {
      openWaiters.push({ resolve, reject });
    });
  };

  const socket = new WebSocket(buildWsUrl());
  ws = socket;

  socket.addEventListener('open', () => {
    if (disposed || ws !== socket) return;
    socket.send(encodeMessage({ type: 'lobby' }));
    resolveOpenWaiters(socket);
  });
  socket.addEventListener('error', () => {
    if (disposed || ws !== socket) return;
    const error = new Error('无法连接联机服务');
    rejectOpenWaiters(error);
    rejectListWaiters(error);
  });
  socket.addEventListener('close', () => {
    if (disposed || ws !== socket) return;
    const error = new Error('连接已断开');
    rejectOpenWaiters(error);
    rejectListWaiters(error);
  });
  socket.addEventListener('message', (event) => {
    if (disposed || ws !== socket) return;
    const message = decodeServerMessage(String(event.data));
    if (!message || message.type !== 'roomList') return;
    const rooms = message.rooms ?? [];
    const waiters = listWaiters;
    listWaiters = [];
    listInflight = null;
    for (const waiter of waiters) waiter.resolve(rooms);
  });

  return {
    listRooms() {
      if (listInflight) return listInflight;
      listInflight = new Promise<RoomListEntry[]>((resolve, reject) => {
        listWaiters.push({ resolve, reject });
        void ensureOpen()
          .then((active) => {
            if (disposed || listWaiters.length === 0) return;
            active.send(encodeMessage({ type: 'listRooms' }));
          })
          .catch((error: unknown) => {
            rejectListWaiters(error instanceof Error ? error : new Error(String(error)));
          });
      });
      return listInflight;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rejectOpenWaiters(new Error('大厅连接已关闭'));
      rejectListWaiters(new Error('大厅连接已关闭'));
      const active = ws;
      ws = null;
      try {
        active?.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/** 开发服与正式预览均走同源 /ws（由 Vite 代理到权威服）。 */
function buildWsUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
