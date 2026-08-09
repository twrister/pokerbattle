import { DEFAULT_INPUT_DELAY, decodeServerMessage, encodeMessage, type ServerMessage } from '@pb/net';
import type { Faction } from '@pb/sim';
import { NetSimLoop } from './netLoop.js';

export interface VersusSession {
  loop: NetSimLoop;
  faction: Faction;
  seat: number;
  close: () => void;
}

export interface ConnectVersusOptions {
  name?: string;
  roomId?: string;
  onStatus?: (text: string) => void;
  onDesync?: (tick: number, serverHash: number) => void;
  onPeerLeft?: () => void;
}

/**
 * 连接同源 /ws（经 vite 代理到权威服），完成入座后返回 NetSimLoop。
 * 两人到齐前 Promise 挂起；收到带 seed 的 welcome 与 start 后 resolve。
 */
export function connectVersusSession(options: ConnectVersusOptions = {}): Promise<VersusSession> {
  const status = options.onStatus ?? (() => {});
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  return new Promise((resolve, reject) => {
    status('正在连接联机服务…');
    const ws = new WebSocket(wsUrl);
    let settled = false;
    let loop: NetSimLoop | null = null;
    let faction: Faction | null = null;
    let seat = 0;
    /** welcome 建好 loop 前可能先到的下行，建好后立刻回放。 */
    const pending: ServerMessage[] = [];

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(error);
    };

    const finish = (active: NetSimLoop, side: Faction): void => {
      if (settled) return;
      settled = true;
      status('对局开始');
      resolve({
        loop: active,
        faction: side,
        seat,
        close: () => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        },
      });
    };

    ws.addEventListener('open', () => {
      status('已连接，等待对手加入…');
      ws.send(
        encodeMessage({
          type: 'join',
          roomId: options.roomId ?? 'default',
          name: options.name ?? `player-${Math.floor(Math.random() * 1000)}`,
        }),
      );
    });

    ws.addEventListener('error', () => {
      fail(new Error('无法连接联机服务，请确认已运行 pnpm dev:online'));
    });

    ws.addEventListener('close', () => {
      if (!settled) fail(new Error('连接已断开'));
    });

    ws.addEventListener('message', (event) => {
      const raw = String(event.data);
      const message = decodeServerMessage(raw);
      if (!message) return;

      if (message.type === 'welcome') {
        if (message.seed === 0) {
          seat = message.seat;
          faction = message.faction;
          status(`已入座（${message.faction === 0 ? '蓝方' : '红方'}），等待对手…`);
          return;
        }
        seat = message.seat;
        faction = message.faction;
        status('对手已就绪，正在开局…');
        loop = new NetSimLoop({
          seed: message.seed,
          faction: message.faction,
          inputDelay: message.inputDelay || DEFAULT_INPUT_DELAY,
          send: (text) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(text);
          },
          onDesync: options.onDesync,
          onPeerLeft: () => {
            options.onPeerLeft?.();
          },
        });
        for (const queued of pending.splice(0)) {
          loop.handleServerMessage(queued);
          // faction 可能为 0（蓝方），不能用真假值判断
          if (queued.type === 'start' && faction !== null) finish(loop, faction);
        }
        return;
      }

      if (!loop) {
        pending.push(message);
        return;
      }

      loop.handleServerMessage(message);
      // Faction.Blue === 0，用 != null 避免蓝方永远不 resolve
      if (message.type === 'start' && faction !== null) finish(loop, faction);
    });
  });
}
