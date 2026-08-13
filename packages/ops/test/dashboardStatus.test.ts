import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

  it('normalizes unreachable game server message', async () => {
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
          label: 'clientDev',
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
    expect(status.message).toBeTruthy();
    expect(String(status.message).includes('\u672a\u542f\u52a8')).toBe(true);
    expect(status.services).toHaveLength(1);
    expect(status.services[0]?.reachable).toBe(false);
    expect(status.services[0]?.distBuiltAt).toBeNull();
    expect(status.ops.lanIps).toEqual([]);
  });

  it('returns room data when process running and status reachable', async () => {
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
          lobbyPlayers: 1,
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
              roomName: 'test',
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
          label: 'clientOfficial',
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
    expect(status.game?.lobbyPlayers).toBe(1);
    expect(status.message).toBeNull();
    expect(status.services[0]?.reachable).toBe(true);
    expect(status.services[0]?.id).toBe('clientOfficial');
    expect(status.ops.lanIps).toEqual([]);
  });

  it('keeps external conflict message', async () => {
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
          lobbyPlayers: 0,
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
        lastError: 'port 9090 occupied',
        externalConflict: true,
      }),
      services: [],
    });

    expect(status.process.externalConflict).toBe(true);
    expect(status.message).toContain('occupied');
    expect(status.services).toEqual([]);
  });

  it('exposes reachable external clientDev process summary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    );

    const status = await buildDashboardStatus({
      opsHost: '0.0.0.0',
      opsPort: 9091,
      opsStartedAt: Date.now(),
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
          label: 'clientDev',
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
              externalConflict: true,
            },
            true,
          ),
        },
      ],
    });

    expect(status.services[0]).toMatchObject({
      id: 'clientDev',
      reachable: true,
      process: { state: 'stopped', externalConflict: true },
      distBuiltAt: null,
    });
  });

  it('attaches distBuiltAt for official service', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pb-ops-dash-dist-'));
    const indexPath = path.join(dir, 'index.html');
    await fs.promises.writeFile(indexPath, '<html></html>', 'utf8');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    );

    try {
      const status = await buildDashboardStatus({
        opsHost: '0.0.0.0',
        opsPort: 9091,
        opsStartedAt: Date.now(),
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
            id: 'clientOfficial',
            label: 'clientOfficial',
            port: 9080,
            path: '/',
            description: 'official',
            distIndexPath: indexPath,
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

      expect(status.services[0]?.distBuiltAt).toBeTypeOf('number');
      expect(status.services[0]?.distBuiltAt).toBeGreaterThan(0);
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });
});
