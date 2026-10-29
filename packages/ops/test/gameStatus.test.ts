import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearGamePlayers,
  fetchGameFeedback,
  fetchGameMetrics,
  fetchGamePlayers,
} from '../src/gameStatus.js';

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
              campaignStars: 7,
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
      // 旧版游戏服不上报星数时回落 0，上报则原样透传给运维表。
      expect.objectContaining({ playerId: 'solo-1', location: 'solo', campaignStars: 7 }),
      expect.objectContaining({ playerId: 'weird-1', location: 'lobby', campaignStars: 0 }),
    ]);
  });
});

describe('fetchGameMetrics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const payload = {
    ok: true,
    generatedAt: 1_700_000_000_000,
    timeZone: 'Asia/Shanghai',
    sampleIntervalMs: 60_000,
    hourlyRetentionHours: 168,
    dailyRetentionDays: 30,
    current: {
      onlineDevices: 3,
      anonymousConnections: 1,
      connections: 4,
      lobby: 2,
      solo: 1,
      room: 1,
      sampledAt: 1_700_000_000_000,
    },
    today: {
      day: '2023-11-14',
      dau: 5,
      peakOnline: 7,
      matches: 2,
      avgMatchDurationMs: 90_000,
    },
    totals: { totalPlayers: 40, totalMatches: 12, newPlayersToday: 3 },
    daily: [
      { day: '2023-11-14', label: '11-14', dau: 5, peakOnline: 7, matches: 2, avgMatchDurationMs: 90_000, newPlayers: 3 },
      { day: '2023-11-13', label: '11-13', dau: 2, peakOnline: 3, matches: 1, avgMatchDurationMs: null, newPlayers: 1 },
    ],
    hourly: [
      { hourStart: 1_700_000_000_000, label: '11-14 14:00', avgOnline: 2.5, peakOnline: 4 },
      { hourStart: 1_699_999_000_000, label: '11-14 13:00', avgOnline: 1, peakOnline: 2 },
    ],
  };

  it('正常解析并按时间升序排序日点与小时点', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(String(url)).toBe('http://127.0.0.1:9090/ops/metrics');
        return { ok: true, status: 200, json: async () => payload };
      }),
    );

    const result = await fetchGameMetrics('http://127.0.0.1:9090');
    expect(result.reachable).toBe(true);
    expect(result.error).toBeNull();
    expect(result.metrics?.daily.map((row) => row.day)).toEqual(['2023-11-13', '2023-11-14']);
    expect(result.metrics?.hourly.map((row) => row.label)).toEqual([
      '11-14 13:00',
      '11-14 14:00',
    ]);
    expect(result.metrics?.today.avgMatchDurationMs).toBe(90_000);
    expect(result.metrics?.current.onlineDevices).toBe(3);
  });

  it('404 提示游戏服版本较旧', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );

    await expect(fetchGameMetrics('http://127.0.0.1:9090')).resolves.toEqual({
      reachable: false,
      metrics: null,
      error: '游戏服版本较旧，未提供运营数据接口（重启游戏服后可用）',
    });
  });

  it('剔除坏行并把非法数值归 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          ...payload,
          daily: [
            ...payload.daily,
            { day: '', dau: 9 },
            'broken',
            null,
            { day: '2023-11-12', label: '11-12', dau: 'x', peakOnline: -3, matches: NaN },
          ],
          hourly: [{ hourStart: 0, label: 'bad' }, ...payload.hourly, { hourStart: -1 }],
        }),
      })),
    );

    const result = await fetchGameMetrics('http://127.0.0.1:9090');
    expect(result.reachable).toBe(true);
    expect(result.metrics?.daily).toHaveLength(3);
    const fixed = result.metrics?.daily.find((row) => row.day === '2023-11-12');
    expect(fixed).toMatchObject({ dau: 0, peakOnline: 0, matches: 0, label: '11-12' });
    // hourStart 非正的桶整体丢弃
    expect(result.metrics?.hourly).toHaveLength(2);
  });

  it('缺字段的载荷补齐为 0 而不是报错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      })),
    );

    const result = await fetchGameMetrics('http://127.0.0.1:9090');
    expect(result.reachable).toBe(true);
    expect(result.metrics).toMatchObject({
      timeZone: 'Asia/Shanghai',
      daily: [],
      hourly: [],
      today: { day: '', dau: 0, avgMatchDurationMs: null },
      totals: { totalPlayers: 0 },
    });
  });

  it('ok 不为 true 时视为载荷无效', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: false }) })),
    );

    await expect(fetchGameMetrics('http://127.0.0.1:9090')).resolves.toEqual({
      reachable: false,
      metrics: null,
      error: '游戏服运营数据载荷无效',
    });
  });

  it('超时归为拉取超时', async () => {
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

    await expect(fetchGameMetrics('http://127.0.0.1:9090', 10)).resolves.toEqual({
      reachable: false,
      metrics: null,
      error: '拉取游戏服运营数据超时',
    });
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
