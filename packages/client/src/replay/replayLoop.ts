import {
  MatchState,
  TICK_RATE,
  takeSnapshot,
  type Command,
  type Snapshot,
} from '@pb/sim';
import type { ReplayRecord } from './types.js';

const STEP_MS = 1000 / TICK_RATE;
/** 4x 回放切回前台时一次最多补这么多 tick，避免卡主线程。 */
const MAX_CATCHUP_STEPS = 40;

/** 战绩回放可选倍速档位。 */
export const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/** 过滤控制条 data-replay-speed，避免非法数字写入循环。 */
export function isReplaySpeed(value: number): value is ReplaySpeed {
  return (REPLAY_SPEEDS as readonly number[]).includes(value);
}

export interface ReplayLoopOptions {
  /** 重跑结束时结算与录像不一致（通常是 sim / 场地已变）。 */
  onMismatch?: (actual: MatchState['result'], expected: ReplayRecord['result']) => void;
}

/**
 * 本地时钟重跑录像。对外接口对齐 NetSimLoop 的 prev/curr/alpha，
 * 以便回放页直接复用 BattleView.render。
 */
export class ReplayLoop {
  match: MatchState;
  prev: Snapshot;
  curr: Snapshot;

  private accumulator = 0;
  private paused = false;
  private playbackSpeed: ReplaySpeed = 1;
  private finished = false;
  private mismatchReported = false;
  private readonly framesByTick = new Map<number, Command[]>();
  private readonly record: ReplayRecord;
  private readonly onMismatch?: ReplayLoopOptions['onMismatch'];

  constructor(record: ReplayRecord, options: ReplayLoopOptions = {}) {
    this.record = record;
    this.onMismatch = options.onMismatch;
    for (const frame of record.frames) {
      this.framesByTick.set(frame.tick, frame.commands);
    }
    this.match = this.createMatch();
    this.curr = takeSnapshot(this.match.world);
    this.prev = takeSnapshot(this.match.world);
  }

  get world() {
    return this.match.world;
  }

  get tick(): number {
    return this.match.world.tick;
  }

  get speed(): ReplaySpeed {
    return this.playbackSpeed;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /** 当前处于两帧之间的比例，供渲染插值。 */
  get alpha(): number {
    if (this.paused || this.finished) return 1;
    return Math.min(1, this.accumulator / STEP_MS);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setSpeed(speed: ReplaySpeed): void {
    this.playbackSpeed = speed;
  }

  /** 从头重建 MatchState，保留当前倍速与暂停状态。 */
  restart(): void {
    this.match = this.createMatch();
    this.curr = takeSnapshot(this.match.world);
    this.prev = takeSnapshot(this.match.world);
    this.accumulator = 0;
    this.finished = false;
    this.mismatchReported = false;
  }

  /** 墙钟累加器 × 倍速推进；播到 endTick 后停住。 */
  advance(deltaMs: number): void {
    if (this.paused || this.finished) return;
    this.accumulator += Math.max(0, deltaMs) * this.playbackSpeed;
    let steps = 0;
    while (this.accumulator >= STEP_MS && steps < MAX_CATCHUP_STEPS) {
      this.stepOnce();
      this.accumulator -= STEP_MS;
      steps += 1;
      if (this.finished) {
        this.accumulator = 0;
        break;
      }
    }
  }

  private createMatch(): MatchState {
    const match = new MatchState(this.record.seed, this.record.matchMode);
    match.seedStartingCastles();
    return match;
  }

  private stepOnce(): void {
    const nextTick = this.match.world.tick + 1;
    const commands = this.framesByTick.get(nextTick) ?? [];
    this.match.step(commands);
    const reuse = this.prev;
    this.prev = this.curr;
    this.curr = takeSnapshot(this.match.world, reuse);

    if (this.match.world.tick >= this.record.endTick || this.match.result) {
      this.finished = true;
      this.reportMismatchIfNeeded();
    }
  }

  private reportMismatchIfNeeded(): void {
    if (this.mismatchReported) return;
    const actual = this.match.result;
    const expected = this.record.result;
    if (
      actual
      && actual.winner === expected.winner
      && actual.reason === expected.reason
      && actual.endTick === this.record.endTick
    ) {
      return;
    }
    this.mismatchReported = true;
    this.onMismatch?.(actual, expected);
  }
}
