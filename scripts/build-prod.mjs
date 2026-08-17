import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDist = path.join(root, 'packages/client/dist');
const outDist = path.join(root, 'dist');
const outServer = path.join(root, 'dist-server/server.cjs');
const outOps = path.join(root, 'dist-ops/server.cjs');
const opsPublicSrc = path.join(root, 'packages/ops/public');
const outOpsPublic = path.join(root, 'dist-ops/public');

/** 在仓库根目录执行命令；extraEnv 用于注入 Vite 子路径。 */
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

const base = process.env.VITE_PUBLIC_BASE || '';
console.log(`[build-prod] VITE_PUBLIC_BASE=${base || '(root)'}`);

run('pnpm', ['--filter', '@pb/client', 'build'], base ? { VITE_PUBLIC_BASE: base } : {});

if (!fs.existsSync(path.join(clientDist, 'index.html'))) {
  console.error('[build-prod] missing packages/client/dist/index.html');
  process.exit(1);
}

fs.rmSync(outDist, { recursive: true, force: true });
fs.cpSync(clientDist, outDist, { recursive: true });

// 部署包需要 /poker-battle 前缀，但本机 9080 正式预览吃的是 packages/client/dist。
// 若留下子路径产物，页面会去 /poker-battle/assets 拉 JS，Vite preview 回退成 HTML，无法游玩。
if (base) {
  console.log('[build-prod] restore local official dist with root base');
  run('pnpm', ['--filter', '@pb/client', 'build'], { VITE_PUBLIC_BASE: '' });
}

run('pnpm', [
  'exec',
  'esbuild',
  'packages/server/src/index.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${outServer}`,
]);

if (!fs.existsSync(outServer)) {
  console.error('[build-prod] missing dist-server/server.cjs');
  process.exit(1);
}

run('pnpm', [
  'exec',
  'esbuild',
  'packages/ops/src/index.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${outOps}`,
]);

if (!fs.existsSync(outOps)) {
  console.error('[build-prod] missing dist-ops/server.cjs');
  process.exit(1);
}

fs.rmSync(outOpsPublic, { recursive: true, force: true });
fs.cpSync(opsPublicSrc, outOpsPublic, { recursive: true });
fs.rmSync(path.join(outOpsPublic, 'lan-ips.json'), { force: true });

console.log('[build-prod] ok: dist/ + dist-server/server.cjs + dist-ops/');
