import {
  encodeMessage,
  normalizeRoomId,
  normalizeRoomName,
  type ErrorMessage,
  type JoinMessage,
  type RejoinMessage,
  type RoomErrorCode,
  type RoomListEntry,
} from '@pb/net';
import { randomInt } from 'node:crypto';
import type { WebSocket } from 'ws';
import { MatchRoom } from './room.js';

export interface RoomActionResult {
  ok: boolean;
  room?: MatchRoom;
  error?: ErrorMessage;
}

/**
 * 进程内多房间注册表：按房号隔离 MatchRoom，并负责快速匹配选房与空房回收。
 */
export class RoomManager {
  private readonly rooms = new Map<string, MatchRoom>();

  /** 当前存活房间数，便于运维日志。 */
  get size(): number {
    return this.rooms.size;
  }

  /** 处理首条 join：按模式选房或建房，失败时回可展示错误。 */
  join(ws: WebSocket, message: JoinMessage): RoomActionResult {
    const mode = message.mode === 'quick' ? 'quick' : message.mode === 'create' ? 'create' : 'room';
    const name = (message.name || 'player').trim() || 'player';

    if (mode === 'quick') {
      return this.joinQuick(ws, name);
    }
    if (mode === 'create') {
      return this.createCustom(ws, name, message.roomName);
    }
    return this.joinCustom(ws, message.roomId ?? '', name);
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
    const ok = room.handleRejoin(ws, message.token ?? '', message.lastTick ?? 0);
    if (!ok) {
      return fail('rejoin_failed', '重连失败，席位已释放或令牌无效');
    }
    return { ok: true, room };
  }

  /** 列出当前可加入的等待中房间。 */
  listJoinable(): RoomListEntry[] {
    const result: RoomListEntry[] = [];
    for (const room of this.rooms.values()) {
      if (!room.canJoin) continue;
      result.push(room.toListEntry());
    }
    return result;
  }

  /** 进程退出时释放全部房间定时器。 */
  dispose(): void {
    for (const room of [...this.rooms.values()]) {
      room.dispose();
    }
    this.rooms.clear();
  }

  /** 快速匹配优先填入已有未开局房间，避免无谓新建。 */
  private joinQuick(ws: WebSocket, name: string): RoomActionResult {
    for (const room of this.rooms.values()) {
      if (!room.canJoin) continue;
      if (room.handleJoin(ws, name)) {
        return { ok: true, room };
      }
    }
    const roomId = this.nextNumericRoomId();
    if (!roomId) {
      return fail('room_full', '房间号已满，请稍后再试');
    }
    const room = this.createRoom(roomId, defaultRoomName(name));
    if (!room.handleJoin(ws, name)) {
      room.dispose();
      return fail('room_full', '暂时无法加入匹配');
    }
    return { ok: true, room };
  }

  /** 创建自定义房间：服务端分配三位房号。 */
  private createCustom(ws: WebSocket, name: string, rawRoomName?: string): RoomActionResult {
    const roomId = this.nextNumericRoomId();
    if (!roomId) {
      return fail('room_full', '房间号已满，请稍后再试');
    }
    const roomName = normalizeRoomName(rawRoomName ?? '') ?? defaultRoomName(name);
    const room = this.createRoom(roomId, roomName);
    if (!room.handleJoin(ws, name)) {
      room.dispose();
      return fail('room_full', '暂时无法创建房间');
    }
    return { ok: true, room };
  }

  /** 加入已有自定义房间；不存在则报错，不再隐式建房。 */
  private joinCustom(ws: WebSocket, rawRoomId: string, name: string): RoomActionResult {
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

    if (!room.handleJoin(ws, name)) {
      return fail('room_full', '房间已满');
    }
    return { ok: true, room };
  }

  /** 创建房间并登记；dispose 时从注册表移除，防止泄漏。 */
  private createRoom(roomId: string, roomName: string): MatchRoom {
    const room = new MatchRoom({
      roomId,
      roomName,
      onDispose: (id) => {
        const current = this.rooms.get(id);
        if (current === room) this.rooms.delete(id);
      },
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
