import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDashboardStatus } from '../src/dashboardStatus.js';
import type { ProcessManager } from '../src/processManager.js';
import type { ManagedProcessInfo } from '../src/types.js';

function fakeManager(info: ManagedProcessInfo, reachable = false): ProcessManager {
  return {
    getInfo: () => info,
    refreshFromPort: async () => undefined,
    isReachable: async () => reachable,
  } as unknown as ProcessManager;
}

describe('buildDashboardStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('游戏服未启动时归一化为不可达与提示文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    );

    const status = await buildDashboardStatus({
      opsHost: '0.0.0.0',
      opsPort: 9091,
      opsStartedAt: Date.now() - 1000,
      gameBaseUrl: 'http://127.0.0.1:9090',
      processManager: fakeManager({
        state: 'stopped',
        pid: null,
        startedAt: null,
        uptimeMs: null,
        lastError: null,
        externalConflict: false,
      }),
      services: [
        {
          id: 'clientDev',
          label: '开发服',
          port: 9081,
          path: '/',
          description: 'dev',
          manager: fakeManager(
            {
              state: 'stopped',
              pid: null,
              startedAt: null,
              uptimeMs: null,
              lastError: null,
              externalConflict: false,
            },
            false,
          ),
        },
      ],
    });

    expect(status.gameReachable).toBe(false);
    expect(status.game).toBeNull();
    expect(status.message).toBe('游戏服务器未启动');
    expect(status.services).toHaveLength(1);
    expect(status.services[0]?.reachable).toBe(false);
  });

  it('进程 running 且状态接口可达时返回房间数据', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          startedAt: 1,
          uptimeMs: 10,
          host: '0.0.0.0',
          port: 9090,
          connectionCount: 2,
          summary: {
            roomCount: 1,
            waitingRooms: 0,
            playingRooms: 1,
            endedRooms: 0,
            seatedPlayers: 2,
            connectedPlayers: 2,
          },
          rooms: [
            {
              roomId: '001',
              roomName: '测试',
              phase: 'playing',
              serverTick: 12,
              playerCount: 2,
              connectedCount: 2,
              maxPlayers: 2,
              seats: [],
              createdAt: 1,
              lastActiveAt: 2,
            },
          ],
        }),
      })),
    );

    const status = await buildDashboardStatus({
      opsHost: '0.0.0.0',
      opsPort: 9091,
      opsStartedAt: Date.now() - 5000,
      gameBaseUrl: 'http://127.0.0.1:9090',
      processManager: fakeManager({
        state: 'running',
        pid: 99,
        startedAt: Date.now() - 4000,
        uptimeMs: 4000,
        lastError: null,
        externalConflict: false,
      }),
      services: [
        {
          id: 'clientOfficial',
          label: '正式服',
          port: 9080,
          path: '/',
          description: 'official',
          manager: fakeManager(
            {
              state: 'running',
              pid: 100,
              startedAt: Date.now() - 1000,
              uptimeMs: 1000,
              lastError: null,
              externalConflict: false,
            },
            true,
          ),
        },
      ],
    });

    expect(status.gameReachable).toBe(true);
    expect(status.game?.summary.playingRooms).toBe(1);
    expect(status.message).toBeNull();
    expect(status.services[0]?.reachable).toBe(true);
    expect(status.services[0]?.id).toBe('clientOfficial');
  });

  it('外部端口冲突时保留冲突提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          startedAt: 1,
          uptimeMs: 1,
          host: '0.0.0.0',
          port: 9090,
          connectionCount: 0,
          summary: {
            roomCount: 0,
            waitingRooms: 0,
            playingRooms: 0,
            endedRooms: 0,
            seatedPlayers: 0,
            connectedPlayers: 0,
          },
          rooms: [],
        }),
      })),
    );

    const status = await buildDashboardStatus({
      opsHost: '0.0.0.0',
      opsPort: 9091,
      opsStartedAt: Date.now(),
      gameBaseUrl: 'http://127.0.0.1:9090',
      processManager: fakeManager({
        state: 'error',
        pid: null,
        startedAt: null,
        uptimeMs: null,
        lastError: '端口 9090 已被其他进程占用，无法由运维站托管启动',
        externalConflict: true,
      }),
      services: [],
    });

    expect(status.process.externalConflict).toBe(true);
    expect(status.message).toContain('占用');
    expect(status.services).toEqual([]);
  });
});
