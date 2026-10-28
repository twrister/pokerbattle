import type {
  GameServerStatus,
  OpsDailyPoint,
  OpsFeedbackRecord,
  OpsHourlyPoint,
  OpsMetricsPayload,
  OpsPlayerRecord,
} from './types.js';

export interface FetchGameStatusResult {
  reachable: boolean;
  status: GameServerStatus | null;
  error: string | null;
}

export interface FetchGamePlayersResult {
  reachable: boolean;
  players: OpsPlayerRecord[];
  error: string | null;
}

export interface FetchGameFeedbackResult {
  reachable: boolean;
  feedback: OpsFeedbackRecord[];
  error: string | null;
}

export interface ClearGamePlayersResult {
  ok: boolean;
  cleared: number;
  playerId?: string;
  status: number;
  error: string | null;
}

export interface FetchGameMetricsResult {
  reachable: boolean;
  metrics: OpsMetricsPayload | null;
  error: string | null;
}

/**
 * 拉取游戏服只读状态；失败时归一化为不可达，不抛错到 HTTP 层。
 */
export async function fetchGameStatus(
  baseUrl: string,
  timeoutMs = 1500,
): Promise<FetchGameStatusResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/ops/status`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return {
        reachable: false,
        status: null,
        error: `游戏服状态接口返回 HTTP ${response.status}`,
      };
    }
    const data = (await response.json()) as GameServerStatus;
    if (!data || data.ok !== true) {
      return { reachable: false, status: null, error: '游戏服状态载荷无效' };
    }
    return {
      reachable: true,
      status: {
        ...data,
        players: Array.isArray(data.players) ? sanitizePlayers(data.players) : undefined,
      },
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'AbortError'
          ? '拉取游戏服状态超时'
          : error.message
        : '拉取游戏服状态失败';
    return { reachable: false, status: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 拉取游戏服玩家名单；旧服无此接口或失败时返回空列表，不影响房间监控。
 */
export async function fetchGamePlayers(
  baseUrl: string,
  timeoutMs = 1500,
): Promise<FetchGamePlayersResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/ops/players`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return {
        reachable: false,
        players: [],
        error: `游戏服玩家接口返回 HTTP ${response.status}`,
      };
    }
    const data = (await response.json()) as { ok?: unknown; players?: unknown };
    if (!data || data.ok !== true || !Array.isArray(data.players)) {
      return { reachable: false, players: [], error: '游戏服玩家载荷无效' };
    }
    return { reachable: true, players: sanitizePlayers(data.players), error: null };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'AbortError'
          ? '拉取游戏服玩家超时'
          : error.message
        : '拉取游戏服玩家失败';
    return { reachable: false, players: [], error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 拉取游戏服意见反馈；旧服无此接口或失败时返回空列表。
 */
export async function fetchGameFeedback(
  baseUrl: string,
  timeoutMs = 1500,
): Promise<FetchGameFeedbackResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/ops/feedback`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return {
        reachable: false,
        feedback: [],
        error: `游戏服反馈接口返回 HTTP ${response.status}`,
      };
    }
    const data = (await response.json()) as { ok?: unknown; feedback?: unknown };
    if (!data || data.ok !== true || !Array.isArray(data.feedback)) {
      return { reachable: false, feedback: [], error: '游戏服反馈载荷无效' };
    }
    return { reachable: true, feedback: sanitizeFeedback(data.feedback), error: null };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'AbortError'
          ? '拉取游戏服反馈超时'
          : error.message
        : '拉取游戏服反馈失败';
    return { reachable: false, feedback: [], error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 拉取运营时序数据；旧游戏服没有该接口时给出明确可操作的提示。
 * 与 /api/feedback 同风格：失败也归一化为 reachable=false，不抛到 HTTP 层。
 */
export async function fetchGameMetrics(
  baseUrl: string,
  timeoutMs = 3000,
): Promise<FetchGameMetricsResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/ops/metrics`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (response.status === 404) {
      return {
        reachable: false,
        metrics: null,
        error: '游戏服版本较旧，未提供运营数据接口（重启游戏服后可用）',
      };
    }
    if (!response.ok) {
      return {
        reachable: false,
        metrics: null,
        error: `游戏服运营数据接口返回 HTTP ${response.status}`,
      };
    }
    const data = (await response.json()) as Partial<OpsMetricsPayload> | null;
    if (!data || data.ok !== true) {
      return { reachable: false, metrics: null, error: '游戏服运营数据载荷无效' };
    }
    const metrics = sanitizeMetrics(data);
    if (!metrics) {
      return { reachable: false, metrics: null, error: '游戏服运营数据载荷无效' };
    }
    return { reachable: true, metrics, error: null };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'AbortError'
          ? '拉取游戏服运营数据超时'
          : error.message
        : '拉取游戏服运营数据失败';
    return { reachable: false, metrics: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 转发清空玩家档案；不传 playerId 则清全部。
 * 游戏服不可达或超时归一化为 502，不抛到 HTTP 层。
 */
export async function clearGamePlayers(
  baseUrl: string,
  playerId?: string,
  timeoutMs = 3000,
): Promise<ClearGamePlayersResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const path = playerId
    ? `/ops/players/${encodeURIComponent(playerId)}/clear`
    : '/ops/players/clear';
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const data = (await response.json().catch(() => ({}))) as {
      ok?: unknown;
      cleared?: unknown;
      playerId?: unknown;
      message?: unknown;
    };
    if (!response.ok || data.ok !== true) {
      const message =
        typeof data.message === 'string' && data.message
          ? data.message
          : `游戏服清空接口返回 HTTP ${response.status}`;
      return {
        ok: false,
        cleared: 0,
        status: response.status >= 400 ? response.status : 502,
        error: message,
      };
    }
    return {
      ok: true,
      cleared: typeof data.cleared === 'number' ? data.cleared : 0,
      playerId: typeof data.playerId === 'string' ? data.playerId : undefined,
      status: 200,
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'AbortError'
          ? '清空玩家数据超时'
          : error.message
        : '清空玩家数据失败';
    return { ok: false, cleared: 0, status: 502, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/** 只保留结构完整的行，避免旧/坏数据把运维表打挂。 */
function sanitizePlayers(rows: unknown[]): OpsPlayerRecord[] {
  const players: OpsPlayerRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const item = row as Record<string, unknown>;
    if (typeof item.playerId !== 'string' || !item.playerId.trim()) continue;
    const displayName = typeof item.displayName === 'string' ? item.displayName : 'player';
    players.push({
      playerId: item.playerId,
      displayName,
      matches: typeof item.matches === 'number' ? item.matches : 0,
      wins: typeof item.wins === 'number' ? item.wins : 0,
      losses: typeof item.losses === 'number' ? item.losses : 0,
      score: typeof item.score === 'number' ? item.score : 0,
      winRate: typeof item.winRate === 'number' ? item.winRate : null,
      firstSeenAt: typeof item.firstSeenAt === 'number' ? item.firstSeenAt : 0,
      lastPlayedAt: typeof item.lastPlayedAt === 'number' ? item.lastPlayedAt : 0,
      lastOnlineAt:
        typeof item.lastOnlineAt === 'number'
          ? item.lastOnlineAt
          : typeof item.lastPlayedAt === 'number'
            ? item.lastPlayedAt
            : 0,
      location: sanitizeLocation(item.location),
      roomId: typeof item.roomId === 'string' ? item.roomId : null,
      roomName: typeof item.roomName === 'string' ? item.roomName : null,
    });
  }
  return players;
}

/** 只保留结构完整的意见行，避免坏数据把运维表打挂。 */
function sanitizeFeedback(rows: unknown[]): OpsFeedbackRecord[] {
  const feedback: OpsFeedbackRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const item = row as Record<string, unknown>;
    if (typeof item.id !== 'string' || !item.id.trim()) continue;
    if (typeof item.content !== 'string' || !item.content.trim()) continue;
    if (typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt)) continue;
    feedback.push({
      id: item.id,
      content: item.content,
      playerId: typeof item.playerId === 'string' ? item.playerId : '',
      displayName: typeof item.displayName === 'string' ? item.displayName : 'player',
      appVersion: typeof item.appVersion === 'string' ? item.appVersion : '',
      createdAt: item.createdAt,
    });
  }
  return feedback;
}

/** 只放行已知位置；旧服或坏值回退大厅，避免运维表空白。 */
function sanitizeLocation(value: unknown): OpsPlayerRecord['location'] {
  if (value === 'room' || value === 'offline' || value === 'solo') return value;
  return 'lobby';
}

/**
 * 逐层清洗运营载荷：坏行丢弃、非有限数归 0、数组排序。
 * 单条坏数据不该让整页图表空白，因此这里不整包失败。
 */
function sanitizeMetrics(raw: Partial<OpsMetricsPayload>): OpsMetricsPayload | null {
  const daily = Array.isArray(raw.daily)
    ? raw.daily
        .map(sanitizeDailyPoint)
        .filter((point): point is OpsDailyPoint => point !== null)
        .sort((a, b) => a.day.localeCompare(b.day))
    : [];
  const hourly = Array.isArray(raw.hourly)
    ? raw.hourly
        .map(sanitizeHourlyPoint)
        .filter((point): point is OpsHourlyPoint => point !== null)
        .sort((a, b) => a.hourStart - b.hourStart)
    : [];
  const current: Record<string, unknown> = isRecord(raw.current) ? raw.current : {};
  const today: Record<string, unknown> = isRecord(raw.today) ? raw.today : {};
  const totals: Record<string, unknown> = isRecord(raw.totals) ? raw.totals : {};

  return {
    ok: true,
    generatedAt: readNumber(raw.generatedAt),
    timeZone: typeof raw.timeZone === 'string' && raw.timeZone.trim() ? raw.timeZone : 'Asia/Shanghai',
    sampleIntervalMs: readNumber(raw.sampleIntervalMs),
    hourlyRetentionHours: readNumber(raw.hourlyRetentionHours),
    dailyRetentionDays: readNumber(raw.dailyRetentionDays),
    current: {
      onlineDevices: readNumber(current.onlineDevices),
      anonymousConnections: readNumber(current.anonymousConnections),
      connections: readNumber(current.connections),
      lobby: readNumber(current.lobby),
      solo: readNumber(current.solo),
      room: readNumber(current.room),
      sampledAt: readNullableNumber(current.sampledAt),
    },
    today: {
      day: readString(today.day),
      dau: readNumber(today.dau),
      peakOnline: readNumber(today.peakOnline),
      matches: readNumber(today.matches),
      avgMatchDurationMs: readNullableNumber(today.avgMatchDurationMs),
    },
    totals: {
      totalPlayers: readNumber(totals.totalPlayers),
      totalMatches: readNumber(totals.totalMatches),
      newPlayersToday: readNumber(totals.newPlayersToday),
    },
    daily,
    hourly,
  };
}

function sanitizeDailyPoint(row: unknown): OpsDailyPoint | null {
  if (!isRecord(row)) return null;
  const day = typeof row.day === 'string' ? row.day.trim() : '';
  if (!day) return null;
  return {
    day,
    label: typeof row.label === 'string' && row.label.trim() ? row.label : day.slice(5),
    dau: readNumber(row.dau),
    peakOnline: readNumber(row.peakOnline),
    matches: readNumber(row.matches),
    avgMatchDurationMs: readNullableNumber(row.avgMatchDurationMs),
    newPlayers: readNumber(row.newPlayers),
  };
}

function sanitizeHourlyPoint(row: unknown): OpsHourlyPoint | null {
  if (!isRecord(row)) return null;
  const hourStart = readNumber(row.hourStart);
  if (hourStart <= 0) return null;
  return {
    hourStart,
    label: typeof row.label === 'string' ? row.label : '',
    avgOnline: readNumber(row.avgOnline),
    peakOnline: readNumber(row.peakOnline),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 非有限数/负数一律归 0，避免 NaN 传到 SVG 坐标里。 */
function readNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

/** 允许 null 的数值字段（无对局的平均时长、未采样的时间戳）。 */
function readNullableNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
