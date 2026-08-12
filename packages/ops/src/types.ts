/** 游戏服房间阶段，与 @pb/server opsTypes 对齐。 */
export type OpsRoomPhase = 'waiting' | 'playing' | 'ended';

export interface OpsSeatSnapshot {
  seat: number;
  name: string;
  faction: string;
  connected: boolean;
}

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

export interface OpsRoomSummary {
  roomCount: number;
  waitingRooms: number;
  playingRooms: number;
  endedRooms: number;
  seatedPlayers: number;
  connectedPlayers: number;
}

/** 游戏服 /ops/status 成功响应。 */
export interface GameServerStatus {
  ok: true;
  startedAt: number;
  uptimeMs: number;
  host: string;
  port: number;
  connectionCount: number;
  summary: OpsRoomSummary;
  rooms: OpsRoomSnapshot[];
}

/** 运维托管的游戏服进程状态。 */
export type ManagedProcessState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'building'
  | 'error';

export interface ManagedProcessInfo {
  state: ManagedProcessState;
  pid: number | null;
  startedAt: number | null;
  uptimeMs: number | null;
  lastError: string | null;
  /** 为 true 表示目标端口上的服务不是本运维站拉起的。 */
  externalConflict: boolean;
}

/** 客户端/权威服等可快速打开的服务入口。 */
export type OpsServiceId = 'game' | 'clientDev' | 'clientOfficial';

export interface OpsServiceEntry {
  id: OpsServiceId;
  label: string;
  port: number;
  /** 相对路径，前端拼到 hostname 上形成打开链接。 */
  path: string;
  description: string;
  reachable: boolean;
  process: ManagedProcessInfo;
  /** 正式服：最近一次 dist/index.html 构建时间；其他服务为 null。 */
  distBuiltAt: number | null;
}

/** 运维站聚合给前端的总状态。 */
export interface OpsDashboardStatus {
  ops: {
    host: string;
    port: number;
    startedAt: number;
    uptimeMs: number;
  };
  process: ManagedProcessInfo;
  game: GameServerStatus | null;
  gameReachable: boolean;
  message: string | null;
  /** 开发服 / 正式服入口状态。 */
  services: OpsServiceEntry[];
}
