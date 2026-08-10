import {
  DEFAULT_INPUT_DELAY,
  HASH_INTERVAL_TICKS,
  encodeMessage,
  type ClientMessage,
  type ServerMessage,
} from '@pb/net';
import { MatchState, TICK_RATE, type Command, type Faction } from '@pb/sim';
import type { WebSocket } from 'ws';
import { factionForSeat, validateSeatCommand } from './validate.js';

const STEP_MS = 1000 / TICK_RATE;

interface Seat {
  ws: WebSocket;
  name: string;
  faction: Faction;
  seat: number;
}

/**
 * 单房间权威循环：两人到齐开局，20Hz 匀速推进，不等待任何客户端。
 * 迟到输入顺延到下一个尚未播发的 tick。
 */
export class MatchRoom {
  private readonly seats: Array<Seat | null> = [null, null];
  private match: MatchState | null = null;
  private seed = 0;
  private serverTick = 0;
  private started = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** tick → 已接受的指令列表（按入座顺序追加，保证确定性）。 */
  private readonly scheduled = new Map<number, Command[]>();
  private readonly serverHashes = new Map<number, number>();

  /** 处理新连接的 join；房间满则关闭。 */
  handleJoin(ws: WebSocket, name: string): void {
    const seatIndex = this.seats.findIndex((seat) => seat === null);
    if (seatIndex < 0) {
      ws.close(4000, 'room full');
      return;
    }

    const faction = factionForSeat(seatIndex);
    const seat: Seat = { ws, name, faction, seat: seatIndex };
    this.seats[seatIndex] = seat;

    ws.on('close', () => this.handleLeave(seatIndex));
    ws.on('message', (data) => {
      const text = typeof data === 'string' ? data : data.toString();
      this.handleClientMessage(seatIndex, text);
    });

    if (this.seats[0] && this.seats[1] && !this.started) {
      this.beginMatch();
    } else if (!this.started) {
      // 先入座者只收到 welcome，等对手
      this.send(ws, {
        type: 'welcome',
        seat: seatIndex,
        faction,
        seed: 0,
        inputDelay: DEFAULT_INPUT_DELAY,
      });
    }
  }

  /** 停止定时器（进程退出时用）。 */
  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private beginMatch(): void {
    this.started = true;
    this.seed = (Date.now() ^ (Math.random() * 0x7fffffff)) | 0;
    if (this.seed === 0) this.seed = 0x9e3779b9;
    this.match = new MatchState(this.seed);
    this.match.seedStartingCastles();
    this.serverTick = 0;
    this.scheduled.clear();
    this.serverHashes.clear();

    for (const seat of this.seats) {
      if (!seat) continue;
      this.send(seat.ws, {
        type: 'welcome',
        seat: seat.seat,
        faction: seat.faction,
        seed: this.seed,
        inputDelay: DEFAULT_INPUT_DELAY,
      });
    }

    // 首个逻辑帧从 1 开始；客户端收到 start 后按 frame 驱动
    this.broadcast({ type: 'start', startTick: 1 });
    this.timer = setInterval(() => this.tickOnce(), STEP_MS);
  }

  private tickOnce(): void {
    if (!this.match) return;
    this.serverTick += 1;
    const tick = this.serverTick;
    const commands = this.scheduled.get(tick) ?? [];
    this.scheduled.delete(tick);

    this.match.step(commands);
    this.broadcast({ type: 'frame', tick, commands });

    if (this.match.result) {
      this.broadcast({
        type: 'matchEnd',
        endTick: this.match.result.endTick,
        winner: this.match.result.winner,
        reason: this.match.result.reason,
      });
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.scheduled.clear();
      return;
    }

    if (tick % HASH_INTERVAL_TICKS === 0) {
      this.serverHashes.set(tick, this.match.hash());
    }
  }

  private handleClientMessage(seatIndex: number, raw: string): void {
    const seat = this.seats[seatIndex];
    if (!seat || !this.match) return;

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }

    switch (message.type) {
      case 'ping':
        this.send(seat.ws, { type: 'pong', t: message.t });
        break;
      case 'input':
        this.acceptInput(seat, message.tick, message.commands ?? []);
        break;
      case 'hash':
        this.checkHash(seat, message.tick, message.hash);
        break;
      default:
        break;
    }
  }

  /** 输入排到 max(serverTick+1, T)；非法指令静默丢弃。 */
  private acceptInput(seat: Seat, tick: number, commands: Command[]): void {
    if (!this.match || !this.started || this.match.result) return;
    const targetTick = Math.max(this.serverTick + 1, tick | 0);
    const accepted: Command[] = [];
    for (const command of commands) {
      if (!validateSeatCommand(this.match, seat.faction, command)) {
        console.warn(
          `[rejected] seat=${seat.seat} faction=${seat.faction} tick=${targetTick} kind=${command.kind}`,
        );
        continue;
      }
      accepted.push(command);
    }
    if (accepted.length === 0) return;
    const bucket = this.scheduled.get(targetTick) ?? [];
    // 蓝座指令在前，红座在后，保证同 tick 合并顺序稳定
    if (seat.seat === 0) bucket.unshift(...accepted);
    else bucket.push(...accepted);
    this.scheduled.set(targetTick, bucket);
  }

  private checkHash(seat: Seat, tick: number, clientHash: number): void {
    const serverHash = this.serverHashes.get(tick);
    if (serverHash === undefined) return;
    if (serverHash === clientHash) return;
    console.warn(`[desync] seat=${seat.seat} tick=${tick} server=${serverHash} client=${clientHash}`);
    this.send(seat.ws, { type: 'desync', tick, serverHash });
  }

  private handleLeave(seatIndex: number): void {
    this.seats[seatIndex] = null;
    if (!this.started) return;
    this.broadcast({ type: 'peerLeft' });
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
    this.match = null;
    // 清空另一座位，方便下一对玩家重新配对
    for (let i = 0; i < this.seats.length; i += 1) {
      const other = this.seats[i];
      if (other) {
        try {
          other.ws.close();
        } catch {
          /* ignore */
        }
        this.seats[i] = null;
      }
    }
  }

  private broadcast(message: ServerMessage): void {
    const raw = encodeMessage(message);
    for (const seat of this.seats) {
      if (seat && seat.ws.readyState === seat.ws.OPEN) seat.ws.send(raw);
    }
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(encodeMessage(message));
  }
}
