import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  hashSourceTree,
  nextReleaseVersion,
  resolveAndSyncReleaseVersion,
  writePackageVersion,
} from '../../../scripts/releaseVersion.mjs';

/** 搭一份能跑 hashSourceTree 的最小仓库树。 */
async function makeSourceTree(version = '0.1.0') {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pb-hash-'));
  await fs.promises.writeFile(path.join(dir, 'package.json'), `{"name":"x","version":"${version}"}\n`);
  await fs.promises.mkdir(path.join(dir, 'packages', 'client'), { recursive: true });
  await fs.promises.writeFile(path.join(dir, 'packages', 'client', 'a.ts'), 'export const a = 1;\n');
  await fs.promises.mkdir(path.join(dir, 'scripts'), { recursive: true });
  await fs.promises.writeFile(path.join(dir, 'scripts', 'x.mjs'), 'export {}\n');
  return dir;
}

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

  it('内容变化但未勾选升级则保持版本', () => {
    expect(nextReleaseVersion({ version: '0.1.2', contentHash: 'old' }, 'new', '0.1.0', false)).toBe(
      '0.1.2',
    );
  });
});

describe('hashSourceTree', () => {
  it('相同源码得到相同哈希，改文件后变化', async () => {
    const dir = await makeSourceTree();
    const first = hashSourceTree(dir);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSourceTree(dir)).toBe(first);

    await fs.promises.writeFile(path.join(dir, 'packages', 'client', 'a.ts'), 'export const a = 2;\n');
    expect(hashSourceTree(dir)).not.toBe(first);

    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('根 package.json 的 version 不参与哈希', async () => {
    const dir = await makeSourceTree('0.1.0');
    const first = hashSourceTree(dir);
    writePackageVersion(dir, '0.1.9');
    expect(hashSourceTree(dir)).toBe(first);
    await fs.promises.rm(dir, { recursive: true, force: true });
  });
});

describe('writePackageVersion', () => {
  it('写入 version，已相同则不改文件', async () => {
    const dir = await makeSourceTree('0.1.0');
    expect(writePackageVersion(dir, '0.1.4')).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version).toBe('0.1.4');
    const before = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
    expect(writePackageVersion(dir, '0.1.4')).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).toBe(before);
    await fs.promises.rm(dir, { recursive: true, force: true });
  });
});

describe('resolveAndSyncReleaseVersion', () => {
  it('内容变化则加号并写回 package.json', async () => {
    const dir = await makeSourceTree('0.1.2');
    const previousHash = hashSourceTree(dir);
    await fs.promises.writeFile(path.join(dir, 'packages', 'client', 'a.ts'), 'export const a = 2;\n');
    const result = resolveAndSyncReleaseVersion(dir, { version: '0.1.2', contentHash: previousHash });
    expect(result.version).toBe('0.1.3');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version).toBe('0.1.3');
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('未勾选升级时内容变化仍保持原版本', async () => {
    const dir = await makeSourceTree('0.1.2');
    const previousHash = hashSourceTree(dir);
    await fs.promises.writeFile(path.join(dir, 'packages', 'client', 'a.ts'), 'export const a = 2;\n');
    const result = resolveAndSyncReleaseVersion(
      dir,
      { version: '0.1.2', contentHash: previousHash },
      { bumpVersion: false },
    );
    expect(result.version).toBe('0.1.2');
    expect(result.contentHash).not.toBe(previousHash);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version).toBe('0.1.2');
    await fs.promises.rm(dir, { recursive: true, force: true });
  });
});
