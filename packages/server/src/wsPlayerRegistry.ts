import type { WebSocket } from 'ws';
import { normalizeDisplayName, normalizePlayerId } from './playerStatsStore.js';

export interface WsPlayerIdentity {
  playerId: string;
  name: string;
}

/**
 * 按设备 ID 汇总已建立 WS 的玩家。
 * 同一设备多条连接（大厅 + 入房）只占一行，最后一条断开才离线。
 */
export class WsPlayerRegistry {
  private readonly bySocket = new Map<WebSocket, string>();
  private readonly byId = new Map<string, { name: string; sockets: Set<WebSocket> }>();

  /** 把连接挂到设备 ID 上；非法 ID 忽略。 */
  bind(ws: WebSocket, playerId: string, name: string): void {
    const id = normalizePlayerId(playerId);
    if (!id) return;
    const displayName = normalizeDisplayName(name);
    this.unbind(ws);
    this.bySocket.set(ws, id);
    const existing = this.byId.get(id);
    if (existing) {
      existing.sockets.add(ws);
      existing.name = displayName;
      return;
    }
    this.byId.set(id, { name: displayName, sockets: new Set([ws]) });
  }

  /**
   * 连接关闭时注销；该设备已无连接才从名单移除。
   * 返回刚离线的设备 ID，便于写入 lastOnlineAt。
   */
  unbind(ws: WebSocket): string | null {
    const id = this.bySocket.get(ws);
    if (!id) return null;
    this.bySocket.delete(ws);
    const existing = this.byId.get(id);
    if (!existing) return null;
    existing.sockets.delete(ws);
    if (existing.sockets.size === 0) {
      this.byId.delete(id);
      return id;
    }
    return null;
  }

  /** 当前仍有 WS 的设备，供运维站按设备 ID 列表。 */
  list(): WsPlayerIdentity[] {
    return [...this.byId.entries()].map(([playerId, entry]) => ({
      playerId,
      name: entry.name,
    }));
  }
}
