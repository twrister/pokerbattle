import type { Faction } from '@pb/sim';

/** 运维视角下的房间阶段，便于面板分组展示。 */
export type OpsRoomPhase = 'waiting' | 'playing' | 'ended';

/** 单席位摘要：不含重连令牌等敏感信息。 */
export interface OpsSeatSnapshot {
  seat: number;
  name: string;
  faction: Faction;
  connected: boolean;
}

/** 单房间运维快照：覆盖等待/对局中/已结束，供独立运维站轮询。 */
export interface OpsRoomSnapshot {
  roomId: string;
  roomName: string;
  phase: OpsRoomPhase;
  serverTick: number;
  playerCount: number;
  connectedCount: number;
  maxPlayers: number;
  seats: OpsSeatSnapshot[];
  createdAt: number;
  lastActiveAt: number;
}

/** 进程级房间汇总，避免运维页再自己聚合。 */
export interface OpsRoomSummary {
  roomCount: number;
  waitingRooms: number;
  playingRooms: number;
  endedRooms: number;
  seatedPlayers: number;
  connectedPlayers: number;
}

/** 游戏服只读状态接口载荷。 */
export interface OpsServerStatus {
  ok: true;
  startedAt: number;
  uptimeMs: number;
  host: string;
  port: number;
  /** 当前 WebSocket 连接数（含大厅未入座连接）。 */
  connectionCount: number;
  summary: OpsRoomSummary;
  rooms: OpsRoomSnapshot[];
}
