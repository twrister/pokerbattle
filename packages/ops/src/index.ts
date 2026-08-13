import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkBasicAuth, writeUnauthorized } from './basicAuth.js';
import { buildDashboardStatus, type ServiceDescriptor } from './dashboardStatus.js';
import { DeployRunner, workspaceReady } from './deployRunner.js';
import { readGameMeta } from './gameMeta.js';
import { listLanIPv4, writeLanIpsJson } from './lanIps.js';
import { ProcessManager } from './processManager.js';
import type { ServiceController } from './serviceController.js';
import { SystemdManager } from './systemdManager.js';
import type { OpsServiceId } from './types.js';

const IS_PROD = process.env.OPS_MODE === 'production';
const OPS_PORT = Number(process.env.OPS_PORT || process.env.PORT) || 9091;
const OPS_HOST = process.env.OPS_HOST || (IS_PROD ? '127.0.0.1' : '0.0.0.0');
const STARTED_AT = Date.now();
const OPS_BASIC_USER = process.env.OPS_BASIC_USER ?? '';
const OPS_BASIC_PASSWORD = process.env.OPS_BASIC_PASSWORD ?? '';

if (IS_PROD && (!OPS_BASIC_USER || !OPS_BASIC_PASSWORD)) {
  console.error('[pb-ops] 生产模式缺少 OPS_BASIC_USER / OPS_BASIC_PASSWORD');
  process.exit(1);
}

const PUBLIC_DIR = resolvePublicDir();
const runtime = IS_PROD ? createProductionRuntime() : createLocalRuntime();
const deployRunner = createDeployRunner();

const server = http.createServer(async (req, res) => {
  try {
    if (IS_PROD && !checkBasicAuth(req, OPS_BASIC_USER, OPS_BASIC_PASSWORD)) {
      writeUnauthorized(res);
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
      return;
    }

    await serveStatic(res, pathname);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('[pb-ops] request failed', message);
    writeJson(res, 500, { ok: false, message });
  }
});

server.listen(OPS_PORT, OPS_HOST, () => {
  if (IS_PROD) {
    console.log(`[pb-ops] production http://${OPS_HOST}:${OPS_PORT} (nginx 反代 + Basic Auth)`);
    return;
  }
  const lanIps = writeLanIpsJson(PUBLIC_DIR);
  console.log(`[pb-ops] http://${OPS_HOST === '0.0.0.0' ? '0.0.0.0' : OPS_HOST}:${OPS_PORT}`);
  console.log('[pb-ops] 仅建议在受信局域网使用，当前未启用鉴权');
  console.log(`[pb-ops] 本机打开: http://127.0.0.1:${OPS_PORT}/`);
  for (const ip of lanIps) {
    console.log(`[pb-ops] 局域网: http://${ip}:${OPS_PORT}/`);
  }
});

async function shutdown(): Promise<void> {
  console.log('[pb-ops] shutting down...');
  if (!IS_PROD) {
    await Promise.all(Object.values(runtime.serviceManagers).map((manager) => manager.dispose()));
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});

/** 处理运维控制 API：状态查询与启停重启。 */
async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): Promise<void> {
  if (req.method === 'POST') {
    const limited = await readBodyLimited(req, 4096);
    if (!limited.ok) {
      writeJson(res, 413, { ok: false, message: limited.error });
      return;
    }
  }

  if (req.method === 'GET' && pathname === '/api/status') {
    const status = await buildDashboardStatus({
      opsHost: OPS_HOST,
      opsPort: OPS_PORT,
      opsStartedAt: STARTED_AT,
      gameBaseUrl: runtime.resolveGameBaseUrl(),
      processManager: runtime.processManager,
      production: IS_PROD,
      services: runtime.serviceDescriptors,
      lanIps: IS_PROD ? [] : listLanIPv4(),
      deploy: deployRunner.getInfo(),
    });
    writeJson(res, 200, status);
    return;
  }

  // 立即 202，发布在后台跑；线上成功后会重启运维站
  if (req.method === 'POST' && pathname === '/api/deploy') {
    const result = deployRunner.start();
    writeJson(res, result.started ? 202 : 409, { ok: result.ok, message: result.message });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/server/start') {
    const result = await runtime.processManager.start();
    writeJson(res, result.ok ? 200 : 409, result);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/server/stop') {
    const result = await runtime.processManager.stop();
    writeJson(res, result.ok ? 200 : 409, result);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/server/restart') {
    const result = await runtime.processManager.restart();
    writeJson(res, result.ok ? 200 : 409, result);
    return;
  }

  if (!IS_PROD && req.method === 'POST' && pathname === '/api/services/clientOfficial/redeploy') {
    const official = runtime.serviceManagers.clientOfficial as ProcessManager | undefined;
    if (!official) {
      writeJson(res, 404, { ok: false, message: 'Not Found' });
      return;
    }
    const result = await official.redeploy({
      buildPnpmArgs: ['--filter', '@pb/client', 'build'],
      buildTimeoutMs: 300_000,
    });
    writeJson(res, result.ok ? 200 : 409, result);
    return;
  }

  const serviceMatch = pathname.match(
    /^\/api\/services\/(game|clientDev|clientOfficial|gamePublic)\/(start|stop|restart)$/,
  );
  if (req.method === 'POST' && serviceMatch) {
    const id = serviceMatch[1] as OpsServiceId;
    const action = serviceMatch[2] as 'start' | 'stop' | 'restart';
    const manager = runtime.serviceManagers[id];
    if (!manager) {
      writeJson(res, 404, { ok: false, message: 'Not Found' });
      return;
    }
    const result =
      action === 'start'
        ? await manager.start()
        : action === 'stop'
          ? await manager.stop()
          : await manager.restart();
    writeJson(res, result.ok ? 200 : 409, result);
    return;
  }

  writeJson(res, 404, { ok: false, message: 'Not Found' });
}

interface OpsRuntime {
  resolveGameBaseUrl: () => string;
  processManager: ServiceController;
  serviceManagers: Partial<Record<OpsServiceId, ServiceController>>;
  serviceDescriptors: ServiceDescriptor[];
}

/** 本机：pnpm 托管权威服 / 开发服 / 正式预览。 */
function createLocalRuntime(): OpsRuntime {
  const gamePort = Number(process.env.PORT) || 9090;
  const clientDevPort = Number(process.env.CLIENT_DEV_PORT) || 9081;
  const clientOfficialPort = Number(process.env.CLIENT_OFFICIAL_PORT) || 9080;
  const gameHost = process.env.GAME_STATUS_HOST || '127.0.0.1';
  const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const clientDist = path.resolve(workspaceRoot, 'packages/client/dist/index.html');

  const resolveOfficialPnpmArgs = (): string[] =>
    fs.existsSync(clientDist) ? ['--filter', '@pb/client', 'preview'] : ['official'];
  const resolveOfficialReadyTimeoutMs = (): number => (fs.existsSync(clientDist) ? 20_000 : 180_000);

  const processManager = new ProcessManager({
    id: 'game',
    label: '游戏服务器',
    port: gamePort,
    host: gameHost,
    pnpmArgs: ['--filter', '@pb/server', 'start'],
    env: {
      PORT: String(gamePort),
      HOST: process.env.HOST || '0.0.0.0',
    },
    logPrefix: 'pb-server',
    workspaceRoot,
  });

  const clientDevManager = new ProcessManager({
    id: 'clientDev',
    label: '开发服',
    port: clientDevPort,
    host: gameHost,
    pnpmArgs: ['--filter', '@pb/client', 'dev'],
    logPrefix: 'pb-client-dev',
    readyTimeoutMs: 20_000,
    workspaceRoot,
  });

  const clientOfficialManager = new ProcessManager({
    id: 'clientOfficial',
    label: '正式服',
    port: clientOfficialPort,
    host: gameHost,
    pnpmArgs: resolveOfficialPnpmArgs(),
    resolvePnpmArgs: resolveOfficialPnpmArgs,
    resolveReadyTimeoutMs: resolveOfficialReadyTimeoutMs,
    logPrefix: 'pb-client-official',
    readyTimeoutMs: resolveOfficialReadyTimeoutMs(),
    workspaceRoot,
  });

  return {
    resolveGameBaseUrl: () => `http://${gameHost}:${gamePort}`,
    processManager,
    serviceManagers: {
      game: processManager,
      clientDev: clientDevManager,
      clientOfficial: clientOfficialManager,
    },
    serviceDescriptors: [
      {
        id: 'clientDev',
        label: '开发服',
        port: clientDevPort,
        path: '/',
        description: 'Vite 开发服，含调试面板与配置写回',
        manager: clientDevManager,
      },
      {
        id: 'clientOfficial',
        label: '正式服',
        port: clientOfficialPort,
        path: '/',
        description: '正式预览产物，适合联机与局域网访问',
        manager: clientOfficialManager,
        distIndexPath: clientDist,
      },
    ],
  };
}

/** 线上：systemctl 管 poker-battle，只展示公网入口。 */
function createProductionRuntime(): OpsRuntime {
  const metaPath = process.env.GAME_META || '/opt/projects/poker-battle/deploy.meta.json';
  const unit = process.env.GAME_SYSTEMD_UNIT || 'poker-battle';
  const resolveMeta = () => readGameMeta(metaPath);
  const resolvePort = () => resolveMeta()?.port ?? 0;
  const processManager = new SystemdManager({
    unit,
    resolvePort,
    host: '127.0.0.1',
  });
  const meta = resolveMeta();
  const publicUrl =
    process.env.PUBLIC_GAME_URL ||
    (meta?.route ? `http://127.0.0.1${meta.route}/` : 'http://127.0.0.1/poker-battle/');
  const deployedAt = meta?.deployedAt ? Date.parse(meta.deployedAt) : null;

  return {
    resolveGameBaseUrl: () => `http://127.0.0.1:${resolvePort() || 3001}`,
    processManager,
    serviceManagers: { game: processManager },
    serviceDescriptors: [
      {
        id: 'gamePublic',
        label: '游戏正式服',
        port: resolvePort(),
        path: '/',
        description: '公网入口；可用本页「pnpm deploy」发布更新',
        manager: processManager,
        publicUrl,
        openOnly: true,
        builtAt: Number.isFinite(deployedAt) ? deployedAt : null,
      },
    ],
  };
}

/** 本机跑 pnpm deploy；线上在已同步的工作区构建并覆盖运行包。 */
function createDeployRunner(): DeployRunner {
  // 生产包是 CJS，没有 import.meta.url；本地路径只在 tsx 开发时解析
  if (!IS_PROD) {
    const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    return new DeployRunner({
      commandLabel: 'pnpm deploy',
      command: 'pnpm',
      args: ['deploy'],
      cwd: workspaceRoot,
    });
  }

  const workspace = process.env.OPS_WORKSPACE || '/opt/projects/poker-battle/workspace';
  const opsUnit = process.env.OPS_SYSTEMD_UNIT || 'poker-battle-ops';
  return new DeployRunner({
    commandLabel: 'pnpm deploy',
    command: process.env.NODE_BIN || '/usr/local/bin/node',
    args: ['scripts/apply-on-server.mjs'],
    cwd: workspace,
    env: {
      PATH: `/usr/local/bin:/usr/local/lib/nodejs/bin:${process.env.PATH || '/usr/bin:/bin'}`,
      HOME: process.env.HOME || '/root',
      SKIP_OPS_RESTART: '1',
      GAME_APP: process.env.GAME_APP || '/opt/projects/poker-battle/app',
      OPS_APP: process.env.OPS_APP || '/opt/projects/poker-battle-ops/app',
      GAME_META: process.env.GAME_META || '/opt/projects/poker-battle/deploy.meta.json',
      GAME_SYSTEMD_UNIT: process.env.GAME_SYSTEMD_UNIT || 'poker-battle',
      VITE_PUBLIC_BASE: '/poker-battle',
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    },
    workspaceExists: workspaceReady(workspace),
    statusFile: process.env.OPS_DEPLOY_STATUS || '/opt/projects/poker-battle-ops/last-deploy.json',
    restartOpsAfterSuccess: true,
    restartOpsFn: () => {
      spawnSync('systemctl', ['restart', opsUnit], { stdio: 'inherit', shell: true });
    },
  });
}

/** 生产包用 cwd/public；本地 tsx 用源码旁的 public。 */
function resolvePublicDir(): string {
  if (process.env.OPS_PUBLIC_DIR) return path.resolve(process.env.OPS_PUBLIC_DIR);
  if (IS_PROD) return path.resolve(process.cwd(), 'public');
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
}

/** 提供运维静态页面；默认回落到 index.html。 */
async function serveStatic(res: http.ServerResponse, pathname: string): Promise<void> {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const distRoot = path.resolve(PUBLIC_DIR);
  const resolved = path.resolve(distRoot, relative);
  if (resolved !== distRoot && !resolved.startsWith(distRoot + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const data = await fs.promises.readFile(resolved);
    res.writeHead(200, {
      'Content-Type': contentTypeFor(resolved),
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

/** 读取并限制 POST 正文大小。 */
function readBodyLimited(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; body: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        resolve({ ok: false, error: '请求体过大' });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve({ ok: true, body: Buffer.concat(chunks).toString('utf8') });
    });
    req.on('error', () => {
      resolve({ ok: false, error: '读取请求体失败' });
    });
  });
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}
