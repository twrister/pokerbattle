import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readGameMeta } from '../src/gameMeta.js';

describe('readGameMeta', () => {
  it('reads port and deployedAt', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pb-meta-'));
    const file = path.join(dir, 'deploy.meta.json');
    await fs.promises.writeFile(
      file,
      JSON.stringify({ name: 'poker-battle', port: 3001, route: '/poker-battle', deployedAt: '2026-08-13T00:00:00Z' }),
    );
    expect(readGameMeta(file)).toMatchObject({
      port: 3001,
      route: '/poker-battle',
      deployedAt: '2026-08-13T00:00:00Z',
      version: null,
      contentHash: null,
    });
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('reads optional version and contentHash', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pb-meta-'));
    const file = path.join(dir, 'deploy.meta.json');
    await fs.promises.writeFile(
      file,
      JSON.stringify({
        name: 'poker-battle',
        port: 3001,
        route: '/poker-battle',
        deployedAt: '2026-08-13T00:00:00Z',
        version: '0.1.2',
        contentHash: 'abc',
      }),
    );
    expect(readGameMeta(file)).toMatchObject({
      version: '0.1.2',
      contentHash: 'abc',
    });
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('returns null when file missing', () => {
    expect(readGameMeta(path.join(os.tmpdir(), 'pb-meta-missing.json'))).toBeNull();
  });
});
