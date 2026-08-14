import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashSourceTree, nextReleaseVersion } from '../../../scripts/releaseVersion.mjs';

describe('nextReleaseVersion', () => {
  it('首次部署使用种子版本，不先 +1', () => {
    expect(nextReleaseVersion(null, 'abc', '0.1.0')).toBe('0.1.0');
    expect(nextReleaseVersion({ version: '0.1.0' }, 'abc', '0.1.0')).toBe('0.1.0');
  });

  it('内容相同则保持版本', () => {
    expect(nextReleaseVersion({ version: '0.1.2', contentHash: 'abc' }, 'abc', '0.1.0')).toBe('0.1.2');
  });

  it('内容变化则 patch +1', () => {
    expect(nextReleaseVersion({ version: '0.1.2', contentHash: 'old' }, 'new', '0.1.0')).toBe('0.1.3');
  });
});

describe('hashSourceTree', () => {
  it('相同源码得到相同哈希，改文件后变化', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pb-hash-'));
    await fs.promises.writeFile(path.join(dir, 'package.json'), '{"version":"0.1.0"}\n');
    await fs.promises.mkdir(path.join(dir, 'packages', 'client'), { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'packages', 'client', 'a.ts'), 'export const a = 1;\n');
    await fs.promises.mkdir(path.join(dir, 'scripts'), { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'scripts', 'x.mjs'), 'export {}\n');

    const first = hashSourceTree(dir);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSourceTree(dir)).toBe(first);

    await fs.promises.writeFile(path.join(dir, 'packages', 'client', 'a.ts'), 'export const a = 2;\n');
    expect(hashSourceTree(dir)).not.toBe(first);

    await fs.promises.rm(dir, { recursive: true, force: true });
  });
});
