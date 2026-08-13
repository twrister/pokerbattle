import { decodeClientMessage, encodeMessage } from '@pb/net';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import type { OpsServerStatus } from './opsTypes.js';
import { LobbyPresence } from './lobbyPresence.js';
import { RoomManager, sendRoomError } from './roomManager.js';
import { serveStatic } from './staticServer.js';

const PORT = Number(process.env.PORT) || 9090;
/** 监听所有网卡，便于本机 Vite 代理与排查；局域网玩家仍应走正式服 HTTP 入口。 */
const HOST = process.env.HOST || '0.0.0.0';
const STARTED_AT = Date.now();
/** 生产包由 nginx 去前缀反代，应用路由必须挂在根路径，禁止再 redirect 到子路径。 */
const IS_PROD = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
/** systemd WorkingDirectory 为 app/，生产静态资源在 app/dist。 */
const DIST_DIR = process.env.DIST_DIR || path.resolve(process.cwd(), 'dist');

/** 本地联机：多房间并行，支持快速匹配与自定义房号，以及短时断线重连。 */
const rooms = new RoomManager();
/** 未入联机房的大厅 presence，与房间席位分开计数。 */
const lobby = new LobbyPresence();

/**
 * 用 HTTP 承载 WS：/health、/ops/status；生产环境同时提供前端静态资源。
 * 玩家仍走同源 /ws（nginx 去前缀后落到本进程）。
 */
const httpServer = http.createServer((req, res) => {
  const method = req.method ?? 'GET';
  const isRead = method === 'GET' || method === 'HEAD';
  const pathname = requestPath(req);

  if (isRead && pathname === '/health') {
    writeJson(res, 200, { ok: true });
    return;
  }
  if (isRead && pathname === '/ops/status') {
    writeJson(res, 200, buildOpsStatus());
    return;
  }
  if (IS_PROD && isRead) {
    serveStatic(res, DIST_DIR, pathname);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws) => {
  let handshaked = false;
  ws.on('close', () => {
    lobby.remove(ws);
  });
  ws.on('message', (data) => {
    const text = typeof data === 'string' ? data : data.toString();
    const message = decodeClientMessage(text);
    if (!message) return;

    // 列表查询不占用握手，便于同一连接先拉列表再 join
    if (message.type === 'listRooms') {
      if (ws.readyState === ws.OPEN) {
        ws.send(encodeMessage({ type: 'roomList', rooms: rooms.listJoinable() }));
      }
      return;
    }

    // 大厅 presence：可与 listRooms 共用连接，入房前计入 lobbyPlayers
    if (message.type === 'lobby') {
      if (!handshaked) lobby.add(ws);
      return;
    }

    if (handshaked) return;

    if (message.type === 'join') {
      handshaked = true;
      lobby.remove(ws);
      const result = rooms.join(ws, message);
      if (!result.ok && result.error) {
        sendRoomError(ws, result.error);
        ws.close(4000, result.error.code);
      }
      return;
    }

    if (message.type === 'rejoin') {
      handshaked = true;
      lobby.remove(ws);
      const result = rooms.rejoin(ws, message);
      if (!result.ok && result.error) {
        sendRoomError(ws, result.error);
        ws.close(4001, result.error.code);
      }
    }
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`[pb-server] ws://${HOST === '0.0.0.0' ? '0.0.0.0' : HOST}:${PORT}  (multi-room + reconnect)`);
  console.log(`[pb-server] ops status: http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}/ops/status`);
  const lanIps = listLanIPv4();
  if (lanIps.length === 0) {
    console.log('[pb-server] 未检测到局域网 IPv4；本机请用 http://localhost:9080/');
    return;
  }
  // 玩家浏览器应打开正式服页面，同源 /ws 再由 Vite 代理到本进程
  console.log('[pb-server] 局域网联机：其他设备请打开正式服地址（不要直连 9090）：');
  for (const ip of lanIps) {
    console.log(`[pb-server]   http://${ip}:9080/`);
  }
});

process.on('SIGINT', () => {
  rooms.dispose();
  wss.close();
  httpServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  rooms.dispose();
  wss.close();
  httpServer.close();
  process.exit(0);
});

/** 组装运维状态载荷，连接数取自当前 WS 客户端集合。 */
function buildOpsStatus(): OpsServerStatus {
  return {
    ok: true,
    startedAt: STARTED_AT,
    uptimeMs: Date.now() - STARTED_AT,
    host: HOST,
    port: PORT,
    connectionCount: wss.clients.size,
    lobbyPlayers: lobby.size,
    summary: rooms.summarizeOps(),
    rooms: rooms.listOpsSnapshots(),
  };
}

/** 解析请求路径，忽略 query，避免 /health? 匹配失败。 */
function requestPath(req: http.IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

/** 写出 JSON 响应，供运维站与健康探测使用。 */
function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

/** 列出非内部 IPv4，供启动日志提示局域网入口。 */
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
