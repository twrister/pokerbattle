import { decodeClientMessage, encodeMessage } from '@pb/net';
import os from 'node:os';
import { WebSocketServer } from 'ws';
import { RoomManager, sendRoomError } from './roomManager.js';

const PORT = Number(process.env.PORT) || 8090;
/** 监听所有网卡，便于本机 Vite 代理与排查；局域网玩家仍应走正式服 HTTP 入口。 */
const HOST = process.env.HOST || '0.0.0.0';

/** 本地联机：多房间并行，支持快速匹配与自定义房号，以及短时断线重连。 */
const rooms = new RoomManager();
const wss = new WebSocketServer({ host: HOST, port: PORT });

wss.on('connection', (ws) => {
  let handshaked = false;
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

    if (handshaked) return;

    if (message.type === 'join') {
      handshaked = true;
      const result = rooms.join(ws, message);
      if (!result.ok && result.error) {
        sendRoomError(ws, result.error);
        ws.close(4000, result.error.code);
      }
      return;
    }

    if (message.type === 'rejoin') {
      handshaked = true;
      const result = rooms.rejoin(ws, message);
      if (!result.ok && result.error) {
        sendRoomError(ws, result.error);
        ws.close(4001, result.error.code);
      }
    }
  });
});

wss.on('listening', () => {
  console.log(`[pb-server] ws://${HOST === '0.0.0.0' ? '0.0.0.0' : HOST}:${PORT}  (multi-room + reconnect)`);
  const lanIps = listLanIPv4();
  if (lanIps.length === 0) {
    console.log('[pb-server] 未检测到局域网 IPv4；本机请用 http://localhost:8080/');
    return;
  }
  // 玩家浏览器应打开正式服页面，同源 /ws 再由 Vite 代理到本进程
  console.log('[pb-server] 局域网联机：其他设备请打开正式服地址（不要直连 8090）：');
  for (const ip of lanIps) {
    console.log(`[pb-server]   http://${ip}:8080/`);
  }
});

process.on('SIGINT', () => {
  rooms.dispose();
  wss.close();
  process.exit(0);
});

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
