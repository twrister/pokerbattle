import type { WebSocket } from 'ws';
import { normalizeDisplayName, normalizePlayerId } from './playerStatsStore.js';

export interface WsPlayerIdentity {
  playerId: string;
  name: string;
}

/** 采样用的连接汇总：设备数与已绑定 ID 的连接数。 */
export interface WsRegistrySnapshot {
  /** 已上报设备 ID 的在线人数（同一设备多连接只算 1）。 */
  devices: number;
  /** 已绑定设备 ID 的连接数；与总连接数相减得到匿名连接数。 */
  boundConnections: number;
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

  /**
   * 采样快照：设备数与已绑定连接数。
   * 只有上报了 ID 的连接才进 bySocket，因此已绑定连接数即「可计入在线人数的连接」。
   */
  snapshot(): WsRegistrySnapshot {
    return { devices: this.byId.size, boundConnections: this.bySocket.size };
  }
}
