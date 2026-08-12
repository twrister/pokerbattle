import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readDistInfo } from '../src/distInfo.js';

describe('readDistInfo', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await fs.promises.rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it('文件不存在时返回 exists=false', async () => {
    const missing = path.join(os.tmpdir(), `pb-ops-dist-missing-${Date.now()}.html`);
    const info = await readDistInfo(missing);
    expect(info).toEqual({ exists: false, builtAt: null });
  });

  it('读取 index.html 的 mtime 作为 builtAt', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pb-ops-dist-'));
    tempDirs.push(dir);
    const indexPath = path.join(dir, 'index.html');
    await fs.promises.writeFile(indexPath, '<html></html>', 'utf8');
    const before = Date.now();
    // 保证 mtime 落在写入窗口附近
    const info = await readDistInfo(indexPath);
    expect(info.exists).toBe(true);
    expect(info.builtAt).toBeTypeOf('number');
    expect(info.builtAt!).toBeGreaterThanOrEqual(before - 5_000);
    expect(info.builtAt!).toBeLessThanOrEqual(Date.now() + 1_000);
  });
});
