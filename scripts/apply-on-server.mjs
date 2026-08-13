import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME_APP = process.env.GAME_APP || '/opt/projects/poker-battle/app';
const OPS_APP = process.env.OPS_APP || '/opt/projects/poker-battle-ops/app';
const GAME_META = process.env.GAME_META || '/opt/projects/poker-battle/deploy.meta.json';
const GAME_UNIT = process.env.GAME_SYSTEMD_UNIT || 'poker-battle';
const OPS_UNIT = process.env.OPS_SYSTEMD_UNIT || 'poker-battle-ops';
const PUBLIC_BASE = process.env.VITE_PUBLIC_BASE || '/poker-battle';

/**
 * 在服务器工作区构建并覆盖运行包，最后重启 systemd。
 * 由线上运维站「pnpm deploy」调用；不走 SSH。
 */
function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

/** 没有 pnpm 时用 corepack 启用仓库锁定的版本。 */
function ensurePnpm() {
  const check = spawnSync('pnpm', ['-v'], { cwd: root, shell: true, encoding: 'utf8' });
  if (check.status === 0) return;
  run('corepack', ['enable']);
  run('corepack', ['prepare', 'pnpm@11.20.0', '--activate']);
}

/** 覆盖复制目录到目标路径。 */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

ensurePnpm();
run('pnpm', ['install', '--frozen-lockfile']);
run('pnpm', ['run', 'build:prod'], { VITE_PUBLIC_BASE: PUBLIC_BASE });

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

if (fs.existsSync(GAME_META)) {
  try {
    const meta = JSON.parse(fs.readFileSync(GAME_META, 'utf8'));
    meta.deployedAt = new Date().toISOString();
    fs.writeFileSync(GAME_META, `${JSON.stringify(meta, null, 2)}\n`);
  } catch {
    /* 元数据写失败不阻断重启 */
  }
}

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
