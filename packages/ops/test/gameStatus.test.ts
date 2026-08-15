import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearGamePlayers, fetchGamePlayers } from '../src/gameStatus.js';

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
