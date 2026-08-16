import {
  HASH_INTERVAL_TICKS,
  decodeServerMessage,
  encodeMessage,
  type ServerMessage,
} from '@pb/net';
import {
  MatchState,
  TICK_RATE,
  takeSnapshot,
  type Command,
  type Faction,
  type MatchResult,
  type Snapshot,
} from '@pb/sim';

const STEP_MS = 1000 / TICK_RATE;

export interface NetSimLoopOptions {
  seed: number;
  faction: Faction;
  inputDelay: number;
  /** 发送已编码的上行文本。 */
  send: (raw: string) => void;
  /** 观战只读：不上报 input/hash。 */
  spectator?: boolean;
  /** 每帧最多消化的权威 tick 数；观战追帧时限制以免卡主线程。 */
  maxStepsPerAdvance?: number;
  onDesync?: (tick: number, serverHash: number) => void;
  onPeerLeft?: () => void;
  onPeerDisconnected?: () => void;
  onPeerReconnected?: () => void;
  onMatchEnd?: (result: MatchResult) => void;
  onReady?: () => void;
}

/**
 * 联机逻辑驱动：本地输入只上报，收到服务端 frame 才 step。
 * 渲染插值基准改为帧到达节奏，而不再靠墙钟攒 tick。
 */
export class NetSimLoop {
  readonly match: MatchState;
  readonly faction: Faction;
  readonly inputDelay: number;

  prev: Snapshot;
  curr: Snapshot;

  private readonly frames = new Map<number, Command[]>();
  private nextTick = 1;
  private lastStepAt = performance.now();
  private send: (raw: string) => void;
  private readonly onDesync?: (tick: number, serverHash: number) => void;
  private readonly onPeerLeft?: () => void;
  private readonly onPeerDisconnected?: () => void;
  private readonly onPeerReconnected?: () => void;
  private readonly onMatchEnd?: (result: MatchResult) => void;
  private readonly spectator: boolean;
  private readonly maxStepsPerAdvance: number;
  private started = false;
  /** 重连窗口内禁止本地出牌，避免发到已失效的 socket。 */
  private inputPaused = false;

  constructor(options: NetSimLoopOptions) {
    this.match = new MatchState(options.seed);
    this.match.seedStartingCastles();
    this.faction = options.faction;
    this.inputDelay = options.inputDelay;
    this.send = options.send;
    this.spectator = options.spectator === true;
    this.maxStepsPerAdvance = Math.max(1, options.maxStepsPerAdvance ?? Number.POSITIVE_INFINITY);
    this.onDesync = options.onDesync;
    this.onPeerLeft = options.onPeerLeft;
    this.onPeerDisconnected = options.onPeerDisconnected;
    this.onPeerReconnected = options.onPeerReconnected;
    this.onMatchEnd = options.onMatchEnd;
    this.curr = takeSnapshot(this.match.world);
    this.prev = takeSnapshot(this.match.world);
    options.onReady?.();
  }

  /** 本地已应用的最后权威 tick，重连时作为补帧起点。 */
  get lastConfirmedTick(): number {
    return this.match.world.tick;
  }

  /** 已收到但尚未 step 的权威帧数量，供「追帧中」提示。 */
  get pendingTicks(): number {
    let count = 0;
    for (let tick = this.nextTick; this.frames.has(tick); tick += 1) count += 1;
    return count;
  }

  /** 重连成功后切换到新的 WebSocket 发送函数。 */
  setSend(send: (raw: string) => void): void {
    this.send = send;
  }

  /** 暂停或恢复本地输入上报。 */
  setInputPaused(paused: boolean): void {
    this.inputPaused = paused;
  }

  get world() {
    return this.match.world;
  }

  get tick(): number {
    return this.match.world.tick;
  }

  /** 当前处于两帧之间的比例，供渲染插值。 */
  get alpha(): number {
    return Math.min(1, (performance.now() - this.lastStepAt) / STEP_MS);
  }

  /** 处理服务端下行消息。 */
  handleMessage(raw: string): void {
    const message = decodeServerMessage(raw);
    if (!message) return;
    this.handleServerMessage(message);
  }

  handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'start':
        this.started = true;
        this.nextTick = message.startTick;
        break;
      case 'frameBatch': {
        this.started = true;
        let tick = message.fromTick;
        for (const commands of message.frames) {
          if (tick >= this.nextTick) this.frames.set(tick, commands);
          tick += 1;
        }
        this.drainFrames();
        break;
      }
      case 'frame':
        // 补帧可能重复到达：已应用过的 tick 直接忽略，避免二次 step
        if (message.tick < this.nextTick) break;
        this.frames.set(message.tick, message.commands);
        this.drainFrames();
        break;
      case 'desync':
        this.onDesync?.(message.tick, message.serverHash);
        break;
      case 'peerDisconnected':
        this.onPeerDisconnected?.();
        break;
      case 'peerReconnected':
        this.onPeerReconnected?.();
        break;
      case 'peerLeft':
        this.onPeerLeft?.();
        break;
      case 'matchEnd':
        this.onMatchEnd?.({
          winner: message.winner,
          reason: message.reason,
          endTick: message.endTick,
        });
        break;
      default:
        break;
    }
  }

  /**
   * 本地输入只 send，不入本地队列。
   * 目标 tick = 当前已应用 tick + inputDelay（至少为 nextTick）。
   */
  sendInput(commands: readonly Command[]): void {
    if (this.spectator || !this.started || this.inputPaused || this.match.result || commands.length === 0) return;
    const tick = Math.max(this.nextTick, this.match.world.tick + this.inputDelay);
    this.send(
      encodeMessage({
        type: 'input',
        tick,
        commands: [...commands],
      }),
    );
  }

  /** 每帧调用：尽量消化已到达的连续 frame。 */
  advance(_deltaMs: number): void {
    this.drainFrames();
  }

  private drainFrames(): void {
    let stepped = 0;
    while (this.frames.has(this.nextTick) && stepped < this.maxStepsPerAdvance) {
      const commands = this.frames.get(this.nextTick)!;
      this.frames.delete(this.nextTick);
      this.match.step(commands);
      const reuse = this.prev;
      this.prev = this.curr;
      this.curr = takeSnapshot(this.match.world, reuse);
      this.lastStepAt = performance.now();

      if (!this.spectator && this.nextTick % HASH_INTERVAL_TICKS === 0) {
        this.send(
          encodeMessage({
            type: 'hash',
            tick: this.nextTick,
            hash: this.match.hash(),
          }),
        );
      }
      this.nextTick += 1;
      stepped += 1;
    }
  }
}
