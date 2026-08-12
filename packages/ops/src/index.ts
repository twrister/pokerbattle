import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDashboardStatus, type ServiceDescriptor } from './dashboardStatus.js';
import { ProcessManager } from './processManager.js';
import type { OpsServiceId } from './types.js';

const OPS_PORT = Number(process.env.OPS_PORT) || 9091;
const OPS_HOST = process.env.OPS_HOST || '0.0.0.0';
const GAME_PORT = Number(process.env.PORT) || 9090;
const CLIENT_DEV_PORT = Number(process.env.CLIENT_DEV_PORT) || 9081;
const CLIENT_OFFICIAL_PORT = Number(process.env.CLIENT_OFFICIAL_PORT) || 9080;
const GAME_HOST = process.env.GAME_STATUS_HOST || '127.0.0.1';
const GAME_BASE_URL = `http://${GAME_HOST}:${GAME_PORT}`;
const STARTED_AT = Date.now();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');
const CLIENT_DIST = path.resolve(WORKSPACE_ROOT, 'packages/client/dist/index.html');

/** 正式服：已有 dist 直接 preview，否则走 build+preview。 */
function resolveOfficialPnpmArgs(): string[] {
  return fs.existsSync(CLIENT_DIST) ? ['--filter', '@pb/client', 'preview'] : ['official'];
}

function resolveOfficialReadyTimeoutMs(): number {
  return fs.existsSync(CLIENT_DIST) ? 20_000 : 180_000;
}

const processManager = new ProcessManager({
  id: 'game',
  label: '游戏服务器',
  port: GAME_PORT,
  host: GAME_HOST,
  pnpmArgs: ['--filter', '@pb/server', 'start'],
  env: {
    PORT: String(GAME_PORT),
    HOST: process.env.HOST || '0.0.0.0',
  },
  logPrefix: 'pb-server',
});

const clientDevManager = new ProcessManager({
  id: 'clientDev',
  label: '开发服',
  port: CLIENT_DEV_PORT,
  host: GAME_HOST,
  pnpmArgs: ['--filter', '@pb/client', 'dev'],
  logPrefix: 'pb-client-dev',
  readyTimeoutMs: 20_000,
});

const clientOfficialManager = new ProcessManager({
  id: 'clientOfficial',
  label: '正式服',
  port: CLIENT_OFFICIAL_PORT,
  host: GAME_HOST,
  pnpmArgs: resolveOfficialPnpmArgs(),
  resolvePnpmArgs: resolveOfficialPnpmArgs,
  resolveReadyTimeoutMs: resolveOfficialReadyTimeoutMs,
  logPrefix: 'pb-client-official',
  readyTimeoutMs: resolveOfficialReadyTimeoutMs(),
});

const serviceManagers: Record<OpsServiceId, ProcessManager> = {
  game: processManager,
  clientDev: clientDevManager,
  clientOfficial: clientOfficialManager,
};

const serviceDescriptors: ServiceDescriptor[] = [
  {
    id: 'clientDev',
    label: '开发服',
    port: CLIENT_DEV_PORT,
    path: '/',
    description: 'Vite 开发服，含调试面板与配置写回',
    manager: clientDevManager,
  },
  {
    id: 'clientOfficial',
    label: '正式服',
    port: CLIENT_OFFICIAL_PORT,
    path: '/',
    description: '正式预览产物，适合联机与局域网访问',
    manager: clientOfficialManager,
    distIndexPath: CLIENT_DIST,
  },
];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
      return;
    }

    await serveStatic(res, pathname);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    writeJson(res, 500, { ok: false, message });
  }
});

server.listen(OPS_PORT, OPS_HOST, () => {
  console.log(`[pb-ops] http://${OPS_HOST === '0.0.0.0' ? '0.0.0.0' : OPS_HOST}:${OPS_PORT}`);
  console.log('[pb-ops] 仅建议在受信局域网使用，当前未启用鉴权');
  console.log(`[pb-ops] 本机打开: http://127.0.0.1:${OPS_PORT}/`);
  for (const ip of listLanIPv4()) {
    console.log(`[pb-ops] 局域网: http://${ip}:${OPS_PORT}/`);
  }
});

async function shutdown(): Promise<void> {
  console.log('[pb-ops] shutting down, stopping managed services...');
  await Promise.all([
    processManager.dispose(),
    clientDevManager.dispose(),
    clientOfficialManager.dispose(),
  ]);
  server.close(() => process.exit(0));
  // 防止 close 回调未触发时挂起
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
  // 限制正文体积，避免恶意大包占用内存
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
      gameBaseUrl: GAME_BASE_URL,
      processManager,
      services: serviceDescriptors,
    });
    writeJson(res, 200, status);
    return;
  }

  // 兼容旧路径：/api/server/* → 游戏服
  if (req.method === 'POST' && pathname === '/api/server/start') {
    const result = await processManager.start();
    writeJson(res, result.ok ? 200 : 409, result);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/server/stop') {
    const result = await processManager.stop();
    writeJson(res, result.ok ? 200 : 409, result);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/server/restart') {
    const result = await processManager.restart();
    writeJson(res, result.ok ? 200 : 409, result);
    return;
  }

  // 正式服一键重新部署：停 → build → preview
  if (req.method === 'POST' && pathname === '/api/services/clientOfficial/redeploy') {
    const result = await clientOfficialManager.redeploy({
      buildPnpmArgs: ['--filter', '@pb/client', 'build'],
      buildTimeoutMs: 300_000,
    });
    writeJson(res, result.ok ? 200 : 409, result);
    return;
  }

  const serviceMatch = pathname.match(
    /^\/api\/services\/(game|clientDev|clientOfficial)\/(start|stop|restart)$/,
  );
  if (req.method === 'POST' && serviceMatch) {
    const id = serviceMatch[1] as OpsServiceId;
    const action = serviceMatch[2] as 'start' | 'stop' | 'restart';
    const manager = serviceManagers[id];
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

/** 提供运维静态页面；默认回落到 index.html。 */
async function serveStatic(res: http.ServerResponse, pathname: string): Promise<void> {
  const relative = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(relative).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const data = await fs.promises.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': contentTypeFor(filePath),
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

function listLanIPv4(): string[] {
  const result: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        result.push(entry.address);
      }
    }
  }
  return result;
}
