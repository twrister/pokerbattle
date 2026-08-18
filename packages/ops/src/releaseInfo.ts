import fs from 'node:fs';
import path from 'node:path';

/**
 * 解析运维站发布请求：只有显式 bumpVersion=true 才升版本，缺省或坏 JSON 都不升。
 */
export function parseDeployRequest(body: string): { bumpVersion: boolean } {
  if (!body.trim()) return { bumpVersion: false };
  try {
    const json = JSON.parse(body) as { bumpVersion?: unknown };
    return { bumpVersion: json.bumpVersion === true };
  } catch {
    return { bumpVersion: false };
  }
}

/** 读工作区根 package.json 的 version；缺文件或非法时返回 null。 */
export function readWorkspaceVersion(rootDir: string): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    if (typeof raw.version === 'string' && raw.version.trim()) return raw.version.trim();
  } catch {
    /* 回落到调用方的 meta / 占位 */
  }
  return null;
}

/** 展示用：去掉前导 v 后补回 v，空则 null。 */
export function formatReleaseVersion(version: string | null | undefined): string | null {
  const trimmed = String(version ?? '')
    .trim()
    .replace(/^v/i, '');
  return trimmed ? `v${trimmed}` : null;
}

/** 把 x.y.z 的 patch +1；无法解析时返回 null，避免页面写出非法号。 */
export function bumpPatchVersion(version: string | null | undefined): string | null {
  const trimmed = String(version ?? '')
    .trim()
    .replace(/^v/i, '');
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(trimmed);
  if (!match) return null;
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

/**
 * 线上优先用 deploy.meta（已上线号），本机回落 package.json。
 */
export function resolveDashboardVersion(
  metaVersion: string | null | undefined,
  packageVersion: string | null | undefined,
): { version: string | null; nextVersion: string | null } {
  const version = (metaVersion && metaVersion.trim()) || (packageVersion && packageVersion.trim()) || null;
  return { version, nextVersion: bumpPatchVersion(version) };
}
