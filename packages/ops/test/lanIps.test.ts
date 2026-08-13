import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listLanIPv4, preferLanIps, writeLanIpsJson } from '../src/lanIps.js';
import { buildDashboardStatus } from '../src/dashboardStatus.js';
import type { ProcessManager } from '../src/processManager.js';
import type { ManagedProcessInfo } from '../src/types.js';

describe('listLanIPv4', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns unique non-internal IPv4 addresses', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as os.NetworkInterfaceInfo],
      eth0: [
        { address: '192.168.6.236', family: 'IPv4', internal: false } as os.NetworkInterfaceInfo,
        { address: 'fe80::1', family: 'IPv6', internal: false } as os.NetworkInterfaceInfo,
      ],
      'WLAN 2': [{ address: '192.168.6.236', family: 'IPv4', internal: false } as os.NetworkInterfaceInfo],
    });

    expect(listLanIPv4()).toEqual(['192.168.6.236']);
  });

  it('accepts numeric family 4 from older Node runtimes', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      eth0: [
        {
          address: '10.0.0.8',
          family: 4 as unknown as 'IPv4',
          internal: false,
        } as os.NetworkInterfaceInfo,
      ],
    });

    expect(listLanIPv4()).toEqual(['10.0.0.8']);
  });

  it('returns empty when only loopback exists', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as os.NetworkInterfaceInfo],
    });

    expect(listLanIPv4()).toEqual([]);
  });

  it('prefers 192.168 over other private ranges', () => {
    expect(preferLanIps(['10.0.0.8', '192.168.6.236', '172.22.0.1'])).toEqual([
      '192.168.6.236',
      '10.0.0.8',
      '172.22.0.1',
    ]);
  });

  it('writes lan-ips.json for the static fallback', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pb-ops-lan-'));
    try {
      const ips = writeLanIpsJson(dir, ['192.168.6.236']);
      expect(ips).toEqual(['192.168.6.236']);
      const raw = await fs.promises.readFile(path.join(dir, 'lan-ips.json'), 'utf8');
      expect(JSON.parse(raw)).toEqual({ lanIps: ['192.168.6.236'] });
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('buildDashboardStatus lanIps', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('forwards injected lanIps onto ops payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    );

    const processManager = {
      getInfo: () =>
        ({
          state: 'stopped',
          pid: null,
          startedAt: null,
          uptimeMs: null,
          lastError: null,
          externalConflict: false,
        }) satisfies ManagedProcessInfo,
      refreshFromPort: async () => undefined,
      isReachable: async () => false,
    } as unknown as ProcessManager;

    const status = await buildDashboardStatus({
      opsHost: '0.0.0.0',
      opsPort: 9091,
      opsStartedAt: Date.now(),
      gameBaseUrl: 'http://127.0.0.1:9090',
      processManager,
      services: [],
      lanIps: ['192.168.6.236'],
    });

    expect(status.ops.lanIps).toEqual(['192.168.6.236']);
  });
});
