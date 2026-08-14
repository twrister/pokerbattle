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

/** 玩家当前所在位置；离线档案也出现在全量表。 */
export type OpsPlayerLocation = 'lobby' | 'room' | 'offline';

/** 运维站玩家行：当前连接或离线档案 + 历史战绩。 */
export interface OpsPlayerRecord {
  playerId: string;
  displayName: string;
  matches: number;
  wins: number;
  losses: number;
  winRate: number | null;
  firstSeenAt: number;
  lastPlayedAt: number;
  lastOnlineAt: number;
  location: OpsPlayerLocation;
  roomId: string | null;
  roomName: string | null;
}

/** 游戏服在线玩家只读接口载荷。 */
export interface OpsPlayersStatus {
  ok: true;
  players: OpsPlayerRecord[];
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
  /** 停在主菜单、已登记 lobby、尚未 join/rejoin 入房的连接数（含卡组/图鉴等未入房页面）。 */
  lobbyPlayers: number;
  summary: OpsRoomSummary;
  rooms: OpsRoomSnapshot[];
  /** 全部历史玩家（含离线），与 /ops/players 同源，避免运维站再拉一次。 */
  players: OpsPlayerRecord[];
}
