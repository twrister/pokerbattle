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
 * 拉取游戏服在线玩家；旧服无此接口或失败时返回空列表，不影响房间监控。
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
      winRate: typeof item.winRate === 'number' ? item.winRate : null,
      firstSeenAt: typeof item.firstSeenAt === 'number' ? item.firstSeenAt : 0,
      lastPlayedAt: typeof item.lastPlayedAt === 'number' ? item.lastPlayedAt : 0,
      location: item.location === 'room' ? 'room' : 'lobby',
      roomId: typeof item.roomId === 'string' ? item.roomId : null,
      roomName: typeof item.roomName === 'string' ? item.roomName : null,
    });
  }
  return players;
}
