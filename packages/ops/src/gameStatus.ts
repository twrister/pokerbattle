import type { GameServerStatus } from './types.js';

export interface FetchGameStatusResult {
  reachable: boolean;
  status: GameServerStatus | null;
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
    return { reachable: true, status: data, error: null };
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
