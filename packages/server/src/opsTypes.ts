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
  spectatorCount: number;
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
export type OpsPlayerLocation = 'lobby' | 'room' | 'solo' | 'offline';

/** 运维站玩家行：当前连接或离线档案 + 历史战绩。 */
export interface OpsPlayerRecord {
  playerId: string;
  displayName: string;
  matches: number;
  wins: number;
  losses: number;
  score: number;
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

/** 运维站反馈行：玩家提交的意见原文，不含处理状态。 */
export interface OpsFeedbackRecord {
  id: string;
  content: string;
  playerId: string;
  displayName: string;
  appVersion: string;
  createdAt: number;
}

/** 游戏服意见反馈只读接口载荷。 */
export interface OpsFeedbackStatus {
  ok: true;
  feedback: OpsFeedbackRecord[];
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

/** 小时桶：只保留有采样的整点，缺桶表示进程未运行。 */
export interface OpsHourlyPoint {
  /** 按 timeZone 对齐的整点毫秒值，用作排序与区间过滤。 */
  hourStart: number;
  /** 服务端按 METRICS_TZ 预生成的轴标签，如 `10-28 14:00`。 */
  label: string;
  /** 该小时内全部采样的平均在线人数。 */
  avgOnline: number;
  /** 该小时内的在线人数峰值。 */
  peakOnline: number;
}

/** 日桶：窗口内无数据的日子补 0，便于表格对齐。 */
export interface OpsDailyPoint {
  /** `YYYY-MM-DD`，按 timeZone 切分。 */
  day: string;
  /** 轴标签，如 `10-28`。 */
  label: string;
  /** 按设备 ID 去重的日活。 */
  dau: number;
  peakOnline: number;
  matches: number;
  /** 无对局时为 null，避免除零。 */
  avgMatchDurationMs: number | null;
  /** 当日首次出现的玩家数，由玩家档案首见时间派生。 */
  newPlayers: number;
}

/** 游戏服运营时序只读接口载荷；运维站只代理展示，不二次聚合。 */
export interface OpsMetricsPayload {
  ok: true;
  generatedAt: number;
  /** 日/小时边界所用时区，供页面标注口径。 */
  timeZone: string;
  sampleIntervalMs: number;
  hourlyRetentionHours: number;
  dailyRetentionDays: number;
  /** 最近一次采样（60 秒一跳），用于在线构成展示。 */
  current: {
    onlineDevices: number;
    anonymousConnections: number;
    connections: number;
    lobby: number;
    solo: number;
    room: number;
    sampledAt: number | null;
  };
  today: {
    day: string;
    dau: number;
    peakOnline: number;
    matches: number;
    avgMatchDurationMs: number | null;
  };
  totals: {
    totalPlayers: number;
    /** 仅统计保留窗口（近 30 天）内的对局数。 */
    totalMatches: number;
    newPlayersToday: number;
  };
  /** 固定 30 天，升序，无数据补 0。 */
  daily: OpsDailyPoint[];
  /** 近 7 天有采样的整点，升序；缺桶由前端断线处理。 */
  hourly: OpsHourlyPoint[];
}
