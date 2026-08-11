import type { ClientMessage, NetMessage, ServerMessage } from './protocol.js';

/** 把消息编成 WebSocket 文本帧（JSON）。Fx 即为 number，无需额外转换。 */
export function encodeMessage(message: NetMessage): string {
  return JSON.stringify(message);
}

/** 解析客户端上行消息；非法 payload 返回 null。 */
export function decodeClientMessage(raw: string): ClientMessage | null {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const type = (parsed as { type?: unknown }).type;
  if (
    type === 'join' ||
    type === 'rejoin' ||
    type === 'listRooms' ||
    type === 'input' ||
    type === 'hash' ||
    type === 'ping'
  ) {
    return parsed as ClientMessage;
  }
  return null;
}

/** 解析服务端下行消息；非法 payload 返回 null。 */
export function decodeServerMessage(raw: string): ServerMessage | null {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const type = (parsed as { type?: unknown }).type;
  if (
    type === 'welcome' ||
    type === 'roomList' ||
    type === 'start' ||
    type === 'frame' ||
    type === 'desync' ||
    type === 'peerDisconnected' ||
    type === 'peerReconnected' ||
    type === 'peerLeft' ||
    type === 'matchEnd' ||
    type === 'pong' ||
    type === 'error'
  ) {
    return parsed as ServerMessage;
  }
  return null;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
