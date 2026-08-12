import type { WebSocket } from 'ws';

/**
 * 跟踪已登记 lobby、尚未 join/rejoin 入房的 WebSocket。
 * 客户端在未进联机房时保持该连接（含卡组/图鉴/单机等），供 lobbyPlayers 计数。
 */
export class LobbyPresence {
  private readonly sockets = new Set<WebSocket>();

  /** 登记一条大厅连接；重复登记无副作用。 */
  add(ws: WebSocket): void {
    this.sockets.add(ws);
  }

  /** 连接关闭或转入房间时注销。 */
  remove(ws: WebSocket): void {
    this.sockets.delete(ws);
  }

  /** 当前大厅活跃连接数。 */
  get size(): number {
    return this.sockets.size;
  }
}
