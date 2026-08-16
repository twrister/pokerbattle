import {
  BOTH_OFFLINE_CLOSE_MS,
  DEFAULT_INPUT_DELAY,
  HASH_INTERVAL_TICKS,
  RECONNECT_TIMEOUT_MS,
  encodeMessage,
  type ClientMessage,
  type RoomListEntry,
  type RoomStateMessage,
  type ServerMessage,
} from '@pb/net';
import { MatchState, TICK_RATE, type Command, type Faction } from '@pb/sim';
import { randomBytes } from 'node:crypto';
import type { RawData, WebSocket } from 'ws';
import type { OpsRoomPhase, OpsRoomSnapshot } from './opsTypes.js';
import { resolveDecisiveMatch, type OnlinePresence } from './playerStatsStore.js';
import { factionForSeat, validateSeatCommand } from './validate.js';

const STEP_MS = 1000 / TICK_RATE;
/** 观战中途加入需要整局帧；15 分钟兜底防泄漏。 */
const MAX_FRAME_HISTORY = TICK_RATE * 60 * 15;
const MAX_PLAYERS = 2;

interface Seat {
  ws: WebSocket | null;
  name: string;
  /** 设备档案 ID；旧客户端未上报时为 null，本席不记服务端战绩。 */
  playerId: string | null;
  faction: Faction;
  seat: number;
  /** 不可预测令牌，仅本席重连可用。 */
  reconnectToken: string;
  /** 入座默认准备；结算回房后再次置为 true。 */
  ready: boolean;
  connected: boolean;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  /** 避免同一连接 close 被重复处理。 */
  closeHandler: (() => void) | null;
  messageHandler: ((data: RawData) => void) | null;
}

/** 观战连接：不占席、不发指令，只收帧与结算。 */
interface Spectator {
  ws: WebSocket;
  name: string;
  playerId: string | null;
  closeHandler: (() => void) | null;
  messageHandler: ((data: RawData) => void) | null;
}

export interface MatchRoomOptions {
  roomId: string;
  roomName: string;
  /** 房间变空或对局因超时结束并清场后回调，供管理器回收。 */
  onDispose?: (roomId: string) => void;
  /** 入座且带有 playerId 时登记昵称。 */
  onPlayerJoin?: (playerId: string, name: string) => void;
  /** 对局分出胜负且双方都有 playerId 时记账。 */
  onDecisiveMatch?: (
    winnerId: string,
    loserId: string,
    names: { winner: string; loser: string },
  ) => void;
}

/**
 * 单房间权威循环：入座默认准备，房主手动开局，20Hz 匀速推进。
 * 结算后回到 waiting 以便再开；对局中断线保留席位并补帧恢复。
 */
export class MatchRoom {
  readonly roomId: string;
  readonly roomName: string;
  private readonly onDispose?: (roomId: string) => void;
  private readonly onPlayerJoin?: (playerId: string, name: string) => void;
  private readonly onDecisiveMatch?: (
    winnerId: string,
    loserId: string,
    names: { winner: string; loser: string },
  ) => void;
  private readonly seats: Array<Seat | null> = [null, null];
  private readonly spectators: Spectator[] = [];
  /** 房主席位；创建者 / 先入座者为房主，离开后交给剩余席。 */
  private hostSeat = 0;
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
    this.onPlayerJoin = options.onPlayerJoin;
    this.onDecisiveMatch = options.onDecisiveMatch;
  }

  /** 未开局且仍有空座时可加入。 */
  get canJoin(): boolean {
    return !this.disposed && !this.started && this.seats.some((seat) => seat === null);
  }

  /** 对局进行中才允许观战。 */
  get canSpectate(): boolean {
    return !this.disposed && this.started && this.match !== null;
  }

  /** 当前观战连接数。 */
  get spectatorCount(): number {
    return this.spectators.length;
  }

  /** 当前权威仿真 hash；无对局时为 null。 */
  currentMatchHash(): number | null {
    return this.match ? this.match.hash() : null;
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
      phase: this.started ? 'playing' : 'waiting',
      spectatorCount: this.spectatorCount,
    };
  }

  /** 当前仍连着的席位，供运维站在线名单（不含断线保留席）。 */
  listOnlinePlayers(): OnlinePresence[] {
    return this.seats
      .filter((seat): seat is Seat => seat !== null && seat.connected)
      .map((seat) => ({
        playerId: seat.playerId,
        name: seat.name,
        location: 'room',
        roomId: this.roomId,
        roomName: this.roomName,
      }));
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
      spectatorCount: this.spectatorCount,
      maxPlayers: MAX_PLAYERS,
      seats,
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt,
    };
  }

  /** 处理新连接的 join；成功返回 true，满员/已开局返回 false。 */
  handleJoin(ws: WebSocket, name: string, playerId: string | null = null): boolean {
    if (this.disposed || this.started) return false;
    const seatIndex = this.seats.findIndex((seat) => seat === null);
    if (seatIndex < 0) return false;

    const faction = factionForSeat(seatIndex);
    const seat: Seat = {
      ws,
      name,
      playerId,
      faction,
      seat: seatIndex,
      reconnectToken: createReconnectToken(),
      ready: true,
      connected: true,
      disconnectTimer: null,
      closeHandler: null,
      messageHandler: null,
    };
    this.seats[seatIndex] = seat;
    // 空房第一人成为房主，避免沿用上一任已离开的 hostSeat
    if (this.playerCount === 1) this.hostSeat = seatIndex;
    this.touchActive();
    this.bindSocket(seat);
    if (playerId) this.onPlayerJoin?.(playerId, name);

    this.sendWelcome(seat, 0);
    this.broadcastRoomState();
    return true;
  }

  /** 重连前按令牌取席位身份，供 WS 在线表按设备 ID 登记。 */
  identityForReconnect(token: string): { playerId: string | null; name: string } | null {
    const seat = this.seats.find((entry) => entry?.reconnectToken === token) ?? null;
    if (!seat) return null;
    return { playerId: seat.playerId, name: seat.name };
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

  /**
   * 观战入房：不占席，补发种子与整局帧后跟随实时广播。
   * 未开局或已清场时返回 false。
   */
  handleSpectate(ws: WebSocket, name: string, playerId: string | null = null): boolean {
    if (!this.canSpectate) return false;
    const spectator: Spectator = {
      ws,
      name,
      playerId,
      closeHandler: null,
      messageHandler: null,
    };
    this.spectators.push(spectator);
    this.bindSpectatorSocket(spectator);
    this.sendSpectateWelcome(spectator);
    this.sendFrameBatch(spectator);
    this.broadcastSpectatorCount();
    return true;
  }

  /** 停止定时器与断线计时，释放本房资源。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.clearBothOfflineTimer();
    this.dropSpectators();
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
      this.recordDecisiveMatchIfNeeded();
      this.resetToWaiting();
      return;
    }

    if (tick % HASH_INTERVAL_TICKS === 0) {
      this.serverHashes.set(tick, this.match.hash());
    }
  }

  private handleClientMessage(seatIndex: number, raw: string): void {
    const seat = this.seats[seatIndex];
    if (!seat || !seat.connected) return;

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
      message.type === 'hash' ||
      message.type === 'startMatch' ||
      message.type === 'setReady'
    ) {
      this.touchActive();
    }

    switch (message.type) {
      case 'ping':
        this.send(seat.ws, { type: 'pong', t: message.t });
        break;
      case 'startMatch':
        this.handleStartMatch(seat);
        break;
      case 'setReady':
        this.handleSetReady(seat, message.ready === true);
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

  /** 房主在 waiting 且双方已准备时开局；否则回可展示错误。 */
  private handleStartMatch(seat: Seat): void {
    if (this.started) {
      this.send(seat.ws, { type: 'error', code: 'already_started', message: '对局已经开始' });
      return;
    }
    if (seat.seat !== this.hostSeat) {
      this.send(seat.ws, { type: 'error', code: 'not_host', message: '只有房主可以开始游戏' });
      return;
    }
    if (!this.seats[0] || !this.seats[1]) {
      this.send(seat.ws, { type: 'error', code: 'not_ready', message: '人数未齐，无法开始' });
      return;
    }
    if (!this.seats[0].ready || !this.seats[1].ready) {
      this.send(seat.ws, { type: 'error', code: 'not_ready', message: '双方尚未准备' });
      return;
    }
    this.beginMatch();
  }

  /** 非房主在 waiting 切换准备；房主始终准备，取消会被拒绝。 */
  private handleSetReady(seat: Seat, ready: boolean): void {
    if (this.started) {
      this.send(seat.ws, { type: 'error', code: 'already_started', message: '对局已经开始' });
      return;
    }
    if (seat.seat === this.hostSeat) {
      this.send(seat.ws, { type: 'error', code: 'is_host', message: '房主默认准备，无需取消' });
      return;
    }
    if (seat.ready === ready) return;
    seat.ready = ready;
    this.broadcastRoomState();
  }

  /** 结算后清对局状态、保留席位，并广播回房快照。 */
  private resetToWaiting(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
    this.ended = false;
    this.match = null;
    this.serverTick = 0;
    this.seed = 0;
    this.scheduled.clear();
    this.serverHashes.clear();
    this.frameHistory.clear();
    for (const seat of this.seats) {
      if (seat) seat.ready = true;
    }
    this.dropSpectators();
    this.broadcastRoomState();
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
      this.promoteHostAfterLeave(seatIndex);
      if (this.isEmpty) {
        this.dispose();
        return;
      }
      this.broadcastRoomState();
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
    this.dropSpectators();

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

  /** 房主离座后把主持权交给剩余席，保证房间始终有人能开局。 */
  private promoteHostAfterLeave(leftSeat: number): void {
    if (this.hostSeat !== leftSeat) return;
    const next = this.seats.findIndex((entry) => entry !== null);
    if (next < 0) return;
    this.hostSeat = next;
    const host = this.seats[next];
    if (host) host.ready = true;
  }

  /** 广播成员、准备与房主，供房间页刷新。 */
  private broadcastRoomState(): void {
    this.broadcast(this.toRoomState());
  }

  private toRoomState(): RoomStateMessage {
    return {
      type: 'roomState',
      roomId: this.roomId,
      roomName: this.roomName,
      hostSeat: this.hostSeat,
      phase: this.started ? 'playing' : 'waiting',
      members: this.seats
        .filter((entry): entry is Seat => entry !== null)
        .map((entry) => ({
          seat: entry.seat,
          name: entry.name,
          ready: entry.ready,
          isHost: entry.seat === this.hostSeat,
        })),
    };
  }

  private sendWelcome(seat: Seat, seed: number): void {
    const opponent = this.seats.find((entry) => entry && entry.seat !== seat.seat) ?? null;
    this.send(seat.ws, {
      type: 'welcome',
      seat: seat.seat,
      faction: seat.faction,
      seed,
      inputDelay: DEFAULT_INPUT_DELAY,
      roomId: this.roomId,
      roomName: this.roomName,
      reconnectToken: seat.reconnectToken,
      opponentName: opponent?.name ?? '',
    });
  }

  /** 观战欢迎包：带种子与双方名字，不含席位令牌。 */
  private sendSpectateWelcome(spectator: Spectator): void {
    this.send(spectator.ws, {
      type: 'spectateWelcome',
      roomId: this.roomId,
      roomName: this.roomName,
      seed: this.seed,
      currentTick: this.serverTick,
      blueName: this.seats[0]?.name ?? '',
      redName: this.seats[1]?.name ?? '',
      spectatorCount: this.spectatorCount,
    });
  }

  /** 把 tick 1 到当前的权威帧打成一条补帧包。 */
  private sendFrameBatch(spectator: Spectator): void {
    if (this.serverTick < 1) return;
    const frames: Command[][] = [];
    for (let tick = 1; tick <= this.serverTick; tick += 1) {
      frames.push(this.frameHistory.get(tick) ?? []);
    }
    this.send(spectator.ws, { type: 'frameBatch', fromTick: 1, frames });
  }

  private broadcastSpectatorCount(): void {
    this.broadcast({ type: 'spectatorCount', count: this.spectatorCount });
  }

  /** 结算或关房时踢掉全部观战连接。 */
  private dropSpectators(): void {
    const list = this.spectators.splice(0);
    for (const spectator of list) {
      this.unbindSpectatorSocket(spectator);
      try {
        spectator.ws.close();
      } catch {
        /* ignore */
      }
    }
  }

  private bindSpectatorSocket(spectator: Spectator): void {
    this.unbindSpectatorSocket(spectator);
    const closeHandler = (): void => this.handleSpectatorDisconnect(spectator);
    const messageHandler = (data: RawData): void => {
      const text = typeof data === 'string' ? data : data.toString();
      this.handleSpectatorMessage(spectator, text);
    };
    spectator.closeHandler = closeHandler;
    spectator.messageHandler = messageHandler;
    spectator.ws.on('close', closeHandler);
    spectator.ws.on('message', messageHandler);
  }

  private unbindSpectatorSocket(spectator: Spectator): void {
    if (spectator.closeHandler) spectator.ws.off('close', spectator.closeHandler);
    if (spectator.messageHandler) spectator.ws.off('message', spectator.messageHandler);
    spectator.closeHandler = null;
    spectator.messageHandler = null;
  }

  private handleSpectatorDisconnect(spectator: Spectator): void {
    this.unbindSpectatorSocket(spectator);
    const index = this.spectators.indexOf(spectator);
    if (index >= 0) this.spectators.splice(index, 1);
    this.broadcastSpectatorCount();
  }

  /** 观战连接只回心跳，忽略出牌/开局等指令。 */
  private handleSpectatorMessage(spectator: Spectator, raw: string): void {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    if (message.type === 'ping') {
      this.send(spectator.ws, { type: 'pong', t: message.t });
    }
  }

  private broadcast(message: ServerMessage): void {
    for (const seat of this.seats) {
      if (seat?.connected) this.send(seat.ws, message);
    }
    for (const spectator of this.spectators) {
      this.send(spectator.ws, message);
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

  /** 仅在权威结算且一方获胜、双方都有设备 ID 时写战绩；ended 保证每局一次。 */
  private recordDecisiveMatchIfNeeded(): void {
    const winner = this.match?.result?.winner ?? null;
    const sides = resolveDecisiveMatch(this.seats, winner);
    if (!sides) return;
    this.onDecisiveMatch?.(sides.winnerId, sides.loserId, sides.names);
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
