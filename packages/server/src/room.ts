import {
  BOTH_OFFLINE_CLOSE_MS,
  DEFAULT_INPUT_DELAY,
  HASH_INTERVAL_TICKS,
  RECONNECT_TIMEOUT_MS,
  encodeMessage,
  type ClientMessage,
  type RoomListEntry,
  type ServerMessage,
} from '@pb/net';
import { MatchState, TICK_RATE, type Command, type Faction } from '@pb/sim';
import { randomBytes } from 'node:crypto';
import type { RawData, WebSocket } from 'ws';
import type { OpsRoomPhase, OpsRoomSnapshot } from './opsTypes.js';
import { factionForSeat, validateSeatCommand } from './validate.js';

const STEP_MS = 1000 / TICK_RATE;
/** 断线补帧至少覆盖重连窗口，略留余量避免边界丢帧。 */
const MAX_FRAME_HISTORY = Math.ceil((RECONNECT_TIMEOUT_MS / 1000) * TICK_RATE) + TICK_RATE;
const MAX_PLAYERS = 2;

interface Seat {
  ws: WebSocket | null;
  name: string;
  faction: Faction;
  seat: number;
  /** 不可预测令牌，仅本席重连可用。 */
  reconnectToken: string;
  connected: boolean;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  /** 避免同一连接 close 被重复处理。 */
  closeHandler: (() => void) | null;
  messageHandler: ((data: RawData) => void) | null;
}

export interface MatchRoomOptions {
  roomId: string;
  roomName: string;
  /** 房间变空或对局因超时结束并清场后回调，供管理器回收。 */
  onDispose?: (roomId: string) => void;
}

/**
 * 单房间权威循环：两人到齐开局，20Hz 匀速推进。
 * 对局中断线保留席位并继续 tick，凭令牌在窗口内补帧恢复。
 */
export class MatchRoom {
  readonly roomId: string;
  readonly roomName: string;
  private readonly onDispose?: (roomId: string) => void;
  private readonly seats: Array<Seat | null> = [null, null];
  private match: MatchState | null = null;
  private seed = 0;
  private serverTick = 0;
  private started = false;
  private ended = false;
  private disposed = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 双方均离线时的关房倒计时；任一方重连则取消。 */
  private bothOfflineTimer: ReturnType<typeof setTimeout> | null = null;
  /** 房间创建时刻，供运维页展示存活时长。 */
  private readonly createdAt = Date.now();
  /** 最近一次席位/消息活跃时间，用于判断僵尸房。 */
  private lastActiveAt = Date.now();
  /** tick → 已接受的指令列表（按入座顺序追加，保证确定性）。 */
  private readonly scheduled = new Map<number, Command[]>();
  private readonly serverHashes = new Map<number, number>();
  /** 本局权威帧历史，供断线重连按 lastTick 补发。 */
  private readonly frameHistory = new Map<number, Command[]>();

  constructor(options: MatchRoomOptions) {
    this.roomId = options.roomId;
    this.roomName = options.roomName;
    this.onDispose = options.onDispose;
  }

  /** 未开局且仍有空座时可加入。 */
  get canJoin(): boolean {
    return !this.disposed && !this.started && this.seats.some((seat) => seat === null);
  }

  /** 无人在座（含离线席）时视为空房。 */
  get isEmpty(): boolean {
    return this.seats.every((seat) => seat === null);
  }

  /** 已占用席位数（含断线保留席）。 */
  get playerCount(): number {
    return this.seats.filter((seat) => seat !== null).length;
  }

  /** 供大厅列表展示的摘要。 */
  toListEntry(): RoomListEntry {
    return {
      roomId: this.roomId,
      roomName: this.roomName,
      playerCount: this.playerCount,
      maxPlayers: MAX_PLAYERS,
    };
  }

  /**
   * 导出运维快照：包含阶段、tick、席位连接状态与活跃时间。
   * 故意不包含 reconnectToken，避免经 HTTP 状态接口泄漏。
   */
  toOpsSnapshot(): OpsRoomSnapshot {
    const seats = this.seats
      .filter((seat): seat is Seat => seat !== null)
      .map((seat) => ({
        seat: seat.seat,
        name: seat.name,
        faction: seat.faction,
        connected: seat.connected,
      }));
    return {
      roomId: this.roomId,
      roomName: this.roomName,
      phase: this.opsPhase(),
      serverTick: this.serverTick,
      playerCount: this.playerCount,
      connectedCount: seats.filter((seat) => seat.connected).length,
      maxPlayers: MAX_PLAYERS,
      seats,
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt,
    };
  }

  /** 处理新连接的 join；成功返回 true，满员/已开局返回 false。 */
  handleJoin(ws: WebSocket, name: string): boolean {
    if (this.disposed || this.started) return false;
    const seatIndex = this.seats.findIndex((seat) => seat === null);
    if (seatIndex < 0) return false;

    const faction = factionForSeat(seatIndex);
    const seat: Seat = {
      ws,
      name,
      faction,
      seat: seatIndex,
      reconnectToken: createReconnectToken(),
      connected: true,
      disconnectTimer: null,
      closeHandler: null,
      messageHandler: null,
    };
    this.seats[seatIndex] = seat;
    this.touchActive();
    this.bindSocket(seat);

    if (this.seats[0] && this.seats[1] && !this.started) {
      this.beginMatch();
    } else if (!this.started) {
      this.sendWelcome(seat, 0);
    }
    return true;
  }

  /**
   * 用令牌恢复席位：校验通过后重绑 socket，并补发 lastTick 之后的权威帧。
   * 返回 false 表示令牌无效、窗口已过或房间已清理。
   */
  handleRejoin(ws: WebSocket, token: string, lastTick: number): boolean {
    if (this.disposed || !this.started) return false;
    const seat = this.seats.find((entry) => entry?.reconnectToken === token) ?? null;
    if (!seat || seat.connected) return false;

    this.clearDisconnectTimer(seat);
    seat.ws = ws;
    seat.connected = true;
    this.touchActive();
    this.bindSocket(seat);
    this.syncBothOfflineTimer();

    this.sendWelcome(seat, this.seed);
    this.replayFrom(seat, lastTick | 0);
    this.broadcastExcept(seat.seat, { type: 'peerReconnected' });
    return true;
  }

  /** 停止定时器与断线计时，释放本房资源。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.clearBothOfflineTimer();
    for (const seat of this.seats) {
      if (!seat) continue;
      this.clearDisconnectTimer(seat);
      this.unbindSocket(seat);
    }
    this.seats[0] = null;
    this.seats[1] = null;
    this.match = null;
    this.scheduled.clear();
    this.serverHashes.clear();
    this.frameHistory.clear();
    this.onDispose?.(this.roomId);
  }

  private beginMatch(): void {
    this.started = true;
    this.ended = false;
    this.seed = (Date.now() ^ (Math.random() * 0x7fffffff)) | 0;
    if (this.seed === 0) this.seed = 0x9e3779b9;
    this.match = new MatchState(this.seed);
    this.match.seedStartingCastles();
    this.serverTick = 0;
    this.scheduled.clear();
    this.serverHashes.clear();
    this.frameHistory.clear();

    for (const seat of this.seats) {
      if (!seat) continue;
      this.sendWelcome(seat, this.seed);
    }

    // 首个逻辑帧从 1 开始；客户端收到 start 后按 frame 驱动
    this.broadcast({ type: 'start', startTick: 1 });
    this.timer = setInterval(() => this.tickOnce(), STEP_MS);
  }

  private tickOnce(): void {
    if (!this.match || this.ended) return;
    this.serverTick += 1;
    const tick = this.serverTick;
    const commands = this.scheduled.get(tick) ?? [];
    this.scheduled.delete(tick);

    this.match.step(commands);
    this.frameHistory.set(tick, commands);
    this.trimFrameHistory();
    this.broadcast({ type: 'frame', tick, commands });

    if (this.match.result) {
      this.ended = true;
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
    if (!seat || !seat.connected || !this.match) return;

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }

    // 仅把合法协议消息记为活跃，避免乱包刷活跃时间
    if (
      message.type === 'ping' ||
      message.type === 'input' ||
      message.type === 'hash'
    ) {
      this.touchActive();
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
    if (!this.match || !this.started || this.ended || this.match.result) return;
    const targetTick = Math.max(this.serverTick + 1, tick | 0);
    const accepted: Command[] = [];
    for (const command of commands) {
      if (!validateSeatCommand(this.match, seat.faction, command)) {
        console.warn(
          `[rejected] room=${this.roomId} seat=${seat.seat} faction=${seat.faction} tick=${targetTick} kind=${command.kind}`,
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
    console.warn(
      `[desync] room=${this.roomId} seat=${seat.seat} tick=${tick} server=${serverHash} client=${clientHash}`,
    );
    this.send(seat.ws, { type: 'desync', tick, serverHash });
  }

  /** 连接断开：开局前/已结算直接腾座；对局中进入 30s 重连窗口并继续推进。 */
  private handleDisconnect(seatIndex: number): void {
    const seat = this.seats[seatIndex];
    if (!seat || !seat.connected) return;

    this.unbindSocket(seat);
    seat.ws = null;
    seat.connected = false;
    this.touchActive();

    // 未开局或已结算：无需重连，腾出座位并在空房时回收
    if (!this.started || this.ended) {
      this.clearDisconnectTimer(seat);
      this.seats[seatIndex] = null;
      if (this.isEmpty) this.dispose();
      return;
    }

    this.broadcastExcept(seatIndex, { type: 'peerDisconnected' });
    this.clearDisconnectTimer(seat);
    seat.disconnectTimer = setTimeout(() => {
      this.finishDisconnectedSeat(seatIndex);
    }, RECONNECT_TIMEOUT_MS);
    // 双方都掉线时缩短为空房倒计时，避免空转占满重连窗口
    this.syncBothOfflineTimer();
  }

  /** 重连超时：通知对手并清场，不影响其他房间。 */
  private finishDisconnectedSeat(seatIndex: number): void {
    const seat = this.seats[seatIndex];
    if (!seat || seat.connected) return;
    this.closeRoomDueToDisconnect();
  }

  /** 是否所有在座席位都已离线。 */
  private areAllSeatedPlayersOffline(): boolean {
    const seated = this.seats.filter((entry): entry is Seat => entry !== null);
    return seated.length > 0 && seated.every((seat) => !seat.connected);
  }

  /** 双方离线则启动短倒计时关房；否则取消。 */
  private syncBothOfflineTimer(): void {
    this.clearBothOfflineTimer();
    if (this.disposed || !this.started || this.ended) return;
    if (!this.areAllSeatedPlayersOffline()) return;
    this.bothOfflineTimer = setTimeout(() => {
      this.bothOfflineTimer = null;
      if (this.disposed || !this.areAllSeatedPlayersOffline()) return;
      this.closeRoomDueToDisconnect();
    }, BOTH_OFFLINE_CLOSE_MS);
  }

  private clearBothOfflineTimer(): void {
    if (!this.bothOfflineTimer) return;
    clearTimeout(this.bothOfflineTimer);
    this.bothOfflineTimer = null;
  }

  /** 因断线超时或双方离线而结束并清场。 */
  private closeRoomDueToDisconnect(): void {
    this.broadcast({ type: 'peerLeft' });
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.clearBothOfflineTimer();
    this.started = false;
    this.ended = true;
    this.match = null;

    for (let i = 0; i < this.seats.length; i += 1) {
      const other = this.seats[i];
      if (!other) continue;
      this.clearDisconnectTimer(other);
      this.unbindSocket(other);
      if (other.ws) {
        try {
          other.ws.close();
        } catch {
          /* ignore */
        }
      }
      this.seats[i] = null;
    }
    this.dispose();
  }

  private replayFrom(seat: Seat, lastTick: number): void {
    const fromTick = Math.max(0, lastTick) + 1;
    for (let tick = fromTick; tick <= this.serverTick; tick += 1) {
      const commands = this.frameHistory.get(tick);
      if (!commands) continue;
      this.send(seat.ws, { type: 'frame', tick, commands });
    }
    if (this.match?.result) {
      this.send(seat.ws, {
        type: 'matchEnd',
        endTick: this.match.result.endTick,
        winner: this.match.result.winner,
        reason: this.match.result.reason,
      });
    }
  }

  private trimFrameHistory(): void {
    const minKeep = this.serverTick - MAX_FRAME_HISTORY;
    if (minKeep <= 0) return;
    for (const tick of this.frameHistory.keys()) {
      if (tick < minKeep) this.frameHistory.delete(tick);
    }
  }

  private bindSocket(seat: Seat): void {
    if (!seat.ws) return;
    this.unbindSocket(seat);
    const closeHandler = (): void => this.handleDisconnect(seat.seat);
    const messageHandler = (data: RawData): void => {
      const text = typeof data === 'string' ? data : data.toString();
      this.handleClientMessage(seat.seat, text);
    };
    seat.closeHandler = closeHandler;
    seat.messageHandler = messageHandler;
    seat.ws.on('close', closeHandler);
    seat.ws.on('message', messageHandler);
  }

  private unbindSocket(seat: Seat): void {
    if (!seat.ws) return;
    if (seat.closeHandler) seat.ws.off('close', seat.closeHandler);
    if (seat.messageHandler) seat.ws.off('message', seat.messageHandler);
    seat.closeHandler = null;
    seat.messageHandler = null;
  }

  private clearDisconnectTimer(seat: Seat): void {
    if (!seat.disconnectTimer) return;
    clearTimeout(seat.disconnectTimer);
    seat.disconnectTimer = null;
  }

  private sendWelcome(seat: Seat, seed: number): void {
    this.send(seat.ws, {
      type: 'welcome',
      seat: seat.seat,
      faction: seat.faction,
      seed,
      inputDelay: DEFAULT_INPUT_DELAY,
      roomId: this.roomId,
      roomName: this.roomName,
      reconnectToken: seat.reconnectToken,
    });
  }

  private broadcast(message: ServerMessage): void {
    for (const seat of this.seats) {
      if (seat?.connected) this.send(seat.ws, message);
    }
  }

  private broadcastExcept(seatIndex: number, message: ServerMessage): void {
    for (const seat of this.seats) {
      if (seat && seat.seat !== seatIndex && seat.connected) this.send(seat.ws, message);
    }
  }

  private send(ws: WebSocket | null, message: ServerMessage): void {
    if (!ws || ws.readyState !== ws.OPEN) return;
    ws.send(encodeMessage(message));
  }

  /** 将私有状态映射为运维阶段枚举。 */
  private opsPhase(): OpsRoomPhase {
    if (this.ended) return 'ended';
    if (this.started) return 'playing';
    return 'waiting';
  }

  /** 刷新最近活跃时间，供运维站判断房间是否仍有人交互。 */
  private touchActive(): void {
    this.lastActiveAt = Date.now();
  }
}

/** 生成足够熵的重连令牌，避免被猜测占用席位。 */
function createReconnectToken(): string {
  return randomBytes(16).toString('hex');
}
