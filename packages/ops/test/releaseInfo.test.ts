import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  bumpPatchVersion,
  formatReleaseVersion,
  parseDeployRequest,
  readWorkspaceVersion,
  resolveDashboardVersion,
} from '../src/releaseInfo.js';

describe('parseDeployRequest', () => {
  it('缺省或坏 JSON 都不升级', () => {
    expect(parseDeployRequest('')).toEqual({ bumpVersion: false });
    expect(parseDeployRequest('{')).toEqual({ bumpVersion: false });
    expect(parseDeployRequest('{"bumpVersion":false}')).toEqual({ bumpVersion: false });
    expect(parseDeployRequest('{"bumpVersion":"true"}')).toEqual({ bumpVersion: false });
  });

  it('仅显式 true 才升级', () => {
    expect(parseDeployRequest('{"bumpVersion":true}')).toEqual({ bumpVersion: true });
  });
});

describe('readWorkspaceVersion', () => {
  it('读取 package.json version', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pb-rel-'));
    await fs.promises.writeFile(path.join(dir, 'package.json'), '{"version":"0.1.8"}\n');
    expect(readWorkspaceVersion(dir)).toBe('0.1.8');
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('缺文件返回 null', () => {
    expect(readWorkspaceVersion(path.join(os.tmpdir(), 'pb-rel-missing'))).toBeNull();
  });
});

describe('formatReleaseVersion / bumpPatchVersion', () => {
  it('统一成 v 前缀', () => {
    expect(formatReleaseVersion('0.1.8')).toBe('v0.1.8');
    expect(formatReleaseVersion('v0.1.8')).toBe('v0.1.8');
    expect(formatReleaseVersion('')).toBeNull();
  });

  it('patch +1', () => {
    expect(bumpPatchVersion('0.1.8')).toBe('0.1.9');
    expect(bumpPatchVersion('v0.1.8')).toBe('0.1.9');
    expect(bumpPatchVersion('bad')).toBeNull();
  });
});

describe('resolveDashboardVersion', () => {
  it('线上 meta 优先于 package.json', () => {
    expect(resolveDashboardVersion('0.1.4', '0.1.8')).toEqual({
      version: '0.1.4',
      nextVersion: '0.1.5',
    });
  });

  it('无 meta 时回落 package.json', () => {
    expect(resolveDashboardVersion(null, '0.1.8')).toEqual({
      version: '0.1.8',
      nextVersion: '0.1.9',
    });
  });
});
