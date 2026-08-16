import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

const clientDir = path.dirname(fileURLToPath(import.meta.url));
/** monorepo 内 sim 兵种配置的唯一落盘路径 */
const unitsJsonPath = path.resolve(clientDir, '../sim/src/config/units.json');
/** monorepo 内牌型阵型配置的唯一落盘路径 */
const cardFormationsJsonPath = path.resolve(clientDir, '../sim/src/config/cardFormations.json');
/** monorepo 内场景配置的唯一落盘路径 */
const arenaJsonPath = path.resolve(clientDir, '../sim/src/config/arena.json');
const arena2v2JsonPath = path.resolve(clientDir, '../sim/src/config/arena2v2.json');

/** 开发服务器：GET 读盘最新 units.json，POST 覆盖写回。 */
function unitConfigWritePlugin(): Plugin {
  return {
    name: 'pb-unit-config-write',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/__pb/unit-configs') {
          next();
          return;
        }
        if (req.method === 'GET') {
          try {
            const text = fs.readFileSync(unitsJsonPath, 'utf8');
            let parsed: unknown;
            try {
              parsed = JSON.parse(text);
            } catch {
              sendJson(res, 500, { error: 'units.json is not valid JSON' });
              return;
            }
            sendJson(res, 200, parsed);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { error: message });
          }
          return;
        }
        if (req.method !== 'POST') {
          next();
          return;
        }
        readRequestBody(req)
          .then((raw) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              sendJson(res, 400, { error: 'invalid JSON' });
              return;
            }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              sendJson(res, 400, { error: 'body must be a JSON object' });
              return;
            }
            const text = `${JSON.stringify(parsed, null, 2)}\n`;
            fs.writeFileSync(unitsJsonPath, text, 'utf8');
            sendJson(res, 200, { ok: true });
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { error: message });
          });
      });
    },
  };
}

/** 开发服务器：接收卡组页保存请求，覆盖 cardFormations.json。 */
function cardFormationWritePlugin(): Plugin {
  return {
    name: 'pb-card-formation-write',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/__pb/card-formations' || req.method !== 'POST') {
          next();
          return;
        }
        readRequestBody(req)
          .then((raw) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              sendJson(res, 400, { error: 'invalid JSON' });
              return;
            }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              sendJson(res, 400, { error: 'body must be a JSON object' });
              return;
            }
            fs.writeFileSync(cardFormationsJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
            sendJson(res, 200, { ok: true });
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { error: message });
          });
      });
    },
  };
}

/** 收集 POST body 文本 */
function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

/** 开发服务器：接收场景配置页保存请求，覆盖 arena.json。 */
function arenaConfigWritePlugin(): Plugin {
  return {
    name: 'pb-arena-config-write',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/__pb/arena-config' || req.method !== 'POST') {
          next();
          return;
        }
        readRequestBody(req)
          .then((raw) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              sendJson(res, 400, { error: 'invalid JSON' });
              return;
            }
            const wrapped = parsed as { mode?: unknown; draft?: unknown };
            const mode = wrapped.mode === '2v2' ? '2v2' : wrapped.mode === '1v1' ? '1v1' : null;
            const draft = mode && wrapped.draft ? wrapped.draft : parsed;
            const validationError = validateArenaConfigBody(draft);
            if (validationError) {
              sendJson(res, 400, { error: validationError });
              return;
            }
            const target = mode === '2v2' ? arena2v2JsonPath : arenaJsonPath;
            fs.writeFileSync(target, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
            sendJson(res, 200, { ok: true });
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { error: message });
          });
      });
    },
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** 写盘前做结构校验，避免把残缺场景配置写进 arena.json。 */
function validateArenaConfigBody(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'body must be a JSON object';
  const draft = value as {
    width?: unknown;
    height?: unknown;
    riverWidth?: unknown;
    bridges?: unknown;
    bridge3Enabled?: unknown;
    bases?: unknown;
    camera?: { mode?: unknown };
    colors?: unknown;
  };
  if (!Number.isInteger(draft.width) || (draft.width as number) <= 0) return 'width must be a positive integer';
  if (!Number.isInteger(draft.height) || (draft.height as number) <= 0) return 'height must be a positive integer';
  if (!Number.isInteger(draft.riverWidth) || (draft.riverWidth as number) <= 0) {
    return 'riverWidth must be a positive integer';
  }
  if (!Array.isArray(draft.bridges) || draft.bridges.length === 0) return 'bridges must be a non-empty array';
  if (draft.bridge3Enabled !== undefined && typeof draft.bridge3Enabled !== 'boolean') {
    return 'bridge3Enabled must be a boolean';
  }
  if (draft.bases !== undefined && !Array.isArray(draft.bases)) return 'bases must be an array';
  if (draft.camera?.mode !== 'ortho' && draft.camera?.mode !== 'perspective') {
    return 'camera.mode must be ortho or perspective';
  }
  if (!draft.colors || typeof draft.colors !== 'object') return 'colors must be an object';
  return undefined;
}

/** 开发服与正式预览共用：把同源 /ws 转到权威服，前端无需写死双端口。 */
const wsProxy = {
  '/ws': { target: 'ws://localhost:9090', ws: true },
} as const;

/** 部署到子路径时由 VITE_PUBLIC_BASE 注入（如 /poker-battle），本地开发保持根路径。 */
function resolvePublicBase(): string {
  const raw = process.env.VITE_PUBLIC_BASE?.trim();
  if (!raw) return '/';
  return raw.endsWith('/') ? raw : `${raw}/`;
}

/** 部署脚本传入 VITE_APP_VERSION；本地开发回落根 package.json。 */
function resolveAppVersion(): string {
  const fromEnv = process.env.VITE_APP_VERSION?.trim();
  if (fromEnv) return fromEnv;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(clientDir, '../../package.json'), 'utf8')) as {
      version?: unknown;
    };
    if (typeof pkg.version === 'string' && pkg.version.trim()) return pkg.version.trim();
  } catch {
    /* 回落默认种子 */
  }
  return '0.1.0';
}

export default defineConfig({
  base: resolvePublicBase(),
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(resolveAppVersion()),
  },
  plugins: [unitConfigWritePlugin(), cardFormationWritePlugin(), arenaConfigWritePlugin()],
  // 开发服：host: true 监听所有网卡，局域网可访问；开放配置写回等调试能力
  server: {
    host: true,
    port: 9081,
    open: true,
    proxy: { ...wsProxy },
  },
  // 与 sim 一样直接吃 TS 源码，改协议可热更新
  optimizeDeps: { exclude: ['@pb/sim', '@pb/net'] },
  // 正式服：预览 build 产物；监听全部网卡并代理 /ws，供局域网经 IP 访问
  preview: {
    host: '0.0.0.0',
    port: 9080,
    strictPort: true,
    // 允许机器名访问；纯 IP 默认已放行
    allowedHosts: true,
    proxy: { ...wsProxy },
  },
  build: { target: 'es2022' },
});
