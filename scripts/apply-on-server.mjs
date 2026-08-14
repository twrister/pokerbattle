import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashSourceTree, nextReleaseVersion, readPackageVersion } from './releaseVersion.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME_APP = process.env.GAME_APP || '/opt/projects/poker-battle/app';
const OPS_APP = process.env.OPS_APP || '/opt/projects/poker-battle-ops/app';
const GAME_META = process.env.GAME_META || '/opt/projects/poker-battle/deploy.meta.json';
const GAME_UNIT = process.env.GAME_SYSTEMD_UNIT || 'poker-battle';
const OPS_UNIT = process.env.OPS_SYSTEMD_UNIT || 'poker-battle-ops';
const PUBLIC_BASE = process.env.VITE_PUBLIC_BASE || '/poker-battle';
const PNPM_VERSION = '11.20.0';
/**
 * 官方 Node tarball 把 corepack/pnpm 放在 node 同目录；systemd PATH 默认不含这里。
 * 本脚本由线上运维站「pnpm deploy」调用，在工作区构建并覆盖运行包。
 */
const NODE_BIN_DIRS = [
  path.dirname(process.execPath),
  '/usr/local/bin',
  '/usr/local/lib/nodejs/bin',
];

function toolchainEnv(extraEnv = {}) {
  return {
    ...process.env,
    PATH: [...NODE_BIN_DIRS, process.env.PATH || '/usr/bin:/bin'].join(path.delimiter),
    HOME: process.env.HOME || '/root',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    ...extraEnv,
  };
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: toolchainEnv(extraEnv),
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

/** 按 node 安装目录查找可执行文件，避免依赖残缺 PATH。 */
function resolveTool(name) {
  const bins = process.platform === 'win32' ? [`${name}.cmd`, name] : [name];
  for (const dir of NODE_BIN_DIRS) {
    for (const bin of bins) {
      const full = path.join(dir, bin);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

function hasPnpm() {
  const pnpm = resolveTool('pnpm') || 'pnpm';
  const check = spawnSync(pnpm, ['-v'], {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    env: toolchainEnv(),
  });
  return check.status === 0;
}

/** 线上不用 corepack：Node 20 自带版本签名密钥过期。改用 npm 装真实 pnpm。 */
function ensurePnpm() {
  const corepack = resolveTool('corepack');
  if (corepack) {
    spawnSync(corepack, ['disable'], {
      cwd: root,
      stdio: 'inherit',
      shell: true,
      env: toolchainEnv(),
    });
  }
  if (hasPnpm()) return;
  const npmBin = resolveTool('npm') || 'npm';
  run(npmBin, ['install', '-g', `pnpm@${PNPM_VERSION}`]);
  if (!hasPnpm()) {
    console.error('[apply-on-server] 找不到 pnpm，npm 全局安装也失败');
    process.exit(1);
  }
}

/** 覆盖复制目录到目标路径。 */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

/** 读取线上 deploy.meta.json；缺文件或坏 JSON 时返回 null，按首次部署处理。 */
function readLocalGameMeta(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** 写回 version / contentHash / deployedAt，保留 port 等已有字段。 */
function writeReleaseMeta(filePath, previous, release) {
  const meta = previous && typeof previous === 'object' ? { ...previous } : {};
  meta.version = release.version;
  meta.contentHash = release.contentHash;
  meta.deployedAt = new Date().toISOString();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(meta, null, 2)}\n`);
  } catch {
    /* 元数据写失败不阻断重启 */
  }
}

ensurePnpm();
const pnpm = resolveTool('pnpm') || 'pnpm';
const previousMeta = readLocalGameMeta(GAME_META);
const contentHash = hashSourceTree(root);
const version = nextReleaseVersion(previousMeta, contentHash, readPackageVersion(root));
console.log(`[apply-on-server] version=${version} hash=${contentHash.slice(0, 12)}`);
run(pnpm, ['install', '--frozen-lockfile']);
run(pnpm, ['run', 'build:prod'], { VITE_PUBLIC_BASE: PUBLIC_BASE, VITE_APP_VERSION: version });

const dist = path.join(root, 'dist');
const distServer = path.join(root, 'dist-server');
const distOps = path.join(root, 'dist-ops');
if (!fs.existsSync(path.join(dist, 'index.html')) || !fs.existsSync(path.join(distServer, 'server.cjs'))) {
  console.error('[apply-on-server] missing dist or dist-server');
  process.exit(1);
}
if (!fs.existsSync(path.join(distOps, 'server.cjs'))) {
  console.error('[apply-on-server] missing dist-ops/server.cjs');
  process.exit(1);
}

fs.rmSync(path.join(GAME_APP, 'dist'), { recursive: true, force: true });
fs.rmSync(path.join(GAME_APP, 'dist-server'), { recursive: true, force: true });
copyDir(dist, path.join(GAME_APP, 'dist'));
copyDir(distServer, path.join(GAME_APP, 'dist-server'));

for (const name of fs.readdirSync(OPS_APP)) {
  if (name === 'node_modules') continue;
  fs.rmSync(path.join(OPS_APP, name), { recursive: true, force: true });
}
copyDir(distOps, OPS_APP);

writeReleaseMeta(GAME_META, previousMeta, { version, contentHash });

if (process.env.SKIP_SYSTEMD === '1') {
  console.log('[apply-on-server] skip systemd restart');
  process.exit(0);
}

run('systemctl', ['restart', GAME_UNIT]);
// 由运维站在落盘成功状态后再重启自己，避免结果丢失
if (process.env.SKIP_OPS_RESTART === '1') {
  console.log('[apply-on-server] skip ops restart');
  process.exit(0);
}
run('systemctl', ['restart', OPS_UNIT]);
