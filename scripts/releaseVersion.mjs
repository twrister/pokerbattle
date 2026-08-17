import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** 与 packWorkspace 一致：这些目录不进发布源码，也不参与哈希。 */
export const SOURCE_SKIP = new Set([
  'node_modules',
  'dist',
  'dist-server',
  'dist-ops',
  '.git',
  'coverage',
]);

/** 打进 workspace 的仓库根文件，顺序不影响哈希（写入前会排序）。 */
export const WORKSPACE_ROOT_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
];

/**
 * 对会打进 workspace 的源码做稳定哈希，供部署对比「内容是否变化」。
 * 不算 dist：构建产物含时间戳，同样源码每次打包也会变。
 */
export function hashSourceTree(rootDir) {
  const files = [];
  for (const name of WORKSPACE_ROOT_FILES) {
    if (fs.existsSync(path.join(rootDir, name))) files.push(toPosix(name));
  }
  collectFiles(path.join(rootDir, 'packages'), 'packages', files);
  collectFiles(path.join(rootDir, 'scripts'), 'scripts', files);
  if (fs.existsSync(path.join(rootDir, '.deploy', 'project.json'))) {
    files.push('.deploy/project.json');
  }
  files.sort();
  const hash = createHash('sha256');
  for (const rel of files) {
    hash.update(rel);
    hash.update('\0');
    hash.update(contentForHash(rel, fs.readFileSync(path.join(rootDir, rel))));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * 根 package.json 的 version 由发布流程回写，不参与「内容是否变化」。
 * 否则每次同步版本号都会让下次部署再 +1。
 */
function contentForHash(rel, content) {
  if (rel !== 'package.json') return content;
  try {
    const json = JSON.parse(content.toString('utf8'));
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      delete json.version;
      return JSON.stringify(json);
    }
  } catch {
    /* 坏 JSON 仍按原文哈希 */
  }
  return content;
}

/** 读取根 package.json 的 version，缺省 0.1.0。 */
export function readPackageVersion(rootDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    if (typeof raw.version === 'string' && raw.version.trim()) return raw.version.trim();
  } catch {
    /* 回落到种子版本 */
  }
  return '0.1.0';
}

/**
 * 把发布版本写回根 package.json，让开发服与线上号对齐。
 * 已相同则不写盘，避免无意义改文件。
 */
export function writePackageVersion(rootDir, version) {
  const filePath = path.join(rootDir, 'package.json');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('package.json 不是对象，无法写入 version');
  }
  if (raw.version === version) return false;
  raw.version = version;
  fs.writeFileSync(filePath, `${JSON.stringify(raw, null, 2)}\n`);
  return true;
}

/**
 * 按上次发布记录算出版本，写回 package.json 后返回本次 version / contentHash。
 * 先比哈希再写版本：version 已从哈希中剔除，回写不会触发下一次误加号。
 */
export function resolveAndSyncReleaseVersion(rootDir, previous) {
  const contentHash = hashSourceTree(rootDir);
  const version = nextReleaseVersion(previous, contentHash, readPackageVersion(rootDir));
  writePackageVersion(rootDir, version);
  return { version, contentHash };
}

/**
 * 根据上次部署记录与当前源码哈希决定展示版本。
 * 无上次哈希视为首次：沿用已有 version 或 seed，不先 +1。
 */
export function nextReleaseVersion(previous, contentHash, seedVersion = '0.1.0') {
  const lastVersion = parseSemver(previous?.version) ? previous.version : null;
  const lastHash = typeof previous?.contentHash === 'string' && previous.contentHash ? previous.contentHash : null;
  if (!lastHash) return lastVersion ?? seedVersion;
  if (lastHash === contentHash) return lastVersion ?? seedVersion;
  return bumpPatch(lastVersion ?? seedVersion);
}

/** 把 x.y.z 的 patch +1；无法解析时原样返回，避免写出非法版本。 */
export function bumpPatch(version) {
  const parsed = parseSemver(version);
  if (!parsed) return version;
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

/** 只接受纯数字三段 semver，忽略预发布后缀。 */
export function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? '').trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function collectFiles(absDir, relDir, out) {
  if (!fs.existsSync(absDir)) return;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (SOURCE_SKIP.has(entry.name)) continue;
    const rel = toPosix(path.join(relDir, entry.name));
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) collectFiles(abs, rel, out);
    else if (entry.isFile()) out.push(rel);
  }
}

function toPosix(rel) {
  return rel.split(path.sep).join('/');
}
