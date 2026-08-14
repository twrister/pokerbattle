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

/** 游戏服 /ops/players 中的在线玩家行。 */
export interface OpsPlayerRecord {
  playerId: string;
  displayName: string;
  matches: number;
  wins: number;
  losses: number;
  winRate: number | null;
  firstSeenAt: number;
  lastPlayedAt: number;
  location: 'lobby' | 'room';
  roomId: string | null;
  roomName: string | null;
}

/** 游戏服 /ops/status 成功响应。 */
export interface GameServerStatus {
  ok: true;
  startedAt: number;
  uptimeMs: number;
  host: string;
  port: number;
  connectionCount: number;
  /** 未入联机房间、已登记 lobby 的连接数（含卡组/图鉴等页面）。 */
  lobbyPlayers: number;
  summary: OpsRoomSummary;
  rooms: OpsRoomSnapshot[];
  /** 已建立 WS 的玩家；旧游戏服可能没有该字段。 */
  players?: OpsPlayerRecord[];
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
export type OpsServiceId = 'game' | 'clientDev' | 'clientOfficial' | 'gamePublic';

export interface OpsServiceEntry {
  id: OpsServiceId;
  label: string;
  port: number;
  /** 相对路径，前端拼到局域网 IP 上形成打开链接。 */
  path: string;
  description: string;
  reachable: boolean;
  process: ManagedProcessInfo;
  /** 正式服：最近一次 dist/index.html 构建时间；其他服务为 null。 */
  distBuiltAt: number | null;
  /** 线上公开 URL；有值时前端不再拼 host:port。 */
  publicUrl: string | null;
  /** 仅提供打开入口，不展示本机启停/重新部署按钮。 */
  openOnly: boolean;
}

/** 运维站「pnpm deploy」进度，供仪表盘展示。 */
export interface OpsDeployInfo {
  running: boolean;
  available: boolean;
  command: string;
  lastError: string | null;
  lastFinishedAt: number | null;
  lastOk: boolean | null;
}

/** 运维站聚合给前端的总状态。 */
export interface OpsDashboardStatus {
  ops: {
    host: string;
    port: number;
    startedAt: number;
    uptimeMs: number;
    /** 本机局域网 IPv4；前端拼服务入口，避免把 localhost 复制给其他设备。 */
    lanIps: string[];
    /** 线上 systemd 模式为 true，前端隐藏无鉴权横幅。 */
    production: boolean;
  };
  process: ManagedProcessInfo;
  game: GameServerStatus | null;
  gameReachable: boolean;
  /** 游戏服不可达或旧版本无 /ops/players 时为空数组。 */
  players: OpsPlayerRecord[];
  message: string | null;
  /** 开发服 / 正式服入口状态。 */
  services: OpsServiceEntry[];
  /** 本机/线上发布任务状态。 */
  deploy: OpsDeployInfo;
}
