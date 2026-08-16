import type { GameServerStatus, OpsPlayerRecord } from './types.js';

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

export interface ClearGamePlayersResult {
  ok: boolean;
  cleared: number;
  playerId?: string;
  status: number;
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

/** 只放行已知位置；旧服或坏值回退大厅，避免运维表空白。 */
function sanitizeLocation(value: unknown): OpsPlayerRecord['location'] {
  if (value === 'room' || value === 'offline' || value === 'solo') return value;
  return 'lobby';
}
