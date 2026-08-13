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

/** 开发服务器：接收面板 POST，覆盖 units.json */
function unitConfigWritePlugin(): Plugin {
  return {
    name: 'pb-unit-config-write',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/__pb/unit-configs' || req.method !== 'POST') {
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
            const validationError = validateUnitLevels(parsed);
            if (validationError) {
              sendJson(res, 400, { error: validationError });
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** 在写盘前阻止空等级、负等级等配置错误，避免开发期误写坏 units.json。 */
function validateUnitLevels(value: object): string | undefined {
  for (const [typeId, draft] of Object.entries(value)) {
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
      return `${typeId} must be a config object`;
    }
    const levels = (draft as { levels?: unknown }).levels;
    if (levels === undefined) continue;
    if (!levels || typeof levels !== 'object' || Array.isArray(levels)) {
      return `${typeId}.levels must be an object`;
    }
    const keys = Object.keys(levels);
    if (
      keys.length === 0
      || keys.some((key) => !Number.isInteger(Number(key)) || Number(key) < 1)
    ) {
      return `${typeId}.levels must contain positive integer keys`;
    }
  }
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

export default defineConfig({
  base: resolvePublicBase(),
  plugins: [unitConfigWritePlugin(), cardFormationWritePlugin()],
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
