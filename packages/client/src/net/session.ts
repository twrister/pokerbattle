import {
  DEFAULT_INPUT_DELAY,
  RECONNECT_TIMEOUT_MS,
  decodeServerMessage,
  encodeMessage,
  type JoinMode,
  type LobbyActivity,
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
  /** 对手显示名；welcome 未带时为空串。 */
  opponentName: string;
  close: () => void;
}

export interface ConnectVersusOptions {
  name?: string;
  /** 设备档案 ID，供服务端按设备记账；缺省则服务端跳过该席。 */
  playerId?: string;
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

/** 联机连接句柄：done 等开局，close 可在匹配期立刻断连离房。 */
export interface VersusConnecting {
  done: Promise<VersusSession>;
  /** 匹配未开局时关闭 WS 离开房间；开局后等同 session.close。 */
  close: () => void;
}

/**
 * 连接同源 /ws（经 vite 代理到权威服），完成入座后返回 NetSimLoop。
 * 对局中意外断线会在重连窗口内自动恢复并补帧；主动 close 不重连。
 */
export function connectVersusSession(options: ConnectVersusOptions = {}): VersusConnecting {
  const status = options.onStatus ?? (() => {});
  const mode: JoinMode = options.mode ?? 'quick';
  const joinRoomId = options.roomId ?? '';
  const joinRoomName = options.roomName ?? '';
  const playerName = options.name ?? `player-${Math.floor(Math.random() * 1000)}`;
  const playerId = options.playerId?.trim() ?? '';

  /** 开局后指向会话 close；匹配期由外层 close 直接断连。 */
  let sessionClose: (() => void) | null = null;
  let rejectPending: ((error: Error) => void) | null = null;
  let settled = false;
  let intentionalClose = false;
  let activeWs: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const clearReconnectTimer = (): void => {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  /** 匹配中或对局中主动离开：关 WS，服务端会释放房间席位。 */
  const close = (): void => {
    intentionalClose = true;
    clearReconnectTimer();
    if (!settled) {
      settled = true;
      try {
        activeWs?.close();
      } catch {
        /* ignore */
      }
      rejectPending?.(new Error('已取消匹配'));
      rejectPending = null;
      return;
    }
    sessionClose?.();
  };

  const done = new Promise<VersusSession>((resolve, reject) => {
    rejectPending = reject;
    let loop: NetSimLoop | null = null;
    let faction: Faction | null = null;
    let seat = 0;
    let roomId = '';
    let roomName = '';
    let opponentName = '';
    let reconnectToken = '';
    let reconnectDeadline = 0;
    let reconnectAttempt = 0;
    /** welcome 建好 loop 前可能先到的下行，建好后立刻回放。 */
    const pending: ServerMessage[] = [];

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearReconnectTimer();
      intentionalClose = true;
      rejectPending = null;
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
      rejectPending = null;
      status(`对局开始（房间 ${roomId}${roomName ? ` · ${roomName}` : ''}）`);
      sessionClose = () => {
        intentionalClose = true;
        clearReconnectTimer();
        active.setInputPaused(false);
        try {
          activeWs?.close();
        } catch {
          /* ignore */
        }
      };
      resolve({
        loop: active,
        faction: side,
        seat,
        roomId,
        roomName,
        opponentName,
        close: sessionClose,
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
              ...(playerId ? { playerId } : {}),
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
          if (typeof message.opponentName === 'string') {
            opponentName = message.opponentName;
          }

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

  return { done, close };
}

/**
 * 主菜单大厅 presence：常驻 WS 登记 lobby，并可复用同连接拉房间列表。
 */
export interface LobbyPresenceHandle {
  /** 复用大厅连接查询可加入房间。 */
  listRooms(): Promise<RoomListEntry[]>;
  /** 切到单机/回大厅时刷新 activity，不断开连接。 */
  setActivity(activity: LobbyActivity): void;
  /** 离开主菜单时关闭连接，服务端注销大厅计数。 */
  dispose(): void;
}

/** 大厅 WS 意外断开后的重连间隔；单机中途掉线也要重新登记，否则运维站会看成离线。 */
const LOBBY_RECONNECT_MS = 800;
/** 单机中周期性重报，避免首次 setActivity 赶上 CONNECTING 或中途丢包后运维站一直停在大厅。 */
const LOBBY_SOLO_HEARTBEAT_MS = 4000;

/**
 * 建立大厅 presence：连上后发 lobby；dispose 前保持连接。
 * 口径由应用层决定：未入联机房间即登记（可覆盖卡组/图鉴/单机等页面）。
 */
export function createLobbyPresence(
  options: { name?: string; playerId?: string; activity?: LobbyActivity } = {},
): LobbyPresenceHandle {
  let disposed = false;
  let activity: LobbyActivity = options.activity === 'solo' ? 'solo' : 'lobby';
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
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

  /** 把当前名字、设备 ID 和页面活动登记到服务端。 */
  const sendLobby = (socket: WebSocket): void => {
    const playerName = options.name?.trim() ?? '';
    const playerId = options.playerId?.trim() ?? '';
    socket.send(
      encodeMessage({
        type: 'lobby',
        ...(playerName ? { name: playerName } : {}),
        ...(playerId ? { playerId } : {}),
        activity,
      }),
    );
  };

  const clearReconnectTimer = (): void => {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const clearHeartbeat = (): void => {
    if (!heartbeatTimer) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  };

  /** 仅单机页心跳重报；大厅不刷，避免无谓流量。 */
  const syncHeartbeat = (): void => {
    if (activity !== 'solo') {
      clearHeartbeat();
      return;
    }
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      if (disposed || activity !== 'solo' || !ws || ws.readyState !== WebSocket.OPEN) return;
      sendLobby(ws);
    }, LOBBY_SOLO_HEARTBEAT_MS);
  };

  /** 非主动断开后稍后重连，重连成功会带上当前 activity。 */
  const scheduleReconnect = (): void => {
    if (disposed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (disposed) return;
      attachSocket();
    }, LOBBY_RECONNECT_MS);
  };

  const attachSocket = (): void => {
    const socket = new WebSocket(buildWsUrl());
    ws = socket;
    socket.addEventListener('open', () => {
      if (disposed || ws !== socket) return;
      sendLobby(socket);
      syncHeartbeat();
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
      scheduleReconnect();
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
  };

  attachSocket();

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
    setActivity(next) {
      const normalized: LobbyActivity = next === 'solo' ? 'solo' : 'lobby';
      if (activity === normalized) {
        syncHeartbeat();
        return;
      }
      activity = normalized;
      syncHeartbeat();
      if (disposed) return;
      if (ws && ws.readyState === WebSocket.OPEN) {
        sendLobby(ws);
        return;
      }
      if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
        scheduleReconnect();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearReconnectTimer();
      clearHeartbeat();
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

/**
 * 同源 /ws：开发服由 Vite 代理；生产环境页面挂在 /poker-battle/ 时须带上 Vite base。
 * 服务端路由仍在 /ws，由 nginx strip-prefix 去掉对外前缀后再转发。
 */
function buildWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const base = String(import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return `${proto}://${location.host}${base}/ws`;
}
