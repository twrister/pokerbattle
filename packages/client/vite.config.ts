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

export default defineConfig({
  plugins: [unitConfigWritePlugin(), cardFormationWritePlugin()],
  // 开发服：host: true 监听所有网卡，局域网可访问；开放配置写回等调试能力
  // /ws 代理到权威服务器，前端统一连同源路径，避免跨域与双端口硬编码
  server: {
    host: true,
    port: 8081,
    open: true,
    proxy: {
      '/ws': { target: 'ws://localhost:8090', ws: true },
    },
  },
  // 与 sim 一样直接吃 TS 源码，改协议可热更新
  optimizeDeps: { exclude: ['@pb/sim', '@pb/net'] },
  // 正式服：预览 build 产物，隐藏单位参数 / 单机运行控制 / 卡组编辑入口
  preview: { host: true, port: 8080, strictPort: true },
  build: { target: 'es2022' },
});
