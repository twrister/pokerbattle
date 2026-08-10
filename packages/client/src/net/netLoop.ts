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
  onDesync?: (tick: number, serverHash: number) => void;
  onPeerLeft?: () => void;
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
  private readonly send: (raw: string) => void;
  private readonly onDesync?: (tick: number, serverHash: number) => void;
  private readonly onPeerLeft?: () => void;
  private readonly onMatchEnd?: (result: MatchResult) => void;
  private started = false;

  constructor(options: NetSimLoopOptions) {
    this.match = new MatchState(options.seed);
    this.match.seedStartingCastles();
    this.faction = options.faction;
    this.inputDelay = options.inputDelay;
    this.send = options.send;
    this.onDesync = options.onDesync;
    this.onPeerLeft = options.onPeerLeft;
    this.onMatchEnd = options.onMatchEnd;
    this.curr = takeSnapshot(this.match.world);
    this.prev = this.curr;
    options.onReady?.();
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
      case 'frame':
        this.frames.set(message.tick, message.commands);
        this.drainFrames();
        break;
      case 'desync':
        this.onDesync?.(message.tick, message.serverHash);
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
    if (!this.started || this.match.result || commands.length === 0) return;
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
    while (this.frames.has(this.nextTick)) {
      const commands = this.frames.get(this.nextTick)!;
      this.frames.delete(this.nextTick);
      this.match.step(commands);
      this.prev = this.curr;
      this.curr = takeSnapshot(this.match.world);
      this.lastStepAt = performance.now();

      if (this.nextTick % HASH_INTERVAL_TICKS === 0) {
        this.send(
          encodeMessage({
            type: 'hash',
            tick: this.nextTick,
            hash: this.match.hash(),
          }),
        );
      }
      this.nextTick += 1;
    }
  }
}
