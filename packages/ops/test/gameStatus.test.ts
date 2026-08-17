import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearGamePlayers, fetchGameFeedback, fetchGamePlayers } from '../src/gameStatus.js';

describe('clearGamePlayers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clears all players and returns count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(String(url)).toBe('http://127.0.0.1:9090/ops/players/clear');
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, cleared: 3 }),
        };
      }),
    );

    await expect(clearGamePlayers('http://127.0.0.1:9090')).resolves.toEqual({
      ok: true,
      cleared: 3,
      playerId: undefined,
      status: 200,
      error: null,
    });
  });

  it('encodes playerId and maps game-server 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(String(url)).toBe('http://127.0.0.1:9090/ops/players/pb-abc%3A1/clear');
        return {
          ok: false,
          status: 404,
          json: async () => ({ ok: false, message: '未找到该玩家档案' }),
        };
      }),
    );

    await expect(clearGamePlayers('http://127.0.0.1:9090', 'pb-abc:1')).resolves.toEqual({
      ok: false,
      cleared: 0,
      status: 404,
      error: '未找到该玩家档案',
    });
  });

  it('maps unreachable game server to 502', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    );

    await expect(clearGamePlayers('http://127.0.0.1:9090')).resolves.toEqual({
      ok: false,
      cleared: 0,
      status: 502,
      error: 'fetch failed',
    });
  });
});

describe('fetchGamePlayers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps solo location and falls unknown location back to lobby', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          players: [
            {
              playerId: 'solo-1',
              displayName: '单机玩家',
              matches: 0,
              wins: 0,
              losses: 0,
              winRate: null,
              firstSeenAt: 1,
              lastPlayedAt: 1,
              lastOnlineAt: 2,
              location: 'solo',
              roomId: null,
              roomName: null,
            },
            {
              playerId: 'weird-1',
              displayName: '未知',
              matches: 0,
              wins: 0,
              losses: 0,
              winRate: null,
              firstSeenAt: 1,
              lastPlayedAt: 1,
              lastOnlineAt: 2,
              location: 'unknown',
              roomId: null,
              roomName: null,
            },
          ],
        }),
      })),
    );

    const result = await fetchGamePlayers('http://127.0.0.1:9090');
    expect(result.reachable).toBe(true);
    expect(result.players).toEqual([
      expect.objectContaining({ playerId: 'solo-1', location: 'solo' }),
      expect.objectContaining({ playerId: 'weird-1', location: 'lobby' }),
    ]);
  });
});

describe('fetchGameFeedback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps valid rows and drops broken ones', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(String(url)).toBe('http://127.0.0.1:9090/ops/feedback');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            feedback: [
              {
                id: 'fb-1',
                content: '希望加观战音效',
                playerId: 'device-1',
                displayName: '甲',
                appVersion: '0.1.5',
                createdAt: 1_700_000_000_000,
              },
              { id: '', content: '坏行' },
              { playerId: 'no-id' },
            ],
          }),
        };
      }),
    );

    const result = await fetchGameFeedback('http://127.0.0.1:9090');
    expect(result.reachable).toBe(true);
    expect(result.feedback).toEqual([
      {
        id: 'fb-1',
        content: '希望加观战音效',
        playerId: 'device-1',
        displayName: '甲',
        appVersion: '0.1.5',
        createdAt: 1_700_000_000_000,
      },
    ]);
    expect(result.error).toBeNull();
  });

  it('maps HTTP error to unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({ ok: false }),
      })),
    );

    await expect(fetchGameFeedback('http://127.0.0.1:9090')).resolves.toEqual({
      reachable: false,
      feedback: [],
      error: '游戏服反馈接口返回 HTTP 404',
    });
  });

  it('maps invalid payload to unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, feedback: null }),
      })),
    );

    await expect(fetchGameFeedback('http://127.0.0.1:9090')).resolves.toEqual({
      reachable: false,
      feedback: [],
      error: '游戏服反馈载荷无效',
    });
  });

  it('maps abort to timeout error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }),
    );

    await expect(fetchGameFeedback('http://127.0.0.1:9090', 10)).resolves.toEqual({
      reachable: false,
      feedback: [],
      error: '拉取游戏服反馈超时',
    });
  });
});
