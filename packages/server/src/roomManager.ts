import {
  encodeMessage,
  normalizeRoomId,
  normalizeRoomName,
  type ErrorMessage,
  type JoinMessage,
  type RejoinMessage,
  type SpectateMessage,
  type RoomErrorCode,
  type RoomListEntry,
} from '@pb/net';
import { randomInt } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { OpsRoomSnapshot, OpsRoomSummary } from './opsTypes.js';
import { normalizePlayerId, type OnlinePresence, type PlayerStatsStore } from './playerStatsStore.js';
import { MatchRoom } from './room.js';

export interface RoomManagerOptions {
  playerStats?: PlayerStatsStore;
}

export interface RoomActionResult {
  ok: boolean;
  room?: MatchRoom;
  error?: ErrorMessage;
  /** 入座/重连成功后的设备 ID，供 WS 在线表登记。 */
  playerId?: string | null;
  name?: string;
}

/**
 * 进程内多房间注册表：按房号隔离 MatchRoom，并负责快速匹配选房与空房回收。
 */
export class RoomManager {
  private readonly rooms = new Map<string, MatchRoom>();
  private readonly playerStats?: PlayerStatsStore;

  constructor(options: RoomManagerOptions = {}) {
    this.playerStats = options.playerStats;
  }

  /** 当前存活房间数，便于运维日志。 */
  get size(): number {
    return this.rooms.size;
  }

  /** 处理首条 join：按模式选房或建房，失败时回可展示错误。 */
  join(ws: WebSocket, message: JoinMessage): RoomActionResult {
    const mode = message.mode === 'quick' ? 'quick' : message.mode === 'create' ? 'create' : 'room';
    const name = (message.name || 'player').trim() || 'player';
    const playerId = normalizePlayerId(message.playerId);

    const result =
      mode === 'quick'
        ? this.joinQuick(ws, name, playerId)
        : mode === 'create'
          ? this.createCustom(ws, name, playerId, message.roomName, message.matchMode)
          : this.joinCustom(ws, message.roomId ?? '', name, playerId);
    if (result.ok) {
      result.playerId = playerId;
      result.name = name;
    }
    return result;
  }

  /** 处理首条 rejoin：按房号找到房间并校验令牌。 */
  rejoin(ws: WebSocket, message: RejoinMessage): RoomActionResult {
    const roomId = normalizeRoomId(message.roomId ?? '');
    if (!roomId) {
      return fail('invalid_room', '房间号无效');
    }
    const room = this.rooms.get(roomId);
    if (!room) {
      return fail('rejoin_failed', '房间已结束，无法重连');
    }
    const identity = room.identityForReconnect(message.token ?? '');
    const ok = room.handleRejoin(ws, message.token ?? '', message.lastTick ?? 0);
    if (!ok) {
      return fail('rejoin_failed', '重连失败，席位已释放或令牌无效');
    }
    return { ok: true, room, playerId: identity?.playerId ?? null, name: identity?.name };
  }

  /** 列出全部存活房间（含对局中），供大厅加入或观战。 */
  listRooms(): RoomListEntry[] {
    const result: RoomListEntry[] = [];
    for (const room of this.rooms.values()) {
      result.push(room.toListEntry());
    }
    return result;
  }

  /** 处理首条 spectate：仅对局中房间可入。 */
  spectate(ws: WebSocket, message: SpectateMessage): RoomActionResult {
    const roomId = normalizeRoomId(message.roomId ?? '');
    if (!roomId) {
      return fail('invalid_room', '房间号须为 3 位数字');
    }
    const room = this.rooms.get(roomId);
    if (!room) {
      return fail('invalid_room', '房间不存在');
    }
    if (!room.canSpectate) {
      return fail('not_playing', '该房间尚未开局，无法观战');
    }
    const name = (message.name || '观众').trim() || '观众';
    const playerId = normalizePlayerId(message.playerId);
    if (!room.handleSpectate(ws, name, playerId)) {
      return fail('not_playing', '该房间尚未开局，无法观战');
    }
    return { ok: true, room, playerId, name };
  }

  /** 各房间当前在线席位，供运维站在线名单。 */
  listOnlinePlayers(): OnlinePresence[] {
    const result: OnlinePresence[] = [];
    for (const room of this.rooms.values()) {
      result.push(...room.listOnlinePlayers());
    }
    return result;
  }

  /** 列出全部存活房间快照（含对局中），供运维站监控。 */
  listOpsSnapshots(): OpsRoomSnapshot[] {
    return [...this.rooms.values()].map((room) => room.toOpsSnapshot());
  }

  /** 聚合房间阶段与在线席位，减少运维前端重复计算。 */
  summarizeOps(): OpsRoomSummary {
    const rooms = this.listOpsSnapshots();
    let waitingRooms = 0;
    let playingRooms = 0;
    let endedRooms = 0;
    let seatedPlayers = 0;
    let connectedPlayers = 0;
    for (const room of rooms) {
      if (room.phase === 'waiting') waitingRooms += 1;
      else if (room.phase === 'playing') playingRooms += 1;
      else endedRooms += 1;
      seatedPlayers += room.playerCount;
      connectedPlayers += room.connectedCount;
    }
    return {
      roomCount: rooms.length,
      waitingRooms,
      playingRooms,
      endedRooms,
      seatedPlayers,
      connectedPlayers,
    };
  }

  /** 进程退出时释放全部房间定时器。 */
  dispose(): void {
    for (const room of [...this.rooms.values()]) {
      room.dispose();
    }
    this.rooms.clear();
  }

  /** 快速匹配优先填入已有未开局房间，避免无谓新建。 */
  private joinQuick(ws: WebSocket, name: string, playerId: string | null): RoomActionResult {
    for (const room of this.rooms.values()) {
      if (!room.canJoin) continue;
      if (room.handleJoin(ws, name, playerId)) {
        return { ok: true, room };
      }
    }
    const roomId = this.nextNumericRoomId();
    if (!roomId) {
      return fail('room_full', '房间号已满，请稍后再试');
    }
    const room = this.createRoom(roomId, defaultRoomName(name));
    if (!room.handleJoin(ws, name, playerId)) {
      room.dispose();
      return fail('room_full', '暂时无法加入匹配');
    }
    return { ok: true, room };
  }

  /** 创建自定义房间：服务端分配三位房号。 */
  private createCustom(
    ws: WebSocket,
    name: string,
    playerId: string | null,
    rawRoomName?: string,
    matchMode?: string,
  ): RoomActionResult {
    const roomId = this.nextNumericRoomId();
    if (!roomId) {
      return fail('room_full', '房间号已满，请稍后再试');
    }
    const roomName = normalizeRoomName(rawRoomName ?? '') ?? defaultRoomName(name);
    const room = this.createRoom(roomId, roomName, matchMode === '2v2' ? '2v2' : '1v1');
    if (!room.handleJoin(ws, name, playerId)) {
      room.dispose();
      return fail('room_full', '暂时无法创建房间');
    }
    return { ok: true, room };
  }

  /** 加入已有自定义房间；不存在则报错，不再隐式建房。 */
  private joinCustom(
    ws: WebSocket,
    rawRoomId: string,
    name: string,
    playerId: string | null,
  ): RoomActionResult {
    const roomId = normalizeRoomId(rawRoomId);
    if (!roomId) {
      return fail('invalid_room', '房间号须为 3 位数字');
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return fail('invalid_room', '房间不存在');
    }
    if (!room.canJoin) {
      if (!room.isEmpty) {
        return fail('already_started', '该房间已在对局中或已满');
      }
      return fail('room_full', '房间已满');
    }

    if (!room.handleJoin(ws, name, playerId)) {
      return fail('room_full', '房间已满');
    }
    return { ok: true, room };
  }

  /** 创建房间并登记；dispose 时从注册表移除，防止泄漏。 */
  private createRoom(roomId: string, roomName: string, matchMode: '1v1' | '2v2' = '1v1'): MatchRoom {
    const room = new MatchRoom({
      roomId,
      roomName,
      matchMode,
      onDispose: (id) => {
        const current = this.rooms.get(id);
        if (current === room) this.rooms.delete(id);
      },
      onPlayerJoin: (playerId, name) => this.playerStats?.upsertPlayer(playerId, name),
      onDecisiveMatch: (winnerId, loserId, names) =>
        this.playerStats?.recordDecisiveMatch(winnerId, loserId, names),
    });
    this.rooms.set(roomId, room);
    return room;
  }

  /** 生成空闲的三位数字房号；耗尽返回 null。 */
  private nextNumericRoomId(): string | null {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const id = String(randomInt(0, 1000)).padStart(3, '0');
      if (!this.rooms.has(id)) return id;
    }
    // 随机碰撞过多时线性扫一遍剩余号段
    for (let n = 0; n < 1000; n += 1) {
      const id = String(n).padStart(3, '0');
      if (!this.rooms.has(id)) return id;
    }
    return null;
  }
}

/** 构造标准错误结果，便于入口统一回包。 */
function fail(code: RoomErrorCode, message: string): RoomActionResult {
  return {
    ok: false,
    error: { type: 'error', code, message },
  };
}

/** 默认房间名：玩家名 + 「的房间」。 */
function defaultRoomName(playerName: string): string {
  return normalizeRoomName(`${playerName}的房间`) ?? '玩家的房间';
}

/** 向客户端发送错误消息；连接可能随即关闭。 */
export function sendRoomError(ws: WebSocket, error: ErrorMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(encodeMessage(error));
  }
}
