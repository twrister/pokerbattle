import {
  DEFAULT_INPUT_DELAY,
  RECONNECT_TIMEOUT_MS,
  decodeServerMessage,
  encodeMessage,
  type LeaderboardMessage,
  type LobbyActivity,
  type RoomListEntry,
  type RoomStateMessage,
  type ServerMessage,
} from '@pb/net';
import type { Faction, MatchMode, MatchResult } from '@pb/sim';
import { NetSimLoop } from './netLoop.js';

/** 创建或加入已有房间；不再提供快速匹配。 */
export interface RoomJoinRequest {
  mode: 'create' | 'room';
  roomId?: string;
  roomName?: string;
  matchMode?: MatchMode;
}

/** 已入座的长连接房间会话；对局开始后仍复用同一条 WS。 */
export interface RoomSession {
  roomId: string;
  roomName: string;
  seat: number;
  faction: Faction;
  isHost: boolean;
  opponentName: string;
  matchMode: MatchMode;
  /** 房主请求开局；服务端校验未通过时走 onStatus。 */
  sendStartMatch(): void;
  /** 非房主切换准备状态。 */
  sendSetReady(ready: boolean): void;
  /** 房主切换 1v1 / 2v2。 */
  sendSetRoomOptions(matchMode: MatchMode): void;
  /** 点空席换座。 */
  sendPickSeat(seat: number): void;
  close: () => void;
}

export interface ConnectRoomOptions {
  name?: string;
  /** 设备档案 ID，供服务端按设备记账；缺省则服务端跳过该席。 */
  playerId?: string;
  mode?: 'create' | 'room';
  roomId?: string;
  roomName?: string;
  matchMode?: MatchMode;
  onStatus?: (text: string) => void;
  onRoomState?: (state: RoomStateMessage) => void;
  onMatchStart?: (loop: NetSimLoop, faction: Faction, opponentName: string) => void;
  onMatchEnd?: (result: MatchResult) => void;
  /** 观战人数变化（对局玩家 HUD 用）。 */
  onSpectatorCount?: (count: number) => void;
  onDesync?: (tick: number, serverHash: number) => void;
  onPeerLeft?: () => void;
  onPeerDisconnected?: () => void;
  onPeerReconnected?: () => void;
  /** 等待期意外断线（非对局重连窗口）。 */
  onDisconnected?: (reason: string) => void;
  /** 本端意外断线并进入自动重连时回调。 */
  onReconnecting?: (remainingMs: number) => void;
  /** 重连成功后回调。 */
  onReconnected?: () => void;
  /** 重连窗口耗尽或服务端拒绝恢复。 */
  onReconnectFailed?: (reason: string) => void;
}

/** 入房连接句柄：done 等 welcome，close 可在入房前立刻断连。 */
export interface RoomConnecting {
  done: Promise<RoomSession>;
  close: () => void;
}

/**
 * 连接同源 /ws，入座后即返回房间会话；开局与回房都不断开连接。
 * 仅对局中意外断线会在重连窗口内自动恢复；主动 close 不重连。
 */
export function connectRoomSession(options: ConnectRoomOptions = {}): RoomConnecting {
  const status = options.onStatus ?? (() => {});
  const mode = options.mode === 'room' ? 'room' : 'create';
  const joinRoomId = options.roomId ?? '';
  const joinRoomName = options.roomName ?? '';
  const playerName = options.name ?? `player-${Math.floor(Math.random() * 1000)}`;
  const playerId = options.playerId?.trim() ?? '';

  let sessionClose: (() => void) | null = null;
  let rejectPending: ((error: Error) => void) | null = null;
  let settled = false;
  let intentionalClose = false;
  let inMatch = false;
  let activeWs: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const clearReconnectTimer = (): void => {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  /** 主动离开房间：关 WS，服务端会释放席位。 */
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
      rejectPending?.(new Error('已取消入房'));
      rejectPending = null;
      return;
    }
    sessionClose?.();
  };

  const done = new Promise<RoomSession>((resolve, reject) => {
    rejectPending = reject;
    let loop: NetSimLoop | null = null;
    let faction: Faction | null = null;
    let seat = 0;
    let hostSeat = 0;
    let roomId = '';
    let roomName = '';
    let opponentName = '';
    let matchMode: MatchMode = options.matchMode === '2v2' ? '2v2' : '1v1';
    let reconnectToken = '';
    let reconnectDeadline = 0;
    let reconnectAttempt = 0;
    /** 最近一次房间快照；换座 welcome 更新本机席位后再重放，避免开始按钮按旧席隐藏。 */
    let lastRoomState: RoomStateMessage | null = null;
    /** welcome 建好 loop 前可能先到的下行，建好后立刻回放。 */
    const pending: ServerMessage[] = [];

    /** 本机已在快照里时才刷新房间页，避免换座瞬间用旧 seat 把房主按钮藏掉。 */
    const emitRoomStateIfSeated = (state: RoomStateMessage): void => {
      if (!state.members.some((member) => member.seat === seat)) return;
      options.onRoomState?.(state);
    };

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

    const shutdownSocket = (): void => {
      intentionalClose = true;
      clearReconnectTimer();
      loop?.setInputPaused(false);
      try {
        activeWs?.close();
      } catch {
        /* ignore */
      }
    };

    const session: RoomSession = {
      get roomId() {
        return roomId;
      },
      get roomName() {
        return roomName;
      },
      get seat() {
        return seat;
      },
      get faction() {
        return faction ?? (0 as Faction);
      },
      get isHost() {
        return hostSeat === seat;
      },
      get opponentName() {
        return opponentName;
      },
      sendStartMatch() {
        if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;
        activeWs.send(encodeMessage({ type: 'startMatch' }));
      },
      sendSetReady(ready) {
        if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;
        activeWs.send(encodeMessage({ type: 'setReady', ready }));
      },
      get matchMode() {
        return matchMode;
      },
      sendSetRoomOptions(nextMode) {
        if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;
        activeWs.send(encodeMessage({ type: 'setRoomOptions', matchMode: nextMode }));
      },
      sendPickSeat(nextSeat) {
        if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;
        activeWs.send(encodeMessage({ type: 'pickSeat', seat: nextSeat }));
      },
      close: shutdownSocket,
    };

    sessionClose = shutdownSocket;

    /** 入座成功即交给房间页，不等开局。 */
    const finishJoin = (): void => {
      if (settled) return;
      settled = true;
      rejectPending = null;
      const label = roomName ? `${roomId} · ${roomName}` : roomId;
      status(`已入座房间 ${label}`);
      resolve(session);
    };

    /** 收到带种子的 welcome 后建 loop；start 再通知外层切到对局。 */
    const ensureMatchLoop = (seed: number, side: Faction, delay: number): NetSimLoop => {
      loop = new NetSimLoop({
        seed,
        faction: side,
        seat,
        matchMode,
        inputDelay: delay || DEFAULT_INPUT_DELAY,
        send: (text) => {
          if (activeWs && activeWs.readyState === WebSocket.OPEN) activeWs.send(text);
        },
        onDesync: options.onDesync,
        onPeerLeft: () => options.onPeerLeft?.(),
        onPeerDisconnected: () => options.onPeerDisconnected?.(),
        onPeerReconnected: () => options.onPeerReconnected?.(),
        onMatchEnd: (result) => {
          inMatch = false;
          options.onMatchEnd?.(result);
        },
      });
      for (const queued of pending.splice(0)) {
        applyServerMessage(queued);
      }
      return loop;
    };

    const applyServerMessage = (message: ServerMessage): void => {
      if (message.type === 'roomState') {
        hostSeat = message.hostSeat;
        roomId = message.roomId || roomId;
        roomName = message.roomName || roomName;
        if (message.matchMode === '2v2' || message.matchMode === '1v1') {
          matchMode = message.matchMode;
        }
        const peer = message.members.find((member) => member.seat !== seat);
        opponentName = peer?.name ?? '';
        lastRoomState = message;
        emitRoomStateIfSeated(message);
        return;
      }

      if (message.type === 'spectatorCount') {
        options.onSpectatorCount?.(message.count);
        return;
      }

      if (message.type === 'start' && loop && faction !== null) {
        inMatch = true;
        reconnectDeadline = 0;
        reconnectAttempt = 0;
        status(`对局开始（房间 ${roomId}${roomName ? ` · ${roomName}` : ''}）`);
        options.onMatchStart?.(loop, faction, opponentName);
      }

      loop?.handleServerMessage(message);
    };

    const attachSocket = (ws: WebSocket, kind: 'join' | 'rejoin'): void => {
      activeWs = ws;

      ws.addEventListener('open', () => {
        if (kind === 'join') {
          if (mode === 'create') {
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
              ...(mode === 'create' ? { matchMode: options.matchMode === '2v2' ? '2v2' : '1v1' } : {}),
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

        // 尚未入座或已不在对局：直接失败 / 通知房间页
        if (!settled) {
          fail(new Error('连接已断开'));
          return;
        }
        if (!inMatch || !loop) {
          options.onDisconnected?.('连接已断开');
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
          if (!settled) {
            fail(new Error(message.message));
            return;
          }
          status(message.message);
          return;
        }

        if (message.type === 'welcome') {
          roomId = message.roomId || roomId;
          roomName = message.roomName || roomName;
          reconnectToken = message.reconnectToken || reconnectToken;
          seat = message.seat;
          faction = message.faction;
          if (message.matchMode === '2v2' || message.matchMode === '1v1') {
            matchMode = message.matchMode;
          }
          if (typeof message.opponentName === 'string') {
            opponentName = message.opponentName;
          }
          const hostMember = message.members?.find((member) => member.isHost);
          if (hostMember) hostSeat = hostMember.seat;
          finishJoin();

          if (message.seed === 0) {
            // 等待期换座只更新本机席位，不会再走 onRoomState；用新座位重放快照才能认出房主。
            if (lastRoomState) emitRoomStateIfSeated(lastRoomState);
            return;
          }

          // 同局重连才复用 loop；新开局 seed 变了必须重建，否则上一局 result/淘汰态会挡住出牌。
          if (loop && inMatch && loop.match.world.seed === message.seed) {
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

          status('正在开局…');
          ensureMatchLoop(message.seed, message.faction, message.inputDelay);
          return;
        }

        if (!loop && (message.type === 'frame' || message.type === 'start' || message.type === 'matchEnd')) {
          pending.push(message);
          return;
        }

        applyServerMessage(message);
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

export interface SpectateSession {
  roomId: string;
  roomName: string;
  blueName: string;
  redName: string;
  close: () => void;
}

export interface ConnectSpectateOptions {
  roomId: string;
  name?: string;
  playerId?: string;
  onStatus?: (text: string) => void;
  onReady?: (loop: NetSimLoop, names: { blueName: string; redName: string }) => void;
  onSpectatorCount?: (count: number) => void;
  onMatchEnd?: (result: MatchResult) => void;
  onClosed?: (reason: string) => void;
}

/** 观战连接句柄：done 等 spectateWelcome，close 立刻断连。 */
export interface SpectateConnecting {
  done: Promise<SpectateSession>;
  close: () => void;
}

/**
 * 连接同源 /ws 观战已开局房间；不做断线重连，断开即回大厅。
 */
export function connectSpectateSession(options: ConnectSpectateOptions): SpectateConnecting {
  const status = options.onStatus ?? (() => {});
  const playerName = options.name ?? '观众';
  const playerId = options.playerId?.trim() ?? '';
  const joinRoomId = options.roomId;

  let sessionClose: (() => void) | null = null;
  let rejectPending: ((error: Error) => void) | null = null;
  let settled = false;
  let intentionalClose = false;
  let activeWs: WebSocket | null = null;

  const close = (): void => {
    intentionalClose = true;
    if (!settled) {
      settled = true;
      try {
        activeWs?.close();
      } catch {
        /* ignore */
      }
      rejectPending?.(new Error('已取消观战'));
      rejectPending = null;
      return;
    }
    sessionClose?.();
  };

  const done = new Promise<SpectateSession>((resolve, reject) => {
    rejectPending = reject;
    let loop: NetSimLoop | null = null;
    let roomId = joinRoomId;
    let roomName = '';
    let blueName = '';
    let redName = '';
    const pending: ServerMessage[] = [];

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      intentionalClose = true;
      rejectPending = null;
      try {
        activeWs?.close();
      } catch {
        /* ignore */
      }
      reject(error);
    };

    const shutdownSocket = (): void => {
      intentionalClose = true;
      try {
        activeWs?.close();
      } catch {
        /* ignore */
      }
    };

    const session: SpectateSession = {
      get roomId() {
        return roomId;
      },
      get roomName() {
        return roomName;
      },
      get blueName() {
        return blueName;
      },
      get redName() {
        return redName;
      },
      close: shutdownSocket,
    };
    sessionClose = shutdownSocket;

    const applyServerMessage = (message: ServerMessage): void => {
      if (message.type === 'spectatorCount') {
        options.onSpectatorCount?.(message.count);
        return;
      }
      if (message.type === 'start' && loop) {
        options.onReady?.(loop, { blueName, redName });
      }
      loop?.handleServerMessage(message);
    };

    const ws = new WebSocket(buildWsUrl());
    activeWs = ws;

    ws.addEventListener('open', () => {
      status(`已连接，正在观战房间 ${joinRoomId}…`);
      ws.send(
        encodeMessage({
          type: 'spectate',
          roomId: joinRoomId,
          name: playerName,
          ...(playerId ? { playerId } : {}),
        }),
      );
    });

    ws.addEventListener('error', () => {
      if (!settled) {
        fail(new Error('无法连接联机服务，请确认已运行 pnpm dev:online 或 pnpm official:online'));
      }
    });

    ws.addEventListener('close', () => {
      if (activeWs === ws) activeWs = null;
      if (intentionalClose) return;
      if (!settled) {
        fail(new Error('连接已断开'));
        return;
      }
      options.onClosed?.('观战连接已断开');
    });

    ws.addEventListener('message', (event) => {
      const message = decodeServerMessage(String(event.data));
      if (!message) return;

      if (message.type === 'error') {
        if (!settled) {
          fail(new Error(message.message));
          return;
        }
        status(message.message);
        return;
      }

      if (message.type === 'spectateWelcome') {
        roomId = message.roomId || roomId;
        roomName = message.roomName || roomName;
        blueName = message.blueName;
        redName = message.redName;
        options.onSpectatorCount?.(message.spectatorCount);
        loop = new NetSimLoop({
          seed: message.seed,
          faction: 0 as Faction,
          seat: 0,
          matchMode: message.matchMode === '2v2' ? '2v2' : '1v1',
          inputDelay: DEFAULT_INPUT_DELAY,
          spectator: true,
          maxStepsPerAdvance: 600,
          send: (text) => {
            if (activeWs && activeWs.readyState === WebSocket.OPEN) activeWs.send(text);
          },
          onMatchEnd: (result) => options.onMatchEnd?.(result),
        });
        if (!settled) {
          settled = true;
          rejectPending = null;
          status(`正在观战房间 ${roomId}${roomName ? ` · ${roomName}` : ''}`);
          resolve(session);
        }
        options.onReady?.(loop, { blueName, redName });
        for (const queued of pending.splice(0)) {
          applyServerMessage(queued);
        }
        return;
      }

      if (!loop && (message.type === 'frame' || message.type === 'frameBatch' || message.type === 'start' || message.type === 'matchEnd')) {
        pending.push(message);
        return;
      }

      applyServerMessage(message);
    });
  });

  return { done, close };
}

/**
 * 主菜单大厅 presence：常驻 WS 登记 lobby，并可复用同连接拉房间列表。
 */
export interface LobbyPresenceHandle {
  /** 复用大厅连接查询可加入房间。 */
  listRooms(): Promise<RoomListEntry[]>;
  /** 复用大厅连接查询积分排行榜。 */
  listLeaderboard(): Promise<LeaderboardMessage>;
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
  let boardInflight: Promise<LeaderboardMessage> | null = null;
  let boardWaiters: Array<{
    resolve: (board: LeaderboardMessage) => void;
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

  const rejectBoardWaiters = (error: Error): void => {
    const waiters = boardWaiters;
    boardWaiters = [];
    boardInflight = null;
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
      rejectBoardWaiters(error);
    });
    socket.addEventListener('close', () => {
      if (disposed || ws !== socket) return;
      const error = new Error('连接已断开');
      rejectOpenWaiters(error);
      rejectListWaiters(error);
      rejectBoardWaiters(error);
      scheduleReconnect();
    });
    socket.addEventListener('message', (event) => {
      if (disposed || ws !== socket) return;
      const message = decodeServerMessage(String(event.data));
      if (!message) return;
      if (message.type === 'roomList') {
        const rooms = message.rooms ?? [];
        const waiters = listWaiters;
        listWaiters = [];
        listInflight = null;
        for (const waiter of waiters) waiter.resolve(rooms);
        return;
      }
      if (message.type === 'leaderboard') {
        const waiters = boardWaiters;
        boardWaiters = [];
        boardInflight = null;
        for (const waiter of waiters) waiter.resolve(message);
      }
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
    listLeaderboard() {
      if (boardInflight) return boardInflight;
      boardInflight = new Promise<LeaderboardMessage>((resolve, reject) => {
        boardWaiters.push({ resolve, reject });
        void ensureOpen()
          .then((active) => {
            if (disposed || boardWaiters.length === 0) return;
            const playerId = options.playerId?.trim() ?? '';
            active.send(
              encodeMessage({
                type: 'listLeaderboard',
                ...(playerId ? { playerId } : {}),
              }),
            );
          })
          .catch((error: unknown) => {
            rejectBoardWaiters(error instanceof Error ? error : new Error(String(error)));
          });
      });
      return boardInflight;
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
      rejectBoardWaiters(new Error('大厅连接已关闭'));
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
