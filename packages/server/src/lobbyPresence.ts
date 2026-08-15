import { normalizeLobbyActivity, type LobbyActivity } from '@pb/net';
import type { WebSocket } from 'ws';
import { normalizeDisplayName, normalizePlayerId } from './playerStatsStore.js';

export interface LobbyIdentity {
  name: string;
  playerId: string | null;
  /** 未入房时的页面：大厅或单机，供运维站位置列展示。 */
  activity: LobbyActivity;
}

/**
 * 跟踪已登记 lobby、尚未 join/rejoin 入房的 WebSocket。
 * 客户端在未进联机房时保持该连接（含卡组/图鉴/单机等），供 lobbyPlayers 计数与在线名单。
 */
export class LobbyPresence {
  private readonly sockets = new Map<WebSocket, LobbyIdentity>();

  /** 登记一条大厅连接；重复登记会刷新名字/ID/活动。 */
  add(ws: WebSocket, identity?: { name?: string; playerId?: string; activity?: unknown }): void {
    this.sockets.set(ws, {
      name: normalizeDisplayName(identity?.name),
      playerId: normalizePlayerId(identity?.playerId),
      activity: normalizeLobbyActivity(identity?.activity),
    });
  }

  /** 连接关闭或转入房间时注销。 */
  remove(ws: WebSocket): void {
    this.sockets.delete(ws);
  }

  /** 当前大厅活跃连接数。 */
  get size(): number {
    return this.sockets.size;
  }

  /** 大厅在线身份，供运维站列出未入房玩家。 */
  listOnline(): LobbyIdentity[] {
    return [...this.sockets.values()];
  }
}
