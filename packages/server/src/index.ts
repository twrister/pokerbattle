import { decodeClientMessage } from '@pb/net';
import { WebSocketServer } from 'ws';
import { MatchRoom } from './room.js';

const PORT = 8090;

/** 本地联机：单房间常驻，两人自动配对蓝/红。 */
const room = new MatchRoom();
const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  let joined = false;
  ws.on('message', (data) => {
    if (joined) return;
    const text = typeof data === 'string' ? data : data.toString();
    const message = decodeClientMessage(text);
    if (!message || message.type !== 'join') return;
    joined = true;
    room.handleJoin(ws, message.name || 'player');
  });
});

wss.on('listening', () => {
  console.log(`[pb-server] ws://localhost:${PORT}  (single room)`);
});

process.on('SIGINT', () => {
  room.dispose();
  wss.close();
  process.exit(0);
});
